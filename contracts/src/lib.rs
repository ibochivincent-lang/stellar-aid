#![no_std]
// `issue_voucher`'s admin-bootstrap signature genuinely needs one field per
// on-chain voucher attribute (env/caller aside: recipient, id, amount,
// category, region, expiry) — grouping them into a params struct would only
// move the field count, not reduce it, while breaking the simple positional
// `stellar contract invoke` ergonomics this early-stage contract relies on.
#![allow(clippy::too_many_arguments)]

//! StellarAID — Programmable aid vouchers.
//!
//! A voucher is a USDC-backed allowance locked to a recipient, spendable only at
//! whitelisted merchants, for a given category/region, until an expiry timestamp.
//! Amounts move through a Confidential Token wrapper in production; this core
//! contract enforces all *spendability rules* on-chain.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env,
    Symbol, Vec,
};

/// Contract events. Structured with `#[contractevent]` (soroban-sdk 26+) rather
/// than raw `env.events().publish(...)` tuples — the latter is deprecated in
/// favor of typed events so downstream indexers get a stable, self-describing
/// schema instead of positional topic/data tuples.
#[contractevent(topics = ["initialize"], data_format = "vec")]
#[derive(Clone, Debug, PartialEq)]
pub struct InitializeEvent {
    pub admin: Address,
}

#[contractevent(topics = ["merchant"], data_format = "vec")]
#[derive(Clone, Debug, PartialEq)]
pub struct MerchantEvent {
    pub merchant: Address,
    pub active: bool,
}

#[contractevent(topics = ["merchant_scope"], data_format = "vec")]
#[derive(Clone, Debug, PartialEq)]
pub struct MerchantScopeEvent {
    pub merchant: Address,
}

#[contractevent(topics = ["issued"], data_format = "vec")]
#[derive(Clone, Debug, PartialEq)]
pub struct IssuedEvent {
    #[topic]
    pub voucher_id: u32,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent(topics = ["redeemed"], data_format = "vec")]
#[derive(Clone, Debug, PartialEq)]
pub struct RedeemedEvent {
    #[topic]
    pub voucher_id: u32,
    pub merchant: Address,
    pub amount: i128,
    pub spent: i128,
}

#[contractevent(topics = ["burned"], data_format = "vec")]
#[derive(Clone, Debug, PartialEq)]
pub struct BurnedEvent {
    #[topic]
    pub voucher_id: u32,
    pub remaining: i128,
}

#[contractevent(topics = ["delegate"], data_format = "vec")]
#[derive(Clone, Debug, PartialEq)]
pub struct DelegateEvent {
    #[topic]
    pub voucher_id: u32,
    pub delegate: Address,
    pub active: bool,
}

#[contractevent(topics = ["frozen"], data_format = "vec")]
#[derive(Clone, Debug, PartialEq)]
pub struct FrozenEvent {
    #[topic]
    pub voucher_id: u32,
    pub frozen: bool,
}

#[contractevent(topics = ["oracle_set"], data_format = "vec")]
#[derive(Clone, Debug, PartialEq)]
pub struct OracleSetEvent {
    pub oracle: Address,
    pub active: bool,
}

#[contractevent(topics = ["flagged"], data_format = "vec")]
#[derive(Clone, Debug, PartialEq)]
pub struct FlaggedEvent {
    #[topic]
    pub merchant: Address,
    pub caller: Address,
    pub reason: Symbol,
}

#[contractevent(topics = ["anomaly"], data_format = "vec")]
#[derive(Clone, Debug, PartialEq)]
pub struct AnomalyEvent {
    #[topic]
    pub voucher_id: u32,
    pub caller: Address,
    pub score: u32,
    pub reason: Symbol,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    Merchant(Address),
    Voucher(u32),
    Delegate(u32, Address),
    /// Whitelisted off-chain anomaly-scanner addresses (see `set_oracle`).
    Oracle(Address),
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct MerchantProfile {
    pub active: bool,
    /// Categories this merchant may redeem vouchers for. Empty = unrestricted
    /// (matches every voucher's category) — the safe default when a merchant
    /// is first registered with no scope configured yet.
    pub categories: Vec<Symbol>,
    /// Regions this merchant may redeem vouchers in. Empty = unrestricted.
    pub regions: Vec<Symbol>,
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
    AlreadyInitialized = 10,
    CategoryNotApproved = 11,
    RegionNotApproved = 12,
    NotOracle = 13,
}

#[contract]
pub struct AidVoucher;

#[contractimpl]
impl AidVoucher {
    // ------------------------------------------------------------------
    // Admin bootstrap
    // ------------------------------------------------------------------

    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), VoucherError> {
        admin.require_auth();
        // Without this guard, `initialize` could be called again later to
        // silently re-point the contract at a different admin or token
        // address — indistinguishable from a normal bootstrap event.
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(VoucherError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        InitializeEvent { admin }.publish(&env);
        Ok(())
    }

    fn admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("contract not initialized")
    }

