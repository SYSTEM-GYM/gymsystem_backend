import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/context/tenant-context.service';
import { CatalogService, fromCents } from './catalog.service';
import { PosSaleDto } from './dto/checkout.dto';
import { OrdersService } from './orders.service';

export type PosSaleResult = {
  orderId: string;
  subtotal: number;
  discount: number;
  total: number;
  couponCode: string | null;
  items: {
    title: string;
    variant: string | null;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }[];
};

@Injectable()
export class PosService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly catalog: CatalogService,
    private readonly orders: OrdersService,
  ) {}

  /**
   * Over-the-counter sale: payment was already collected physically
   * (card machine, cash, PIX on the spot), so the order is created and the
   * stock confirmed atomically in the same request. Insufficient stock
   * aborts with 409 before the sale is finalized.
   */
  async registerSale(dto: PosSaleDto): Promise<PosSaleResult> {
    const operatorId = this.tenant.getUserId();
    const gymId = this.tenant.getGymId();
    if (!gymId) {
      throw new BadRequestException('Operador sem unidade vinculada.');
    }
    if (!dto.buyerId && !dto.buyerName?.trim()) {
      throw new BadRequestException(
        'Informe o aluno comprador ou o nome do cliente de balcão.',
      );
    }

    const priced = await this.catalog.priceOrder(
      gymId,
      dto.items,
      dto.couponCode,
    );

    const orderId = await this.orders.createOrder({
      gymId,
      buyerId: dto.buyerId ?? null,
      buyerName: dto.buyerName?.trim() || null,
      origin: 'pos',
      paymentMethod: dto.paymentMethod,
      priced,
      soldBy: operatorId,
      notes: dto.notes ?? null,
    });

    // Throws 409 (and cancels the order) when stock ran out.
    await this.orders.settlePosOrder(orderId);

    return {
      orderId,
      subtotal: fromCents(priced.subtotalCents),
      discount: fromCents(priced.discountCents),
      total: fromCents(priced.totalCents),
      couponCode: priced.couponCode,
      items: priced.items.map((i) => ({
        title: i.titleSnapshot,
        variant: i.variantSnapshot,
        quantity: i.quantity,
        unitPrice: fromCents(i.unitPriceCents),
        totalPrice: fromCents(i.totalPriceCents),
      })),
    };
  }
}
