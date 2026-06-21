import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AccessController],
  providers: [AccessService],
})
export class AccessModule {}
