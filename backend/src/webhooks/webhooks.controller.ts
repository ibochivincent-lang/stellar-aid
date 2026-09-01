import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { CreateWebhookSubscriptionDto } from './dto/create-webhook-subscription.dto';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly subscriptions: WebhookSubscriptionsService) {}

  @Get()
  list() {
    return this.subscriptions.list();
  }

  // Admin-only: creating a subscription issues a signing secret and starts
  // delivering voucher event data (recipient/merchant addresses, amounts)
  // to an arbitrary URL, so this isn't self-service.
  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateWebhookSubscriptionDto) {
    return this.subscriptions.create(dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  deactivate(@Param('id') id: string) {
    return this.subscriptions.deactivate(id);
  }
}
