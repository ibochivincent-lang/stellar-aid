import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { RedactionService } from './redaction.service';

/** Everything the assistant is allowed to know about one citizen's voucher(s). */
export interface CitizenContext {
  vouchers: Array<{
    voucherId: number;
    category: string;
    region: string;
    expiresAt: string;
    onChainStatus: string;
    programName: string;
    programCurrency: string;
  }>;
  /** Active merchants in the same region as at least one of the citizen's vouchers. */
  merchants: Array<{ name: string; region: string }>;
}

/**
 * Structured (non-semantic) retrieval over the read model: exactly the
 * data needed to answer "what can I spend this on / when does it expire /
 * is my voucher still active" — deterministically, from Prisma, with no
 * model call involved in fetching it.
 *
 * Deliberately excludes every financial field (`amount`, `spent`,
 * `totalBudget`, `spentBudget`) at the query level — the `select` clauses
 * below simply never ask Prisma for them. `RedactionService.stripFinancialFields`
 * in `assistant.service.ts` is the second, defense-in-depth layer on top
 * of that; this is the first one, and arguably the more important one,
 * since it means the sensitive data never leaves the database at all.
 *
 * Known gap (tracked in ROADMAP.md): the Prisma `Merchant` model doesn't
 * carry the category restriction that only lives on-chain in
 * `MerchantProfile` (see `contracts/src/lib.rs` / `MerchantsService.info`),
 * so merchant matching here is region-only, not category+region. A
 * citizen asking "which merchants take my food voucher" gets a list of
 * merchants in their voucher's region, not yet filtered further by
 * whether that specific merchant actually accepts the "food" category —
 * good enough for an MVP answer, not the final word (the contract's
 * `can_redeem` is still what actually enforces this at spend time).
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redaction: RedactionService,
  ) {}

  async forCitizen(wallet: string): Promise<CitizenContext> {
    const user = await this.prisma.user.findUnique({ where: { wallet } });
    if (!user) {
      return { vouchers: [], merchants: [] };
    }

    const vouchers = await this.prisma.voucher.findMany({
      where: { recipientId: user.id },
      select: {
        voucherId: true,
        category: true,
        region: true,
        expiresAt: true,
        onChainStatus: true,
        program: { select: { name: true, currency: true } },
        // amount/spent deliberately not selected — see class doc.
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const regions = [...new Set(vouchers.map((v: { region: string }) => v.region))] as string[];
    const merchants = regions.length
      ? await this.prisma.merchant.findMany({
          where: { active: true, region: { in: regions } },
          select: { name: true, region: true },
          take: 50,
        })
      : [];

    return {
      vouchers: vouchers.map(
        (v: {
          voucherId: number;
          category: string;
          region: string;
          expiresAt: Date;
          onChainStatus: string;
          program: { name: string; currency: string };
        }) => ({
          voucherId: v.voucherId,
          category: v.category,
          region: v.region,
          expiresAt: v.expiresAt.toISOString(),
          onChainStatus: v.onChainStatus,
          programName: v.program.name,
          programCurrency: v.program.currency,
        }),
      ),
      merchants,
    };
  }

  /**
   * Serializes a `CitizenContext` into the block of text handed to the
   * model as grounding — running it through `stripFinancialFields` even
   * though nothing here should carry a financial field already, as the
   * guardrail this file's doc comment describes.
   */
  toPromptContext(context: CitizenContext): string {
    const safe = this.redaction.stripFinancialFields(context);
    return JSON.stringify(safe, null, 2);
  }
}
