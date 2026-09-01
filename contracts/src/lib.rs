#![no_std]

//! StellarAID — Programmable aid vouchers.
//!
//! A voucher is a USDC-backed allowance locked to a recipient, spendable only at
//! whitelisted merchants, for a given category/region, until an expiry timestamp.
//! Amounts move through a Confidential Token wrapper in production; this core
//! contract enforces all *spendability rules* on-chain.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env, Symbol};

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    Merchant(Address),
    Voucher(u32),
    Delegate(u32, Address),
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Voucher {
    pub recipient: Address,
    pub amount: i128,
    pub spent: i128,
    pub category: Symbol,
    pub region: Symbol,
    pub expires_at: u64,
    /// Admin-initiated incident freeze (e.g. Quorum Freeze). Distinct from
    /// `depleted` below — an admin unfreezing a voucher should never make a
    /// fully-spent voucher spendable again.
    pub frozen: bool,
    /// Set once `spent == amount`. Separate from `frozen` so the two states
    /// can't be confused when an admin toggles `set_frozen`.
    pub depleted: bool,
}

#[contracterror]
#[derive(Debug, Eq, PartialEq, Copy, Clone)]
#[repr(u32)]
pub enum VoucherError {
    NotAdmin = 1,
    NotAuthorized = 2,
    NotFound = 3,
    Expired = 4,
    Frozen = 5,
    Insufficient = 6,
    MerchantInactive = 7,
    AlreadyTaken = 8,
    InvalidAmount = 9,
}

#[contract]
pub struct AidVoucher;

#[contractimpl]
impl AidVoucher {
    // ------------------------------------------------------------------
    // Admin bootstrap
    // ------------------------------------------------------------------

    pub fn initialize(env: Env, admin: Address, token: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.events().publish((Symbol::new(&env, "initialize"),), (admin,));
    }

