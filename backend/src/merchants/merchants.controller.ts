import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SetMerchantDto } from './dto/set-merchant.dto';
import { SetMerchantScopeDto } from './dto/set-merchant-scope.dto';
import { MerchantsService } from './merchants.service';

@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  list() {
    return this.merchants.list();
  }

  @Get(':wallet/info')
  info(@Param('wallet') wallet: string) {
    return this.merchants.info(wallet);
  }

  // Registers/toggles a merchant on-chain and mirrors it into the read model.
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  setMerchant(@Body() dto: SetMerchantDto) {
    return this.merchants.setMerchant(dto);
  }

  // Restricts which voucher categories/regions this merchant may redeem
  // (empty arrays clear the restriction — see SetMerchantScopeDto).
  @Post('scope')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  setScope(@Body() dto: SetMerchantScopeDto) {
    return this.merchants.setScope(dto);
  }
}
