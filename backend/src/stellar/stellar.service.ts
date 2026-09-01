import { Injectable, Logger } from '@nestjs/common';
import {
  Account,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  nativeToScVal,
  rpc as SorobanRpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

/**
 * Thin Stellar adapter over `@stellar/stellar-sdk` (Protocol 28 branch).
 *
 * Paths:
 *  - read ledger state:  Horizon (balances/history)
 *  - preview a contract call: Soroban RPC `simulateTransaction`
 *  - write: build -> (client OR server) sign -> submit -> await ledger
 *
 * SDK v16 note: `stellar-base` was merged into `@stellar/stellar-sdk`,
 * so all imports come from the single package. The Soroban RPC namespace
 * is exported as the lowercase `rpc` in this version (aliased to
 * `SorobanRpc` below to keep the rest of this file's naming stable) —
 * there is no `SorobanRpc` export.
 */
@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  readonly horizon: Horizon.Server;
  readonly rpc: SorobanRpc.Server;

  constructor() {
    const horizonUrl =
      process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
    const rpcUrl = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
    this.horizon = new Horizon.Server(horizonUrl);
    this.rpc = new SorobanRpc.Server(rpcUrl);
  }

  get networkPassphrase(): string {
    return (
      process.env.STELLAR_NETWORK_PASSPHRASE ??
      'Test SDF Network ; September 2015'
    );
  }

  private get treasuryKeypair(): Keypair {
    const secret = process.env.STELLAR_SIGNING_SECRET;
    if (!secret) {
      throw new Error('STELLAR_SIGNING_SECRET is not configured');
    }
    return Keypair.fromSecret(secret);
  }

  /**
   * The server treasury's own public key, derived from `STELLAR_SIGNING_SECRET`.
   * Server-signed admin operations must always build against this account —
   * never a caller-supplied public key, which would let a request build a
   * transaction for one account while it gets signed by another (a mismatch
   * that fails on submit at best, and is a spoofable admin surface at worst).
   */
  get treasuryPublicKey(): string {
    return this.treasuryKeypair.publicKey();
  }

  async loadAccount(publicKey: string): Promise<Account> {
    const acc = await this.horizon.loadAccount(publicKey);
    return new Account(acc.accountId(), acc.sequenceNumber());
  }

  // ------------------------------------------------------------------
  // Contract invocation building
  // ------------------------------------------------------------------

  buildOperation(contractId: string, method: string, args: unknown[]): xdr.Operation {
    const contract = new Contract(contractId);
    const scArgs = (args ?? []).map((a) => nativeToScVal(a));
    return contract.call(method, ...scArgs);
  }

  async buildTransaction(publicKey: string, operation: xdr.Operation) {
    const account = await this.loadAccount(publicKey);
    return new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(operation)
      .build();
  }

  /**
   * Builds the transaction and previews the call. Returns both — callers
   * that go on to submit need the original (unassembled) `tx` as well as
   * the simulation, since `assembleTransaction` takes both.
   */
  private async buildAndSimulate(
    contractId: string,
    publicKey: string,
    method: string,
    args: unknown[],
  ) {
    const op = this.buildOperation(contractId, method, args);
    const tx = await this.buildTransaction(publicKey, op);
    const resp = await this.rpc.simulateTransaction(tx);
    if (!SorobanRpc.Api.isSimulationSuccess(resp)) {
      const reason = SorobanRpc.Api.isSimulationError(resp) ? resp.error : JSON.stringify(resp);
      throw new Error(`Simulation failed: ${reason}`);
    }
    return { tx, sim: resp };
  }

  /** Preview a contract call. Returns the simulation (success carries a return value). */
  async simulate(contractId: string, publicKey: string, method: string, args: unknown[]) {
    const { sim } = await this.buildAndSimulate(contractId, publicKey, method, args);
    return sim;
  }

  /** Read-only query: simulate and decode the return value (zero cost, no ledger write). */
  async read(contractId: string, publicKey: string, method: string, args: unknown[]) {
    const sim = await this.simulate(contractId, publicKey, method, args);
    if (sim.result && sim.result.retval) {
      return scValToNative(sim.result.retval);
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Write paths
  // ------------------------------------------------------------------

  /**
   * Server-signed submission — used for Treasury/admin operations
   * (e.g. `issue_voucher`, `set_merchant`, oracle posts, auto-burn).
   *
   * Always builds and signs against the server's own treasury account
   * (`treasuryPublicKey`) — never a caller-supplied public key. Accepting an
   * arbitrary public key here previously meant the transaction was built for
   * whatever account the caller named but signed with the server's real key,
   * which fails Soroban's signature check unless they happen to match, and
   * is a spoofable admin surface if they're ever assumed to.
   */
  async signAndSubmitServerSide(contractId: string, method: string, args: unknown[]) {
    const publicKey = this.treasuryPublicKey;
    const { tx: rawTx, sim } = await this.buildAndSimulate(contractId, publicKey, method, args);
    // `assembleTransaction` takes (the original transaction, its simulation)
    // in that order — not the passphrase, and not just the simulation alone.
    const tx = SorobanRpc.assembleTransaction(rawTx, sim).build();
    tx.sign(this.treasuryKeypair);
    const resp = await this.rpc.sendTransaction(tx);
    this.logger.log(`submitted ${method}: ${resp.status}`);
    return resp;
  }

  /**
   * Client-side flow: build and SIMULATE, then return the unsigned XDR so the
   * user's wallet (Freighter / passkey smart account) can sign and submit.
   * The server never touches user funds.
   */
  async buildForClientSign(
    contractId: string,
    publicKey: string,
    method: string,
    args: unknown[],
  ) {
    const { tx: rawTx, sim } = await this.buildAndSimulate(contractId, publicKey, method, args);
    const tx = SorobanRpc.assembleTransaction(rawTx, sim).build().toXDR();
    return { transactionXdr: tx };
  }

  /** Poll Soroban RPC until a submitted (hash) settles. Reconciles our DB. */
  async awaitTransaction(hash: string): Promise<SorobanRpc.Api.GetTransactionResponse> {
    const timeout = Date.now() + 30_000;
    while (Date.now() < timeout) {
      const res = await this.rpc.getTransaction(hash);
      if (res.status === 'SUCCESS' || res.status === 'FAILED') return res;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Transaction ${hash} timed out awaiting finality`);
  }
}