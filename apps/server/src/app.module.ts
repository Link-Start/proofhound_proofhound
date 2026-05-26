import { Module } from '@nestjs/common';
import { ContractsModule } from './common/contracts/contracts.module';
import { HealthController } from './common/health.controller';
import { HealthService } from './common/health.service';
import { ProjectContextModule } from './common/project-context.module';
import { ConfigModule } from './config/config.module';
import { CryptoModule } from './infrastructure/crypto/crypto.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { OrchestrationModule } from './infrastructure/orchestration';
import { RedisModule } from './infrastructure/redis/redis.module';
import { OptimizationModule } from './modules/optimization/optimization.module';
import { ConnectorModule } from './modules/connector/connector.module';
import { DatasetModule } from './modules/dataset/dataset.module';
import { ExperimentModule } from './modules/experiment/experiment.module';
import { ModelModule } from './modules/model/model.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { AnnotationModule } from './modules/annotation/annotation.module';
import { CanaryReleaseModule } from './modules/canary-release/canary-release.module';
import { ProductionReleaseModule } from './modules/production-release/production-release.module';
import { PromptModule } from './modules/prompt/prompt.module';
import { QuickStartModule } from './modules/quick-start/quick-start.module';
import { ReleaseLineModule } from './modules/release-line/release-line.module';
import { RunResultModule } from './modules/run-result/run-result.module';
import { TokenModule } from './modules/token/token.module';

@Module({
  imports: [
    ConfigModule,
    ContractsModule,
    ProjectContextModule,
    CryptoModule,
    DatabaseModule,
    OrchestrationModule,
    RedisModule,
    ModelModule,
    MonitoringModule,
    AnnotationModule,
    DatasetModule,
    PromptModule,
    RunResultModule,
    TokenModule,
    ExperimentModule,
    OptimizationModule,
    QuickStartModule,
    ReleaseLineModule,
    ConnectorModule,
    CanaryReleaseModule,
    ProductionReleaseModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
