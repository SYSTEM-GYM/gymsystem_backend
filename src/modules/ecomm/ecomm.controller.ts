import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { TenantContextService } from '../../shared/context/tenant-context.service';
import { CheckoutService } from './checkout.service';
import { PosService } from './pos.service';
import { OrdersService } from './orders.service';
import { CheckoutDto, PosSaleDto } from './dto/checkout.dto';

const STORE_STAFF = ['admin', 'gym_admin', 'master', 'receptionist'] as const;

@Controller('v1/store')
export class EcommController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly pos: PosService,
    private readonly orders: OrdersService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get('health')
  health() {
    return { status: 'store module ok' };
  }

  /** Storefront checkout (student PWA) — any authenticated member. */
  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  async createCheckout(@Body() dto: CheckoutDto) {
    return this.checkout.createCheckout(dto);
  }

  /** Over-the-counter sale — staff only, settles stock synchronously. */
  @Post('pos/sale')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STORE_STAFF)
  async registerPosSale(@Body() dto: PosSaleDto) {
    return this.pos.registerSale(dto);
  }

  /** Full refund of a paid order (staff): gateway refund + stock restore. */
  @Post('orders/:id/refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STORE_STAFF)
  async refundOrder(@Param('id', ParseUUIDPipe) orderId: string) {
    const gymId = this.tenant.getGymId();
    await this.orders.refundOrder(orderId, gymId ?? '');
    return { ok: true };
  }
}
