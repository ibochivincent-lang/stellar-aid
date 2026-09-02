import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EventsModule } from '../events/events.module';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [EventsModule],
  controllers: [WebhooksController],
  providers: [WebhookSubscriptionsService, WebhookDeliveryService, PrismaService],
})
export class WebhooksModule {}
