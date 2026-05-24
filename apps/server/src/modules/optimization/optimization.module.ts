import { Module } from '@nestjs/common';
import { LocalActorGuard } from '../../common/guards/local-actor.guard';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { DrizzleRunResultWriter } from '../../infrastructure/llm/run-result-writer';
import { OrchestrationModule } from '../../infrastructure/orchestration/orchestration.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { ExperimentModule } from '../experiment/experiment.module';
import { PromptModule } from '../prompt/prompt.module';
import { RunResultModule } from '../run-result/run-result.module';
import { OptimizationController } from './optimization.controller';
import { OptimizationLauncher } from './optimization.launcher';
import { OptimizationRecoveryService } from './optimization.recovery';
import { OptimizationRepository } from './optimization.repository';
import { OptimizationService } from './optimization.service';
import { OptimizationWorkflowRegistrar } from './optimization.workflow';

@Module({
  imports: [DatabaseModule, OrchestrationModule, RedisModule, ExperimentModule, PromptModule, RunResultModule],
  controllers: [OptimizationController],
  providers: [
    OptimizationRepository,
    OptimizationService,
    OptimizationWorkflowRegistrar,
    OptimizationLauncher,
    OptimizationRecoveryService,
    DrizzleRunResultWriter,
    LocalActorGuard,
  ],
  exports: [OptimizationService],
})
export class OptimizationModule {}
