import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { TenantContextService } from '../../shared/context/tenant-context.service';
import { CatalogService } from './catalog.service';
import { CheckoutDto } from './dto/checkout.dto';
import { OrdersService } from './orders.service';

export type CheckoutResult =
  | { orderId: string; requiresPayment: true; checkoutUrl: string }
  | { orderId: string; requiresPayment: false };

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly tenant: TenantContextService,
    private readonly catalog: CatalogService,
    private readonly orders: OrdersService,
  ) {
    this.stripe = new Stripe(
      process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder',
    );
  }

  /**
   * Storefront checkout. The client sends variant ids + quantities + an
   * optional coupon code — never prices. Stock is NOT reserved here; it is
   * deducted only when the Stripe webhook confirms the payment.
   */
  async createCheckout(dto: CheckoutDto): Promise<CheckoutResult> {
    const buyerId = this.tenant.getUserId();
    const gymId = this.tenant.getGymId();
    if (!gymId) {
      throw new BadRequestException(
        'Sua conta não está vinculada a uma unidade. Fale com a recepção.',
      );
    }

    const priced = await this.catalog.priceOrder(
      gymId,
      dto.items,
      dto.couponCode,
    );

    const orderId = await this.orders.createOrder({
      gymId,
      buyerId,
      buyerName: null,
      origin: 'storefront',
      // Placeholder until the webhook resolves what Stripe actually charged
      paymentMethod: 'pix',
      priced,
    });

    // 100% discount → no gateway round-trip; settle immediately.
    if (priced.totalCents === 0) {
      await this.orders.settlePosOrder(orderId);
      return { orderId, requiresPayment: false };
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'pix'],
      currency: 'brl',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'brl',
            unit_amount: priced.totalCents,
            product_data: {
              name: `Pedido da Loja — ${priced.items.length} ite${priced.items.length !== 1 ? 'ns' : 'm'}`,
              description: priced.items
                .map((i) => `${i.quantity}× ${i.titleSnapshot}`)
                .join(', ')
                .slice(0, 500),
            },
          },
        },
      ],
      metadata: {
        kind: 'store_order',
        order_id: orderId,
        gym_id: gymId,
      },
      success_url: `${frontendUrl}/app/store/orders?checkout=success`,
      cancel_url: `${frontendUrl}/app/store/cart?checkout=canceled`,
    });

    if (!session.url) {
      this.logger.error(`Stripe session without url for order ${orderId}`);
      throw new BadRequestException('Não foi possível iniciar o pagamento.');
    }

    await this.orders.attachStripeSession(orderId, session.id);

    return { orderId, requiresPayment: true, checkoutUrl: session.url };
  }
}
