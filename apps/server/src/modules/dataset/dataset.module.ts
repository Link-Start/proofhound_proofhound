import { Module } from '@nestjs/common';
import { LocalActorGuard } from '../../common/guards/local-actor.guard';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { DatasetController } from './dataset.controller';
import { DatasetRepository } from './dataset.repository';
import { DatasetService } from './dataset.service';

@Module({
  imports: [DatabaseModule],
  controllers: [DatasetController],
  providers: [DatasetRepository, DatasetService, LocalActorGuard],
  exports: [DatasetService],
})
export class DatasetModule {}