    fn admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("contract not initialized")
    }

    /// Loads the configured USDC token client. Not parameterized by contract
    /// address — the reserve is always this contract, addressed internally.
    fn token_client(env: &Env) -> token::Client {
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("contract not initialized");
        token::Client::new(env, &token)
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), VoucherError> {
        caller.require_auth();
        if caller != &Self::admin(env) {
            return Err(VoucherError::NotAdmin);
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // Merchant whitelist
    // ------------------------------------------------------------------

    pub fn set_merchant(env: Env, caller: Address, merchant: Address, active: bool) -> Result<(), VoucherError> {
        Self::require_admin(&env, &caller)?;
        env.storage()
            .instance()
            .set(&DataKey::Merchant(merchant.clone()), &active);
        env.events()
            .publish((Symbol::new(&env, "merchant"),), (merchant, active));
        Ok(())
    }

    pub fn is_merchant(env: Env, merchant: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Merchant(merchant))
            .unwrap_or(false)
    }

    // ------------------------------------------------------------------
    // Voucher lifecycle
    // ------------------------------------------------------------------

    /// Admin locks `amount` USDC into the contract and creates a voucher.
    pub fn issue_voucher(
        env: Env,
        caller: Address,
        recipient: Address,
        voucher_id: u32,
        amount: i128,
        category: Symbol,
        region: Symbol,
        expires_at: u64,
    ) -> Result<(), VoucherError> {
        Self::require_admin(&env, &caller)?;
        if amount <= 0 {
            return Err(VoucherError::InvalidAmount);
        }
        if env.storage().instance().has(&DataKey::Voucher(voucher_id)) {
            return Err(VoucherError::AlreadyTaken);
        }
        let contract = env.current_contract_address();

        // Move USDC from the admin treasury into the contract reserve. `transfer`
        // (not `transfer_from`) is correct here: `caller.require_auth()` above
        // already covers this whole invocation tree, including the nested token
        // call, so no separate SEP-41 `approve` allowance step is needed.
        Self::token_client(&env).transfer(&caller, &contract, &amount);

        env.storage().instance().set(
            &DataKey::Voucher(voucher_id),
            &Voucher {
                recipient: recipient.clone(),
                amount,
                spent: 0,
                category,
                region,
                expires_at,
                frozen: false,
                depleted: false,
            },
        );
        env.events().publish(
            (Symbol::new(&env, "issued"), voucher_id),
            (recipient, amount),
        );
        Ok(())
    }

    /// Validates every spendability rule. Pure — no token movement — so it is
    /// fully unit-testable. `redeem` relies on it.
    pub fn can_redeem(
        env: Env,
        voucher_id: u32,
        spender: Address,
        merchant: Address,
        amount: i128,
    ) -> Result<Voucher, VoucherError> {
        if amount <= 0 {
            return Err(VoucherError::InvalidAmount);
        }

        let voucher: Voucher = env
            .storage()
            .instance()
            .get(&DataKey::Voucher(voucher_id))
            .ok_or(VoucherError::NotFound)?;

        if voucher.frozen || voucher.depleted {
            return Err(VoucherError::Frozen);
        }

        let authorized = spender == voucher.recipient
            || env
                .storage()
                .instance()
                .get(&DataKey::Delegate(voucher_id, spender))
                .unwrap_or(false);
        if !authorized {
            return Err(VoucherError::NotAuthorized);
        }

        if !Self::is_merchant(env.clone(), merchant.clone()) {
            return Err(VoucherError::MerchantInactive);
        }
        if env.ledger().timestamp() > voucher.expires_at {
            return Err(VoucherError::Expired);
        }
        if voucher.spent + amount > voucher.amount {
            return Err(VoucherError::Insufficient);
        }
        Ok(voucher)
    }

    /// Spends part (or all) of a voucher at a whitelisted merchant.
    pub fn redeem(
        env: Env,
        voucher_id: u32,
        spender: Address,
        merchant: Address,
        amount: i128,
    ) -> Result<(), VoucherError> {
        // The spender must cryptographically prove they are the authorized party.
        spender.require_auth();
        let voucher =
            Self::can_redeem(env.clone(), voucher_id, spender.clone(), merchant.clone(), amount)?;
        let spent = voucher.spent + amount;

        let mut updated = voucher.clone();
        updated.spent = spent;
        if voucher.amount - spent == 0 {
            updated.depleted = true; // fully spent — distinct from an admin `frozen` incident flag
        }
        env.storage()
            .instance()
            .set(&DataKey::Voucher(voucher_id), &updated);

        // Pay the merchant from the contract reserve.
        let contract = env.current_contract_address();
        Self::token_client(&env).transfer(&contract, &merchant, &amount);

        env.events().publish(
            (Symbol::new(&env, "redeemed"), voucher_id),
            (merchant, amount, spent),
        );
        Ok(())
    }

    /// Anyone may burn an expired voucher; remaining USDC returns to admin.
    pub fn burn_expired(env: Env, voucher_id: u32) -> Result<(), VoucherError> {
        let voucher: Voucher = env
            .storage()
            .instance()
            .get(&DataKey::Voucher(voucher_id))
            .ok_or(VoucherError::NotFound)?;
        if env.ledger().timestamp() <= voucher.expires_at {
            return Err(VoucherError::Expired);
        }

        let remaining = voucher.amount - voucher.spent;
        let contract = env.current_contract_address();
        if remaining > 0 {
            let admin = Self::admin(&env);
            Self::token_client(&env).transfer(&contract, &admin, &remaining);
        }
        env.storage()
            .instance()
            .remove(&DataKey::Voucher(voucher_id));
        env.events().publish((Symbol::new(&env, "burned"), voucher_id), (remaining,));
        Ok(())
    }

    // ------------------------------------------------------------------
    // Delegation & incident response
    // ------------------------------------------------------------------

    /// Allow an additional spender on a voucher (e.g. a family member).
    pub fn add_delegate(
        env: Env,
        recipient: Address,
        voucher_id: u32,
        delegate: Address,
        active: bool,
    ) -> Result<(), VoucherError> {
        recipient.require_auth();
        let voucher: Voucher = env
            .storage()
            .instance()
            .get(&DataKey::Voucher(voucher_id))
            .ok_or(VoucherError::NotFound)?;
        if voucher.recipient != recipient {
            return Err(VoucherError::NotAdmin);
        }
        env.storage()
            .instance()
            .set(&DataKey::Delegate(voucher_id, delegate.clone()), &active);
        env.events().publish(
            (Symbol::new(&env, "delegate"), voucher_id),
            (delegate, active),
        );
        Ok(())
    }

    /// Admin freezes a voucher. In production this is wired into Stellar
    /// Quorum Freeze (Protocol 26 CAP-77) incident response.
    pub fn set_frozen(env: Env, caller: Address, voucher_id: u32, frozen: bool) -> Result<(), VoucherError> {
        Self::require_admin(&env, &caller)?;
        let mut voucher: Voucher = env
            .storage()
            .instance()
            .get(&DataKey::Voucher(voucher_id))
            .ok_or(VoucherError::NotFound)?;
        voucher.frozen = frozen;
        env.storage()
            .instance()
            .set(&DataKey::Voucher(voucher_id), &voucher);
        env.events().publish((Symbol::new(&env, "frozen"), voucher_id), (frozen,));
        Ok(())
    }

    // ------------------------------------------------------------------
    // Queries
    // ------------------------------------------------------------------

    pub fn voucher_info(env: Env, voucher_id: u32) -> Option<Voucher> {
        env.storage().instance().get(&DataKey::Voucher(voucher_id))
    }
}

