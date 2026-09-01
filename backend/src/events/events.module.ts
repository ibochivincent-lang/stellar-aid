import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EventEngineService } from './event-engine.service';
import { EventsController } from './events.controller';

@Module({
  controllers: [EventsController],
  providers: [EventEngineService, PrismaService],
  exports: [EventEngineService],
})
export class EventsModule {}
