import { Body, Controller, Get, Headers, HttpCode, Logger, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AssistantService } from '../ai/assistant.service';
import { ChatDto } from '../ai/dto/chat.dto';
import { X402VerificationService } from './x402-verification.service';

/**
 * x402 (HTTP 402 "Payment Required") — paid endpoints for the agent
 * economy: `/data/aid-summary` (analytics) and `/data/chat` (the citizen
 * AI assistant, streamed).
 *
 * Flow (per x402 spec), identical for both:
 *  1. Caller requests the endpoint with NO payment.
 *  2. We respond `402` + `x402-price` / `location` (payment reference).
 *  3. Caller authorizes a USDC payment on Stellar (small amount).
 *  4. Caller retries the request carrying the payment proof header.
 *  5. We verify the proof (`X402VerificationService`, against
 *     `X402_VERIFIER_URL`) and serve the data.
 */
@Controller('data')
export class X402Controller {
  private readonly logger = new Logger(X402Controller.name);
  private readonly price = process.env.X402_PRICE_AMOUNT ?? '0.01';
  private readonly asset = process.env.X402_PRICE_ASSET ?? 'USDC';
  private readonly chatPrice = process.env.X402_CHAT_PRICE_AMOUNT ?? this.price;

  constructor(
    private readonly x402: X402VerificationService,
    private readonly assistant: AssistantService,
  ) {}

  private requirePaymentBody(req: Request, res: Response, price: string) {
    res
      .set('x402-price', price)
      .set('x402-asset', this.asset)
      .set('location', `${req.protocol}://${req.get('host')}${req.originalUrl}?pay=1`);
    return { requiresPayment: true, price, asset: this.asset };
  }

  @Get('aid-summary')
  @HttpCode(402)
  async paidSummary(
    @Headers('x402-proof') proof: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!proof) {
      return this.requirePaymentBody(req, res, this.price);
    }
    const verified = await this.x402.verifyProof(proof, this.price, this.asset);
    if (!verified) {
      return this.requirePaymentBody(req, res, this.price);
    }

    res.status(200);
    // TODO(ROADMAP Phase 1/3): these are still placeholder figures, not a
    // real Prisma aggregate — tracked separately from this AI-assistant
    // pass, which only added the /chat endpoint below.
    return {
      data: {
        programsActive: 12,
        vouchersInCirculation: 48_500,
        burnRatePct: 3.2,
        fraudFreezeEvents: 7,
      },
    };
  }

  /**
   * Paid, streamed chat with the citizen assistant (see `ai/assistant.service.ts`).
   * Streams over Server-Sent Events once payment is verified — see that
   * file's doc comment for why SSE rather than the Vercel AI SDK.
   */
  @Post('chat')
  async chat(
    @Headers('x402-proof') proof: string | undefined,
    @Body() dto: ChatDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!proof) {
      res.status(402).json(this.requirePaymentBody(req, res, this.chatPrice));
      return;
    }
    const verified = await this.x402.verifyProof(proof, this.chatPrice, this.asset);
    if (!verified) {
      res.status(402).json(this.requirePaymentBody(req, res, this.chatPrice));
      return;
    }

    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    try {
      for await (const token of this.assistant.answer(dto.wallet, dto.question)) {
        res.write(`data: ${JSON.stringify({ delta: token })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
    } catch (e) {
      this.logger.error(`chat stream failed: ${e}`);
      res.write(`data: ${JSON.stringify({ error: 'assistant failed to respond' })}\n\n`);
    } finally {
      res.end();
    }
  }
}