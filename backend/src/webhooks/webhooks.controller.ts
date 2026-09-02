import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  create(@Body() dto: CreateWebhookSubscriptionDto) {
    return this.subscriptions.create(dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  deactivate(@Param('id') id: string) {
    return this.subscriptions.deactivate(id);
  }
}