    /// Loads the configured USDC token client. Not parameterized by contract
    /// address — the reserve is always this contract, addressed internally.
    fn token_client(env: &Env) -> token::Client<'_> {
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

    fn merchant_profile(env: &Env, merchant: &Address) -> Option<MerchantProfile> {
        env.storage()
            .instance()
            .get(&DataKey::Merchant(merchant.clone()))
    }

    /// Registers a merchant (if new) or flips its active flag. A newly
    /// registered merchant starts with an unrestricted scope (matches every
    /// category/region) — call `set_merchant_scope` to narrow it. Keeping
    /// registration and scoping separate means turning a merchant on/off
    /// never has to know or repeat its existing category/region list.
    pub fn set_merchant(
        env: Env,
        caller: Address,
        merchant: Address,
        active: bool,
    ) -> Result<(), VoucherError> {
        Self::require_admin(&env, &caller)?;
        let mut profile = Self::merchant_profile(&env, &merchant).unwrap_or(MerchantProfile {
            active: false,
            categories: Vec::new(&env),
            regions: Vec::new(&env),
        });
        profile.active = active;
        env.storage()
            .instance()
            .set(&DataKey::Merchant(merchant.clone()), &profile);
        MerchantEvent { merchant, active }.publish(&env);
        Ok(())
    }

    /// Sets which categories/regions a merchant may redeem vouchers for.
    /// Pass an empty `Vec` for either to leave that dimension unrestricted.
    /// This is what actually enforces the "approved goods, within a region"
    /// half of the voucher pitch — `set_merchant` alone only gates whether a
    /// merchant can transact at all, not what they're scoped to.
    pub fn set_merchant_scope(
        env: Env,
        caller: Address,
        merchant: Address,
        categories: Vec<Symbol>,
        regions: Vec<Symbol>,
    ) -> Result<(), VoucherError> {
        Self::require_admin(&env, &caller)?;
        let mut profile = Self::merchant_profile(&env, &merchant).ok_or(VoucherError::NotFound)?;
        profile.categories = categories;
        profile.regions = regions;
        env.storage()
            .instance()
            .set(&DataKey::Merchant(merchant.clone()), &profile);
        MerchantScopeEvent { merchant }.publish(&env);
        Ok(())
    }

    pub fn is_merchant(env: Env, merchant: Address) -> bool {
        Self::merchant_profile(&env, &merchant)
            .map(|p| p.active)
            .unwrap_or(false)
    }

