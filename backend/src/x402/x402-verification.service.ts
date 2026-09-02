import { Injectable, Logger } from '@nestjs/common';

/**
 * Shared x402 payment-proof verification, pulled out of `X402Controller`
 * so a second paid endpoint (`/data/chat`, see `ai/`) doesn't duplicate
 * the "call the configured verifier, fail closed if unconfigured" logic —
 * both routes must behave identically here, so there's exactly one place
 * that decides what counts as a valid payment.
 */
@Injectable()
export class X402VerificationService {
  private readonly logger = new Logger(X402VerificationService.name);
  private readonly verifierUrl = process.env.X402_VERIFIER_URL;

  async verifyProof(proof: string, price: string, asset: string): Promise<boolean> {
    if (!this.verifierUrl) {
      this.logger.error('X402_VERIFIER_URL is not configured — rejecting all proofs');
      return false;
    }
    try {
      const resp = await fetch(this.verifierUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proof, price, asset }),
      });
      if (!resp.ok) return false;
      const body = (await resp.json()) as { verified?: boolean };
      return body.verified === true;
    } catch (e) {
      this.logger.warn(`x402 proof verification failed: ${e}`);
      return false;
    }
  }
}
