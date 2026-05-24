import { Module } from '@nestjs/common';
import { LocalActorGuard } from '../../common/guards/local-actor.guard';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ReleaseLineModule } from '../release-line/release-line.module';
import { CanaryReleaseController } from './canary-release.controller';
import { CanaryReleaseRepository } from './canary-release.repository';
import { CanaryReleaseService } from './canary-release.service';

@Module({
  imports: [DatabaseModule, ReleaseLineModule],
  controllers: [CanaryReleaseController],
  providers: [CanaryReleaseRepository, CanaryReleaseService, LocalActorGuard],
  exports: [CanaryReleaseService],
})
export class CanaryReleaseModule {}
