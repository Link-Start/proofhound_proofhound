import { Module } from '@nestjs/common';
import { LocalActorGuard } from '../../common/guards/local-actor.guard';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringRepository } from './monitoring.repository';
import { MonitoringService } from './monitoring.service';

@Module({
  imports: [DatabaseModule],
  controllers: [MonitoringController],
  providers: [MonitoringRepository, MonitoringService, LocalActorGuard],
  exports: [MonitoringService],
})
export class MonitoringModule {}
