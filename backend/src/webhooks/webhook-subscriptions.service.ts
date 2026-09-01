import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { CreateWebhookSubscriptionDto } from './dto/create-webhook-subscription.dto';
import { assertSafeWebhookUrl } from './ssrf-guard';

interface SubscriptionRow {
  id: string;
  url: string;
  secret: string;
  eventTypes: string[];
  active: boolean;
  createdAt: Date;
}

@Injectable()
export class WebhookSubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const subs: SubscriptionRow[] = await this.prisma.webhookSubscription.findMany({
      orderBy: { createdAt: 'desc' },
    });
    // Never return signing secrets once issued.
    return subs.map(({ secret: _secret, ...rest }: SubscriptionRow) => rest);
  }

  /** Returns the plaintext secret once, at creation — it is never retrievable again. */
  async create(dto: CreateWebhookSubscriptionDto) {
    await assertSafeWebhookUrl(dto.url);
    const secret = randomBytes(32).toString('hex');
    const sub = await this.prisma.webhookSubscription.create({
      data: { url: dto.url, eventTypes: dto.eventTypes ?? [], secret },
    });
    return { ...sub, secret };
  }

  async deactivate(id: string) {
    return this.prisma.webhookSubscription.update({ where: { id }, data: { active: false } });
  }
}
