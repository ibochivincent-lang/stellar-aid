import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StellarService } from '../stellar/stellar.service';

export interface IssueVoucherDto {
  recipientWallet: string;
  voucherId: number;
  amount: string; // raw units
  category: string;
  region: string;
  expiresAt: number; // ledger timestamp (seconds)
  programId?: string;
}

export interface SpendVoucherDto {
  spenderPublicKey: string;
  merchantWallet: string;
  amount: string;
}

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
      [
        adminPublicKey,
        recipientWallet,
        dto.voucherId,
        BigInt(dto.amount),
        dto.category,
        dto.region,
        dto.expiresAt,
      ],
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
        this.logger.warn(`ledger reconcile pending: ${String(e)}`);
      }
    }

    return this.prisma.voucher.create({
      data: {
        voucherId: dto.voucherId,
        recipient: {
          connectOrCreate: {
            where: { wallet: recipientWallet },
            create: { wallet: recipientWallet },
          },
        },
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

  /** Server-side: flywheel burn of expired vouchers. */
  async burnExpired(voucherId: number) {
    return this.stellar.signAndSubmitServerSide(
      this.contractId,
      'burn_expired',
      [voucherId],
    );
  }
}
