import { Module } from '@nestjs/common';
import { EcommController } from './ecomm.controller';
import { EcommService } from './ecomm.service';

@Module({
  controllers: [EcommController],
  providers: [EcommService],
  exports: [EcommService],
})
export class EcommModule {}
