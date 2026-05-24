import { Module } from '@nestjs/common';
import { LocalActorGuard } from '../../common/guards/local-actor.guard';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { OptimizationModule } from '../optimization/optimization.module';
import { DatasetModule } from '../dataset/dataset.module';
import { ModelModule } from '../model/model.module';
import { QuickStartController } from './quick-start.controller';
import { QuickStartService } from './quick-start.service';

@Module({
  imports: [DatabaseModule, DatasetModule, ModelModule, OptimizationModule],
  controllers: [QuickStartController],
  providers: [QuickStartService, LocalActorGuard],
  exports: [QuickStartService],
})
export class QuickStartModule {}
