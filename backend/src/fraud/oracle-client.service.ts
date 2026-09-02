import { Injectable, Logger } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { StellarService } from '../stellar/stellar.service';

/**
 * Signs and submits the two oracle-role contract calls (`flag_merchant`,
 * `post_anomaly` — see the "Anomaly oracle" module doc in
 * contracts/src/lib.rs) as a dedicated on-chain identity, distinct from the
 * treasury/admin key.
 *
 * Why a separate key: `AnomalyScannerService` runs continuously against
 * untrusted, attacker-influenceable input (whatever transaction volume flows
 * through the contract). If it signed with the treasury key, a bug or
 * compromise in the scanner would be a bug or compromise in
 * `issue_voucher`/`burn_expired`/every admin call. Signing with a key that
 * has only ever been granted the oracle role (via `set_oracle`, called
 * separately by an admin using the treasury key) means the worst a
 * compromised scanner can do is publish false `flagged`/`anomaly` events —
 * which move no funds and change no on-chain state by themselves (see the
 * contract doc: "AI proposes, admin decides").
 *
 * Fails closed: every method throws immediately if `AID_ORACLE_SIGNING_SECRET`
 * or `AID_VOUCHER_CONTRACT_ID` aren't configured, rather than silently
 * no-op'ing — a misconfigured scanner should be loud, not quietly inert.
 */
@Injectable()
export class OracleClientService {
  private readonly logger = new Logger(OracleClientService.name);

  constructor(private readonly stellar: StellarService) {}

  private get contractId(): string {
    const id = process.env.AID_VOUCHER_CONTRACT_ID;
    if (!id) throw new Error('AID_VOUCHER_CONTRACT_ID is not configured');
    return id;
  }

  private get oracleKeypair(): Keypair {
    const secret = process.env.AID_ORACLE_SIGNING_SECRET;
    if (!secret) {
      throw new Error('AID_ORACLE_SIGNING_SECRET is not configured');
    }
    return Keypair.fromSecret(secret);
  }

  get oraclePublicKey(): string {
    return this.oracleKeypair.publicKey();
  }

  /** True only when both the oracle key and the contract id are configured — lets the scanner no-op quietly rather than crash the app at boot. */
  get isConfigured(): boolean {
    return Boolean(process.env.AID_ORACLE_SIGNING_SECRET && process.env.AID_VOUCHER_CONTRACT_ID);
  }

  async flagMerchant(merchant: string, reason: string): Promise<{ hash: string; status: string }> {
    const oracle = this.oracleKeypair;
    const resp = await this.stellar.signAndSubmitAs(oracle, this.contractId, 'flag_merchant', [
      oracle.publicKey(),
      merchant,
      reason,
    ]);
    this.logger.log(`flag_merchant(${merchant}, ${reason}) -> ${resp.status}`);
    return { hash: resp.hash, status: resp.status };
  }

  async postAnomaly(
    voucherId: number,
    score: number,
    reason: string,
  ): Promise<{ hash: string; status: string }> {
    const oracle = this.oracleKeypair;
    const resp = await this.stellar.signAndSubmitAs(oracle, this.contractId, 'post_anomaly', [
      oracle.publicKey(),
      voucherId,
      score,
      reason,
    ]);
    this.logger.log(`post_anomaly(${voucherId}, ${score}, ${reason}) -> ${resp.status}`);
    return { hash: resp.hash, status: resp.status };
  }
}
