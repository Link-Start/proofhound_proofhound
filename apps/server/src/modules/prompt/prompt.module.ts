import { Module } from '@nestjs/common';
import { LocalActorGuard } from '../../common/guards/local-actor.guard';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { PromptTryRunService } from './prompt-try-run.service';
import { PromptController } from './prompt.controller';
import { PromptRepository } from './prompt.repository';
import { PromptService } from './prompt.service';

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [PromptController],
  providers: [PromptRepository, PromptService, PromptTryRunService, LocalActorGuard],
  exports: [PromptService, PromptRepository],
})
export class PromptModule {}
