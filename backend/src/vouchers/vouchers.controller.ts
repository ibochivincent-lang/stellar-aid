import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { IssueVoucherDto } from './dto/issue-voucher.dto';
import { SpendVoucherDto } from './dto/spend-voucher.dto';
import { VouchersService } from './vouchers.service';

@Controller('vouchers')
export class VouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @Get()
  list(@Query('programId') programId?: string) {
    return this.vouchers.list(programId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.vouchers.get(id);
  }

  // Locks treasury funds on-chain — admin-only. The recipient never needs
  // to sign this, only the server's own treasury key does, so no admin key
  // comes from the client. Send an `Idempotency-Key` header so a retried
  // request (e.g. after a timeout) replays the original result instead of
  // locking funds for a second voucher.
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(IdempotencyInterceptor)
  issue(@Body() dto: IssueVoucherDto) {
    return this.vouchers.issue(dto);
  }

  @Post(':id/spend')
  spend(@Param('id') id: string, @Body() dto: SpendVoucherDto) {
    return this.vouchers.buildSpend(id, dto);
  }

  // Permissionless on-chain (anyone may burn an expired voucher), but the
  // backend still spends its own treasury fee to submit it, so gate the
  // HTTP trigger to admins/automation rather than letting any caller spam it.
  @Post(':id/burn')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  burn(@Param('id') _id: string, @Body('voucherId', ParseIntPipe) voucherId: number) {
    return this.vouchers.burnExpired(voucherId);
  }
}