import { Module } from '@nestjs/common';
import { LocalActorGuard } from '../../common/guards/local-actor.guard';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ConnectorController } from './connector.controller';
import { ConnectorDriverFactory } from './connector.driver-factory';
import { ConnectorRepository } from './connector.repository';
import { ConnectorService } from './connector.service';

@Module({
  imports: [CryptoModule, DatabaseModule],
  controllers: [ConnectorController],
  providers: [ConnectorRepository, ConnectorService, ConnectorDriverFactory, LocalActorGuard],
  exports: [ConnectorService, ConnectorDriverFactory],
})
export class ConnectorModule {}
