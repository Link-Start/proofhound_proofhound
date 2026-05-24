import { Module } from '@nestjs/common';
import { LocalActorGuard } from '../../common/guards/local-actor.guard';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AnnotationController } from './annotation.controller';
import { AnnotationRepository } from './annotation.repository';
import { AnnotationService } from './annotation.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AnnotationController],
  providers: [AnnotationRepository, AnnotationService, LocalActorGuard],
  exports: [AnnotationService],
})
export class AnnotationModule {}