    pub fn merchant_info(env: Env, merchant: Address) -> Option<MerchantProfile> {
        Self::merchant_profile(&env, &merchant)
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
        IssuedEvent {
            voucher_id,
            recipient,
            amount,
        }
        .publish(&env);
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

        let profile =
            Self::merchant_profile(&env, &merchant).ok_or(VoucherError::MerchantInactive)?;
        if !profile.active {
            return Err(VoucherError::MerchantInactive);
        }
        if !profile.categories.is_empty() && !profile.categories.contains(&voucher.category) {
            return Err(VoucherError::CategoryNotApproved);
        }
        if !profile.regions.is_empty() && !profile.regions.contains(&voucher.region) {
            return Err(VoucherError::RegionNotApproved);
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
        let voucher = Self::can_redeem(
            env.clone(),
            voucher_id,
            spender.clone(),
            merchant.clone(),
            amount,
        )?;
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

        RedeemedEvent {
            voucher_id,
            merchant,
            amount,
            spent,
        }
        .publish(&env);
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
        BurnedEvent {
            voucher_id,
            remaining,
        }
        .publish(&env);
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
        DelegateEvent {
            voucher_id,
            delegate,
            active,
        }
        .publish(&env);
        Ok(())
    }

    /// Admin freezes a voucher. In production this is wired into Stellar
    /// Quorum Freeze (Protocol 26 CAP-77) incident response.
    pub fn set_frozen(
        env: Env,
        caller: Address,
        voucher_id: u32,
        frozen: bool,
    ) -> Result<(), VoucherError> {
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
        FrozenEvent { voucher_id, frozen }.publish(&env);
        Ok(())
    }

    // ------------------------------------------------------------------
    // Anomaly oracle
    //
    // An off-chain scanner (e.g. `backend/src/fraud/` consuming the event
    // poller's output) is granted a narrow, revocable role here — it can
    // FLAG a merchant or POST an anomaly score for a voucher, both purely
    // informational: neither call moves funds, deactivates anything, or
    // freezes a voucher by itself. The oracle proposes; only the admin's
    // own `set_merchant` / `set_frozen` calls (already elsewhere in this
    // contract) actually act on a flag. That split is deliberate — an AI
    // scoring model can be wrong or manipulated, so it never gets a path
    // to unilaterally affect fund movement; it only gets to make its
    // signal part of the auditable on-chain event log for a human (or the
    // backend's own admin-gated automation) to act on.
    // ------------------------------------------------------------------

    /// Admin-only: grants or revokes the oracle role for `oracle`.
    pub fn set_oracle(
        env: Env,
        caller: Address,
        oracle: Address,
        active: bool,
    ) -> Result<(), VoucherError> {
        Self::require_admin(&env, &caller)?;
        env.storage()
            .instance()
            .set(&DataKey::Oracle(oracle.clone()), &active);
        OracleSetEvent { oracle, active }.publish(&env);
        Ok(())
    }

    pub fn is_oracle(env: Env, oracle: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Oracle(oracle))
            .unwrap_or(false)
    }

    fn require_oracle(env: &Env, caller: &Address) -> Result<(), VoucherError> {
        caller.require_auth();
        if !Self::is_oracle(env.clone(), caller.clone()) {
            return Err(VoucherError::NotOracle);
        }
        Ok(())
    }

    /// Oracle-only: publishes a `flagged` event for `merchant`. Does NOT
    /// touch `MerchantProfile` — an admin decides whether to actually act
    /// on the flag via `set_merchant`.
    pub fn flag_merchant(
        env: Env,
        caller: Address,
        merchant: Address,
        reason: Symbol,
    ) -> Result<(), VoucherError> {
        Self::require_oracle(&env, &caller)?;
        FlaggedEvent {
            merchant,
            caller,
            reason,
        }
        .publish(&env);
        Ok(())
    }

    /// Oracle-only: publishes an `anomaly` event carrying a 0-100 score for
    /// `voucher_id`. Does NOT freeze the voucher — see the module doc above.
    pub fn post_anomaly(
        env: Env,
        caller: Address,
        voucher_id: u32,
        score: u32,
        reason: Symbol,
    ) -> Result<(), VoucherError> {
        Self::require_oracle(&env, &caller)?;
        if !env.storage().instance().has(&DataKey::Voucher(voucher_id)) {
            return Err(VoucherError::NotFound);
        }
        AnomalyEvent {
            voucher_id,
            caller,
            score,
            reason,
        }
        .publish(&env);
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

        seed_voucher(
            &env,
            &contract_id,
            7,
            &sample_voucher(&env, recipient.clone(), 100, 0),
        );

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

        seed_voucher(
            &env,
            &contract_id,
            9,
            &sample_voucher(&env, recipient, 100, 0),
        );

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

        seed_voucher(
            &env,
            &contract_id,
            10,
            &sample_voucher(&env, recipient.clone(), 100, 0),
        );

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

    #[test]
    fn reinitializing_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, token, _contract_id, client) = setup(&env);
        let other_token = Address::generate(&env);

