import { Module } from '@nestjs/common';
import { WebhookModule } from './channels/webhook/webhook.module';
import { HealthController } from './common/health.controller';
import { HealthService } from './common/health.service';
import { DatabaseModule } from './infrastructure/database/database.module';
import { RedisModule } from './infrastructure/redis/redis.module';

@Module({
  imports: [DatabaseModule, RedisModule, WebhookModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class WebhookAppModule {}
