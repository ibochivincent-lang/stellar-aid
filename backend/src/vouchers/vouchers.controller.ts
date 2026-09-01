import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import {
  IssueVoucherDto,
  SpendVoucherDto,
  VouchersService,
} from './vouchers.service';

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

  // Locks treasury funds on-chain — admin-only. See AdminGuard for the
  // (interim) auth model; the recipient never needs to sign this, only the
  // server's own treasury key does, so no admin key comes from the client.
  @Post()
  @UseGuards(AdminGuard)
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
  @UseGuards(AdminGuard)
  burn(@Param('id') _id: string, @Body('voucherId', ParseIntPipe) voucherId: number) {
    return this.vouchers.burnExpired(voucherId);
  }
}