        let res = client.try_initialize(&admin, &other_token);
        assert_eq!(res.unwrap_err().unwrap(), VoucherError::AlreadyInitialized);
        // Confirms it's a no-op, not a partial overwrite.
        let _ = token;
    }

    #[test]
    fn merchant_scope_restricts_category_and_region() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _, contract_id, client) = setup(&env);
        let recipient = Address::generate(&env);
        let merchant = Address::generate(&env);
        client.set_merchant(&admin, &merchant, &true);

        // Scope the merchant to "clinics" in "lagos" only.
        let mut categories = soroban_sdk::Vec::new(&env);
        categories.push_back(Symbol::new(&env, "clinics"));
        let mut regions = soroban_sdk::Vec::new(&env);
        regions.push_back(Symbol::new(&env, "lagos"));
        client.set_merchant_scope(&admin, &merchant, &categories, &regions);

        // The seeded voucher is "groceries"/"nairobi" — outside both scopes.
        seed_voucher(
            &env,
            &contract_id,
            20,
            &sample_voucher(&env, recipient.clone(), 100, 0),
        );

        let res = client.try_can_redeem(&20, &recipient, &merchant, &10);
        assert_eq!(res.unwrap_err().unwrap(), VoucherError::CategoryNotApproved);

        // Right category, still wrong region.
        let mut right_category = sample_voucher(&env, recipient.clone(), 100, 0);
        right_category.category = Symbol::new(&env, "clinics");
        seed_voucher(&env, &contract_id, 21, &right_category);
        let res = client.try_can_redeem(&21, &recipient, &merchant, &10);
        assert_eq!(res.unwrap_err().unwrap(), VoucherError::RegionNotApproved);

        // Right category and region: passes.
        let mut in_scope = sample_voucher(&env, recipient.clone(), 100, 0);
        in_scope.category = Symbol::new(&env, "clinics");
        in_scope.region = Symbol::new(&env, "lagos");
        seed_voucher(&env, &contract_id, 22, &in_scope);
        let v = client.can_redeem(&22, &recipient, &merchant, &10);
        assert_eq!(v.spent, 0);
    }

    #[test]
    fn unscoped_merchant_accepts_any_category_or_region() {
        // A merchant with no `set_merchant_scope` call (the default after
        // registration) must remain unrestricted — this is what keeps
        // `merchant_gating` and the other pre-existing tests valid without
        // every one of them having to configure a scope.
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _, contract_id, client) = setup(&env);
        let recipient = Address::generate(&env);
        let merchant = Address::generate(&env);
        client.set_merchant(&admin, &merchant, &true);

        seed_voucher(
            &env,
            &contract_id,
            23,
            &sample_voucher(&env, recipient.clone(), 100, 0),
        );
        let v = client.can_redeem(&23, &recipient, &merchant, &10);
        assert_eq!(v.spent, 0);
    }

    #[test]
    fn oracle_role_is_admin_gated_and_revocable() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _, _, client) = setup(&env);
        let scanner = Address::generate(&env);

        assert!(!client.is_oracle(&scanner));
        client.set_oracle(&admin, &scanner, &true);
        assert!(client.is_oracle(&scanner));
        client.set_oracle(&admin, &scanner, &false);
        assert!(!client.is_oracle(&scanner));
    }

    #[test]
    fn non_admin_cannot_grant_oracle_role() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, _, _, client) = setup(&env);
        let not_admin = Address::generate(&env);
        let scanner = Address::generate(&env);

        let res = client.try_set_oracle(&not_admin, &scanner, &true);
        assert_eq!(res.unwrap_err().unwrap(), VoucherError::NotAdmin);
    }

    #[test]
    fn only_a_granted_oracle_can_flag_a_merchant_or_post_an_anomaly() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _, contract_id, client) = setup(&env);
        let scanner = Address::generate(&env);
        let impostor = Address::generate(&env);
        let merchant = Address::generate(&env);
        let recipient = Address::generate(&env);

        seed_voucher(
            &env,
            &contract_id,
            42,
            &sample_voucher(&env, recipient, 100, 0),
        );

        // Not yet granted the role — both calls are rejected.
        let reason = Symbol::new(&env, "sybil");
        let res = client.try_flag_merchant(&impostor, &merchant, &reason);
        assert_eq!(res.unwrap_err().unwrap(), VoucherError::NotOracle);
        let res = client.try_post_anomaly(&impostor, &42, &80, &reason);
        assert_eq!(res.unwrap_err().unwrap(), VoucherError::NotOracle);

        // Grant the role, then both calls succeed — and are purely
        // informational: `is_merchant` and `voucher_info` are unchanged.
        client.set_oracle(&admin, &scanner, &true);
        client.flag_merchant(&scanner, &merchant, &reason);
        client.post_anomaly(&scanner, &42, &80, &reason);
        assert!(!client.is_merchant(&merchant));
        assert!(!client.voucher_info(&42).unwrap().frozen);
    }

    #[test]
    fn post_anomaly_rejects_an_unknown_voucher() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _, _, client) = setup(&env);
        let scanner = Address::generate(&env);
        client.set_oracle(&admin, &scanner, &true);

        let res = client.try_post_anomaly(&scanner, &999, &50, &Symbol::new(&env, "velocity"));
        assert_eq!(res.unwrap_err().unwrap(), VoucherError::NotFound);
    }
}
