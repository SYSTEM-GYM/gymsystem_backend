import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { EcommModule } from '../ecomm/ecomm.module';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';

@Module({
  // EcommModule provides OrdersService for store-order webhook settlement
  imports: [DatabaseModule, EcommModule],
  controllers: [StripeController],
  providers: [StripeService],
})
export class StripeModule {}
