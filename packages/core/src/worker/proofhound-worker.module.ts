import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LlmConsumer, llmConsumerProviders } from './consumers/llm.consumer';
import { ProbeConsumer } from './consumers/probe.consumer';
import { DatabaseModule } from './infrastructure/database/database.module';
import { RedisModule } from './infrastructure/redis/redis.module';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' },
        defaultJobOptions: {
          // SPEC 03 §4.2: LLM jobs use 5 retries + exponential backoff 1s→32s by default; capped at 5 min
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
        },
      }),
    }),
    BullModule.registerQueue({ name: 'llm' }, { name: 'probe' }),
  ],
  providers: [...llmConsumerProviders, LlmConsumer, ProbeConsumer],
})
export class WorkerModule {}
