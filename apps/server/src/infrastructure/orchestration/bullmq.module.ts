import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BullmqService } from './bullmq.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' },
        // SPEC 03 §4.2：LLM job 默认 5 次重试 + 指数退避 1s→32s。defaultJobOptions 必须配在
        // producer 端的 Queue 实例上,worker 端配的等价配置不会反向影响 server enqueue 的 job。
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
        },
      }),
    }),
    BullModule.registerQueue({ name: 'llm' }, { name: 'probe' }),
  ],
  providers: [BullmqService],
  exports: [BullmqService],
})
export class BullmqOrchestrationModule {}
