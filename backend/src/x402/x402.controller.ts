import { Controller, Get, Headers, HttpCode, Logger, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * x402 (HTTP 402 "Payment Required") — paid endpoint for the agent economy.
 *
 * Flow (per x402 spec):
 *  1. Agent GETs `/data/aid-summary` with NO payment.
 *  2. We respond `402` + `x402-price` / `location` (payment reference).
 *  3. Agent authorizes a USDC payment on Stellar (small amount).
 *  4. Agent retries the request carrying the payment proof header.
 *  5. We verify the proof against X402_VERIFIER_URL and serve the data.
 *
 * NOTE: without step 5 actually checking the proof, ANY non-empty
 * `x402-proof` header unlocks the paid data for free. That was the
 * previous behaviour here (a TODO stood in for verification) — fixed below.
 */
@Controller('data')
export class X402Controller {
  private readonly logger = new Logger(X402Controller.name);
  private readonly price = process.env.X402_PRICE_AMOUNT ?? '0.01';
  private readonly asset = process.env.X402_PRICE_ASSET ?? 'USDC';
  private readonly verifierUrl = process.env.X402_VERIFIER_URL;

  @Get('aid-summary')
  @HttpCode(402)
  async paidSummary(
    @Headers('x402-proof') proof: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const requirePayment = () => {
      res
        .set('x402-price', this.price)
        .set('x402-asset', this.asset)
        .set(
          'location',
          `${req.protocol}://${req.get('host')}${req.originalUrl}?pay=1`,
        );
      return { requiresPayment: true, price: this.price, asset: this.asset };
    };

    if (!proof) {
      return requirePayment();
    }

    const verified = await this.verifyProof(proof);
    if (!verified) {
      return requirePayment();
    }

    res.status(200);
    return {
      data: {
        programsActive: 12,
        vouchersInCirculation: 48_500,
        burnRatePct: 3.2,
        fraudFreezeEvents: 7,
      },
    };
  }

  /** Verifies an x402 payment proof against the configured verifier service. */
  private async verifyProof(proof: string): Promise<boolean> {
    if (!this.verifierUrl) {
      this.logger.error('X402_VERIFIER_URL is not configured — rejecting all proofs');
      return false;
    }
    try {
      const resp = await fetch(this.verifierUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          proof,
          price: this.price,
          asset: this.asset,
        }),
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