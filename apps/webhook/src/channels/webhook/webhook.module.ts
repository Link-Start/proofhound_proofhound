import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { BullmqOrchestrationModule } from '../../infrastructure/orchestration/bullmq.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { WebhookController } from './webhook.controller';
import { WebhookRepository } from './webhook.repository';
import { WebhookService } from './webhook.service';

@Module({
  imports: [DatabaseModule, BullmqOrchestrationModule, RedisModule],
  controllers: [WebhookController],
  providers: [WebhookRepository, WebhookService],
})
export class WebhookModule {}
