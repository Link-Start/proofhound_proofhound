import { Module } from '@nestjs/common';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { ModelController } from './model.controller';
import { ModelRepository } from './model.repository';
import { ModelService } from './model.service';
import { ProjectModelController } from './project-model.controller';

@Module({
  imports: [CryptoModule, DatabaseModule, RedisModule],
  controllers: [ModelController, ProjectModelController],
  providers: [ModelRepository, ModelService],
  exports: [ModelService],
})
export class ModelModule {}
