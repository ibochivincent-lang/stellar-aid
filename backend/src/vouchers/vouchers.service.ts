import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../common/prisma.service';
import { StellarService } from '../stellar/stellar.service';
import { IssueVoucherDto } from './dto/issue-voucher.dto';
import { SpendVoucherDto } from './dto/spend-voucher.dto';

/**
 * Voucher service.
 *
 * On-chain is the source of truth; Prisma is the read model for KYC,
 * merchants, programs and redemption history.
 */
@Injectable()
export class VouchersService {
  private readonly logger = new Logger(VouchersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly auditLog: AuditLogService,
  ) {}

  get contractId(): string {
    return process.env.AID_VOUCHER_CONTRACT_ID!;
  }

  async list(programId?: string) {
    return this.prisma.voucher.findMany({
      where: programId ? { programId } : undefined,
      include: { recipient: true, redemptions: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async get(id: string) {
    const voucher = await this.prisma.voucher.findUnique({ where: { id } });
    if (!voucher) throw new NotFoundException('voucher not found');
    return voucher;
  }

  /** Admin server-side: locks USDC into the contract and records the voucher. */
  async issue(dto: IssueVoucherDto) {
    const { recipientWallet } = dto;
    const adminPublicKey = this.stellar.treasuryPublicKey;

    const resp = await this.stellar.signAndSubmitServerSide(
      this.contractId,
      'issue_voucher',
      [adminPublicKey, recipientWallet, dto.voucherId, BigInt(dto.amount), dto.category, dto.region, dto.expiresAt],
    );
    // `sendTransaction`'s status is 'PENDING' | 'DUPLICATE' | 'TRY_AGAIN_LATER' | 'ERROR'
    // — 'SUCCESS' only ever appears in `getTransaction`'s response, once the
    // ledger has actually closed it, so checking for it here was dead code
    // that made this throw on every submission except a bare 'PENDING'.
    // 'DUPLICATE' means Horizon already has this exact tx (e.g. a retried
    // request) and is not itself a failure.
    if (resp.status !== 'PENDING' && resp.status !== 'DUPLICATE') {
      throw new Error(`on-chain issue failed: ${resp.status}`);
    }
    if (resp.hash) {
      try {
        await this.stellar.awaitTransaction(resp.hash);
      } catch (e) {
        this.logger.warn(`ledger reconcile pending: ${e}`);
      }
    }

    const voucher = await this.prisma.voucher.create({
      data: {
        voucherId: dto.voucherId,
        recipient: { connectOrCreate: { where: { wallet: recipientWallet }, create: { wallet: recipientWallet } } },
        program: {
          connectOrCreate: {
            where: { id: dto.programId ?? 'default-program' },
            create: {
              id: dto.programId ?? 'default-program',
              name: 'Default Program',
              totalBudget: BigInt(dto.amount),
            },
          },
        },
        amount: BigInt(dto.amount),
        category: dto.category,
        region: dto.region,
        expiresAt: new Date(dto.expiresAt * 1000),
      },
    });

    // Committing this voucher's amount against the program's budget here —
    // rather than never tracking it at all, which is what happened before
    // this — is what makes `burnExpired` below able to give it back when
    // the voucher expires unspent ("the money doesn't idle" only means
    // something if the read model shows the budget freeing back up).
    // Best-effort bookkeeping on the read model, not atomic with the
    // voucher insert above; on-chain balances remain the source of truth.
    await this.prisma.aidProgram
      .update({
        where: { id: voucher.programId },
        data: { spentBudget: { increment: BigInt(dto.amount) } },
      })
      .catch((e: unknown) => this.logger.warn(`failed to update program spentBudget on issue: ${e}`));

    await this.auditLog.record({
      actor: adminPublicKey,
      action: 'voucher.issue',
      entityType: 'Voucher',
      entityId: voucher.id,
      metadata: {
        voucherId: dto.voucherId,
        recipientWallet,
        amount: dto.amount,
        category: dto.category,
        region: dto.region,
        txHash: resp.hash,
      },
    });

    return voucher;
  }

  /**
   * User-facing spend: build + simulate the redeem call, return the unsigned
   * XDR for the recipient's wallet to sign. Reconciliation happens when the
   * submitted tx hash is confirmed (`recordRedemption`).
   */
  async buildSpend(voucherId: string, dto: SpendVoucherDto) {
    return this.stellar.buildForClientSign(
      this.contractId,
      dto.spenderPublicKey,
      'redeem',
      [dto.spenderPublicKey, dto.merchantWallet, BigInt(dto.amount)],
    );
  }

  /** After a client-submitted spend tx is confirmed, reconcile the DB. */
  async recordRedemption(txHash: string) {
    const res = await this.stellar.awaitTransaction(txHash);
    return { status: res.status };
  }

  /**
   * Server-side: flywheel burn of expired vouchers. The contract already
   * returns any unspent remainder to the treasury on-chain (see
   * `burn_expired` in contracts/src/lib.rs) — this is what makes that
   * refund visible in the read model too: without it, a burned voucher's
   * `AidProgram.spentBudget` stayed inflated forever, understating how much
   * budget was actually still available.
   */
  async burnExpired(voucherId: number) {
    const resp = await this.stellar.signAndSubmitServerSide(this.contractId, 'burn_expired', [voucherId]);

    // NOTE: `voucherId` (the contract's global u32 key) is looked up with
    // `findFirst` rather than a unique lookup — the Prisma schema's
    // `@@unique([programId, voucherId])` on `Voucher` allows the same
    // voucherId to appear under different programs, but the on-chain
    // contract keys `DataKey::Voucher` on voucherId alone, so it must
    // actually be globally unique in practice. That mismatch between the
    // schema and the contract's real key space is worth tightening
    // (`voucherId` should probably be `@unique` on its own), but is
    // unrelated to this fix — flagging it rather than silently relying on
    // "there's usually only one match."
    const voucher = await this.prisma.voucher.findFirst({ where: { voucherId } });
    if (voucher) {
      const remaining = voucher.amount - voucher.spent;
      await this.prisma
        .$transaction([
          this.prisma.voucher.update({
            where: { id: voucher.id },
            data: { onChainStatus: 'BURNED' },
          }),
          this.prisma.aidProgram.update({
            where: { id: voucher.programId },
            data: { spentBudget: { decrement: remaining > 0n ? remaining : 0n } },
          }),
        ])
        .catch((e: unknown) => this.logger.warn(`failed to reconcile burn for voucher ${voucherId}: ${e}`));
    } else {
      this.logger.warn(`burnExpired: no read-model voucher found for voucherId ${voucherId}`);
    }

    await this.auditLog.record({
      actor: this.stellar.treasuryPublicKey,
      action: 'voucher.burn',
      entityType: 'Voucher',
      entityId: String(voucherId),
      metadata: { txHash: resp.hash, status: resp.status },
    });
    return resp;
  }
}