// ----------------------------------------------------------------------
// Unit tests. Validation logic is intentionally token-free so the security
// path is fully testable without deploying a live SAC.
// ----------------------------------------------------------------------

#[cfg(test)]
mod test {
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{Address, Env, Symbol};

    use super::{AidVoucher, AidVoucherClient, DataKey, Voucher, VoucherError};

    /// Registers a fresh contract instance and initializes it. Tests drive
    /// the contract through the generated `Client` (the officially supported
    /// entry point — `try_*` methods, in particular, are only generated
    /// there, not on the contract type itself).
    fn setup<'a>(env: &'a Env) -> (Address, Address, Address, AidVoucherClient<'a>) {
        let admin = Address::generate(env);
        let token = Address::generate(env);
        let contract_id = env.register(AidVoucher, ());
        let client = AidVoucherClient::new(env, &contract_id);
        client.initialize(&admin, &token);
        (admin, token, contract_id, client)
    }

    /// Seeds a voucher directly into contract storage so the pure-validation
    /// path (`can_redeem`) can be exercised without a live token contract.
    fn seed_voucher(env: &Env, contract_id: &Address, id: u32, voucher: &Voucher) {
        env.as_contract(contract_id, || {
            env.storage().instance().set(&DataKey::Voucher(id), voucher);
        });
    }

    fn sample_voucher(env: &Env, recipient: Address, amount: i128, spent: i128) -> Voucher {
        Voucher {
            recipient,
            amount,
            spent,
            category: Symbol::new(env, "groceries"),
            region: Symbol::new(env, "nairobi"),
            expires_at: env.ledger().timestamp() + 1000,
            frozen: false,
            depleted: false,
        }
    }

    #[test]
    fn initialize_sets_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _, contract_id, _client) = setup(&env);
        let stored: Address = env.as_contract(&contract_id, || {
            env.storage().instance().get(&DataKey::Admin).unwrap()
        });
        assert_eq!(stored, admin);
    }

    #[test]
    fn merchant_gating() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _, _contract_id, client) = setup(&env);
        let merchant = Address::generate(&env);

        assert!(!client.is_merchant(&merchant));
        client.set_merchant(&admin, &merchant, &true);
        assert!(client.is_merchant(&merchant));
    }

    #[test]
    fn non_admin_cannot_set_merchant() {
        let env = Env::default();
        env.mock_all_auths(); // covers `initialize` in setup(); the stranger below is never authorized
        let (_, _, _contract_id, client) = setup(&env);
        let merchant = Address::generate(&env);
        let stranger = Address::generate(&env);

        env.set_auths(&[]); // no signed authorizations from here on
        let res = client.try_set_merchant(&stranger, &merchant, &true);
        assert!(res.is_err(), "expected auth failure");
        assert!(!client.is_merchant(&merchant));
    }

    #[test]
    fn can_redeem_checks_limits_and_merchant() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _, contract_id, client) = setup(&env);
        let recipient = Address::generate(&env);
        let merchant = Address::generate(&env);
        client.set_merchant(&admin, &merchant, &true);

        seed_voucher(&env, &contract_id, 7, &sample_voucher(&env, recipient.clone(), 100, 0));

        // Valid spend passes the guards.
        let v = client.can_redeem(&7, &recipient, &merchant, &60);
        assert_eq!(v.spent, 0);

        // Over-spend is rejected.
        let res = client.try_can_redeem(&7, &recipient, &merchant, &120);
        assert_eq!(res.unwrap_err().unwrap(), VoucherError::Insufficient);

        // Unauthorized spender is rejected.
        let intruder = Address::generate(&env);
        let res = client.try_can_redeem(&7, &intruder, &merchant, &10);
        assert_eq!(res.unwrap_err().unwrap(), VoucherError::NotAuthorized);

        // Expired voucher is rejected. The default test ledger starts at
        // timestamp 0, so advance it first rather than underflowing.
        env.ledger().set_timestamp(1000);
        let mut expired = sample_voucher(&env, recipient.clone(), 100, 0);
        expired.expires_at = env.ledger().timestamp() - 1;
        seed_voucher(&env, &contract_id, 8, &expired);
        let res = client.try_can_redeem(&8, &recipient, &merchant, &10);
        assert_eq!(res.unwrap_err().unwrap(), VoucherError::Expired);
    }

    #[test]
    fn burn_before_expiry_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, _, contract_id, client) = setup(&env);
        let recipient = Address::generate(&env);

        seed_voucher(&env, &contract_id, 9, &sample_voucher(&env, recipient, 100, 0));

        let res = client.try_burn_expired(&9);
        assert_eq!(res.unwrap_err().unwrap(), VoucherError::Expired);
    }

    #[test]
    fn non_positive_amounts_are_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _, contract_id, client) = setup(&env);
        let recipient = Address::generate(&env);
        let merchant = Address::generate(&env);
        client.set_merchant(&admin, &merchant, &true);

        seed_voucher(&env, &contract_id, 10, &sample_voucher(&env, recipient.clone(), 100, 0));

        // Zero and negative amounts must not be able to shrink `spent` or
        // otherwise slip past the balance check.
        let res = client.try_can_redeem(&10, &recipient, &merchant, &0);
        assert_eq!(res.unwrap_err().unwrap(), VoucherError::InvalidAmount);

        let res = client.try_can_redeem(&10, &recipient, &merchant, &-50);
        assert_eq!(res.unwrap_err().unwrap(), VoucherError::InvalidAmount);
    }

    #[test]
    fn depleted_voucher_cannot_be_reopened_by_unfreezing() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _, contract_id, client) = setup(&env);
        let recipient = Address::generate(&env);
        let merchant = Address::generate(&env);
        client.set_merchant(&admin, &merchant, &true);

        // Seed a voucher that is already fully spent (depleted), not admin-frozen.
        let mut depleted = sample_voucher(&env, recipient.clone(), 100, 100);
        depleted.depleted = true;
        seed_voucher(&env, &contract_id, 11, &depleted);

        // Admin "unfreezing" (there was never a freeze) must not make a
        // depleted voucher spendable again.
        client.set_frozen(&admin, &11, &false);
        let res = client.try_can_redeem(&11, &recipient, &merchant, &1);
        assert_eq!(res.unwrap_err().unwrap(), VoucherError::Frozen);
    }
}