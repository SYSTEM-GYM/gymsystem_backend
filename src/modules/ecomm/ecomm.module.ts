import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { TenantContextModule } from '../../shared/context/tenant-context.module';
import { EcommController } from './ecomm.controller';
import { EcommService } from './ecomm.service';
import { CatalogService } from './catalog.service';
import { CheckoutService } from './checkout.service';
import { PosService } from './pos.service';
import { OrdersService } from './orders.service';

@Module({
  imports: [DatabaseModule, TenantContextModule],
  controllers: [EcommController],
  providers: [
    EcommService,
    CatalogService,
    CheckoutService,
    PosService,
    OrdersService,
  ],
  // OrdersService is consumed by the Stripe webhook dispatcher
  exports: [OrdersService],
})
export class EcommModule {}
