import { Injectable, Logger } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../common/prisma.service';
import { StellarService } from '../stellar/stellar.service';
import { SetMerchantDto } from './dto/set-merchant.dto';
import { SetMerchantScopeDto } from './dto/set-merchant-scope.dto';

/**
 * Merchant admin: registers/toggles merchants and sets the category/region
 * scope the contract's `can_redeem` enforces on-chain (see
 * `set_merchant` / `set_merchant_scope` / `merchant_info` in
 * contracts/src/lib.rs). Prisma's `Merchant` table is a read model kept in
 * sync alongside the on-chain call — the contract remains the source of
 * truth for whether a redemption is actually allowed.
 */
@Injectable()
export class MerchantsService {
  private readonly logger = new Logger(MerchantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly auditLog: AuditLogService,
  ) {}

  get contractId(): string {
    return process.env.AID_VOUCHER_CONTRACT_ID!;
  }

  async list() {
    return this.prisma.merchant.findMany({ orderBy: { onCreate: 'desc' }, take: 200 });
  }

  async setMerchant(dto: SetMerchantDto) {
    const adminPublicKey = this.stellar.treasuryPublicKey;
    const resp = await this.stellar.signAndSubmitServerSide(this.contractId, 'set_merchant', [
      adminPublicKey,
      dto.wallet,
      dto.active,
    ]);
    if (resp.status !== 'PENDING' && resp.status !== 'DUPLICATE') {
      throw new Error(`on-chain set_merchant failed: ${resp.status}`);
    }

    const merchant = await this.prisma.merchant.upsert({
      where: { wallet: dto.wallet },
      update: { active: dto.active, name: dto.name, region: dto.region },
      create: { wallet: dto.wallet, active: dto.active, name: dto.name, region: dto.region },
    });

    await this.auditLog.record({
      actor: adminPublicKey,
      action: 'merchant.set',
      entityType: 'Merchant',
      entityId: merchant.id,
      metadata: { wallet: dto.wallet, active: dto.active, txHash: resp.hash },
    });

    return merchant;
  }

  /** Restricts (or clears, with empty arrays) which categories/regions this merchant may redeem. */
  async setScope(dto: SetMerchantScopeDto) {
    const adminPublicKey = this.stellar.treasuryPublicKey;
    const resp = await this.stellar.signAndSubmitServerSide(
      this.contractId,
      'set_merchant_scope',
      [adminPublicKey, dto.wallet, dto.categories, dto.regions],
    );
    if (resp.status !== 'PENDING' && resp.status !== 'DUPLICATE') {
      throw new Error(`on-chain set_merchant_scope failed: ${resp.status}`);
    }

    await this.auditLog.record({
      actor: adminPublicKey,
      action: 'merchant.set_scope',
      entityType: 'Merchant',
      entityId: dto.wallet,
      metadata: { categories: dto.categories, regions: dto.regions, txHash: resp.hash },
    });

    return { wallet: dto.wallet, categories: dto.categories, regions: dto.regions, txHash: resp.hash };
  }

  /** Reads the on-chain profile directly — the live source of truth for what `can_redeem` will do. */
  async info(wallet: string) {
    return this.stellar.read(this.contractId, this.stellar.treasuryPublicKey, 'merchant_info', [wallet]);
  }
}
