import { Module } from '@nestjs/common';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { TokenController } from './token.controller';
import { TokenRepository } from './token.repository';
import { TokenService } from './token.service';

@Module({
  imports: [CryptoModule, DatabaseModule],
  controllers: [TokenController],
  providers: [TokenRepository, TokenService],
  exports: [TokenService],
})
export class TokenModule {}
