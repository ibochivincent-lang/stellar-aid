import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AssistantService } from './assistant.service';
import { RedactionService } from './redaction.service';
import { RetrievalService } from './retrieval.service';
import { VectorStoreService } from './vector-store.service';

@Module({
  providers: [AssistantService, RetrievalService, RedactionService, VectorStoreService, PrismaService],
  exports: [AssistantService],
})
export class AiModule {}
