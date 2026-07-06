import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';
import { fromCents, PricedOrder, toCents } from './catalog.service';
import { PosPaymentMethod } from './dto/checkout.dto';

export type OrderOrigin = 'storefront' | 'pos';

export type CreateOrderInput = {
  gymId: string;
  buyerId: string | null;
  buyerName: string | null;
  origin: OrderOrigin;
  paymentMethod: PosPaymentMethod;
  priced: PricedOrder;
  soldBy?: string | null;
  notes?: string | null;
};

export type SettleResult = { ok: true } | { ok: false; outOfStock: string[] };

type OrderRow = {
  id: string;
  gym_id: string;
  buyer_id: string | null;
  status: string;
  payment_method: string;
  total_amount: number;
  coupon_id: string | null;
  sold_by: string | null;
  stripe_payment_intent_id: string | null;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly stripe: Stripe;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {
    this.stripe = new Stripe(
      process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder',
    );
  }

  // ── Order persistence ──────────────────────────────────────────────────────

  /** Inserts a pending order + snapshot items. Stock is NOT touched here. */
  async createOrder(input: CreateOrderInput): Promise<string> {
    const { priced } = input;

    const { data: order, error } = await this.supabase
      .from('orders')
      .insert({
        gym_id: input.gymId,
        buyer_id: input.buyerId,
        buyer_name: input.buyerName,
        origin: input.origin,
        status: 'pending',
        payment_method: input.paymentMethod,
        subtotal_amount: fromCents(priced.subtotalCents),
        discount_amount: fromCents(priced.discountCents),
        total_amount: fromCents(priced.totalCents),
        coupon_id: priced.couponId,
        sold_by: input.soldBy ?? null,
        notes: input.notes ?? null,
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !order) {
      this.logger.error(`createOrder failed: ${error?.message}`);
      throw new ConflictException('Não foi possível registrar o pedido.');
    }

    const { error: itemsError } = await this.supabase
      .from('order_items')
      .insert(
        priced.items.map((item) => ({
          order_id: order.id,
          gym_id: input.gymId,
          product_id: item.productId,
          variant_id: item.variantId,
          title_snapshot: item.titleSnapshot,
          variant_snapshot: item.variantSnapshot,
          sku_snapshot: item.skuSnapshot,
          unit_price: fromCents(item.unitPriceCents),
          quantity: item.quantity,
          total_price: fromCents(item.totalPriceCents),
        })),
      );

    if (itemsError) {
      this.logger.error(`createOrder items failed: ${itemsError.message}`);
      await this.supabase.from('orders').delete().eq('id', order.id);
      throw new ConflictException(
        'Não foi possível registrar os itens do pedido.',
      );
    }

    return order.id;
  }

  async attachStripeSession(orderId: string, sessionId: string): Promise<void> {
    await this.supabase
      .from('orders')
      .update({ stripe_checkout_session_id: sessionId })
      .eq('id', orderId);
  }

  // ── Atomic settlement (the ONLY place stock is deducted) ──────────────────

  /**
   * Runs the all-or-nothing stock RPC for an order. Returns which variants
   * were out of stock when the deduction is impossible — nothing is deducted
   * in that case.
   */
  private async deductStock(orderId: string): Promise<SettleResult> {
    const rpc = await this.supabase.rpc('store_confirm_order_stock', {
      p_order_id: orderId,
    });

    if (rpc.error) {
      this.logger.error(
        `store_confirm_order_stock failed: ${rpc.error.message}`,
      );
      throw new ConflictException('Falha ao processar o estoque do pedido.');
    }

    const result = rpc.data as { ok: boolean; out_of_stock?: string[] };
    return result.ok
      ? { ok: true }
      : { ok: false, outOfStock: result.out_of_stock ?? [] };
  }

  private async markPaid(order: OrderRow, paymentIntentId?: string | null) {
    await this.supabase
      .from('orders')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(paymentIntentId
          ? { stripe_payment_intent_id: paymentIntentId }
          : {}),
      })
      .eq('id', order.id);

    if (order.coupon_id) {
      const consumeRpc = await this.supabase.rpc('store_consume_coupon', {
        p_coupon_id: order.coupon_id,
      });
      if (consumeRpc.data === false) {
        // Limit hit between checkout and payment — honour the sale, log it.
        this.logger.warn(
          `Coupon ${order.coupon_id} exhausted after checkout of order ${order.id}`,
        );
      }
    }

    // Store revenue lands in the existing finance module (category added in
    // migration 007).
    const financeUser = order.buyer_id ?? order.sold_by;
    if (financeUser) {
      await this.supabase.from('financial_transactions').insert({
        user_id: financeUser,
        gym_id: order.gym_id,
        amount: order.total_amount,
        type: 'income',
        category: 'ecommerce',
        status: 'paid',
        paid_at: new Date().toISOString(),
        description: `Venda da loja — pedido ${order.id.slice(0, 8)}`,
      });
    }
  }

  // ── Webhook path: Stripe payment approved ──────────────────────────────────

  /**
   * Called by the Stripe webhook when a store Checkout Session is paid.
   * Idempotent: a second delivery of the same event is a no-op. If the
   * atomic stock check fails (race: two buyers paid for the last unit), the
   * charge is refunded in full and the order marked 'refunded'.
   */
  async confirmStripePayment(params: {
    orderId: string;
    paymentIntentId: string | null;
    amountTotalCents: number | null;
  }): Promise<{ handled: boolean; reason?: string }> {
    const order = await this.getOrder(params.orderId);
    if (!order) return { handled: false, reason: 'order not found' };
    if (order.status !== 'pending') {
      return { handled: true, reason: `already ${order.status}` };
    }

    // Anti-tamper: the paid amount must match the server-computed total.
    if (
      params.amountTotalCents !== null &&
      params.amountTotalCents !== toCents(order.total_amount)
    ) {
      this.logger.error(
        `Order ${order.id}: paid amount ${params.amountTotalCents} != expected ${toCents(order.total_amount)} — refusing to confirm`,
      );
      return { handled: false, reason: 'amount mismatch' };
    }

    const settle = await this.deductStock(order.id);

    if (!settle.ok) {
      await this.refundStripeCharge(order, params.paymentIntentId);
      await this.supabase
        .from('orders')
        .update({
          status: 'refunded',
          canceled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          notes:
            'Estorno automático: estoque esgotado no momento da aprovação do pagamento.',
          ...(params.paymentIntentId
            ? { stripe_payment_intent_id: params.paymentIntentId }
            : {}),
        })
        .eq('id', order.id);

      this.logger.warn(
        `Order ${order.id} auto-refunded — out of stock: ${settle.outOfStock.join(', ')}`,
      );
      return { handled: true, reason: 'out of stock — refunded' };
    }

    await this.resolveRealPaymentMethod(order.id, params.paymentIntentId);
    await this.markPaid(order, params.paymentIntentId);
    this.logger.log(`Order ${order.id} paid and stock deducted.`);
    return { handled: true };
  }

  // ── POS path: payment collected at the counter ────────────────────────────

  /**
   * POS sales are already paid when registered, so stock is confirmed
   * synchronously. Insufficient stock aborts the sale (409) BEFORE the order
   * is finalized — the receptionist sees it immediately.
   */
  async settlePosOrder(orderId: string): Promise<void> {
    const order = await this.getOrder(orderId);
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    if (order.status !== 'pending') return;

    const settle = await this.deductStock(order.id);

    if (!settle.ok) {
      await this.supabase
        .from('orders')
        .update({
          status: 'canceled',
          canceled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          notes: 'Venda cancelada: estoque insuficiente.',
        })
        .eq('id', order.id);

      throw new ConflictException(
        'Estoque insuficiente para um ou mais itens. A venda não foi concluída.',
      );
    }

    await this.markPaid(order);
  }

  // ── Staff refund (paid order canceled later) ───────────────────────────────

  async refundOrder(orderId: string, gymId: string): Promise<void> {
    const order = await this.getOrder(orderId);
    if (!order || order.gym_id !== gymId) {
      throw new NotFoundException('Pedido não encontrado.');
    }
    if (order.status !== 'paid' && order.status !== 'delivered') {
      throw new ConflictException('Apenas pedidos pagos podem ser estornados.');
    }

    if (order.stripe_payment_intent_id) {
      await this.refundStripeCharge(order, order.stripe_payment_intent_id);
    }

    const { error } = await this.supabase.rpc('store_restore_order_stock', {
      p_order_id: order.id,
    });
    if (error) {
      this.logger.error(`store_restore_order_stock failed: ${error.message}`);
    }

    await this.supabase
      .from('orders')
      .update({
        status: 'refunded',
        canceled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getOrder(orderId: string): Promise<OrderRow | null> {
    const { data } = await this.supabase
      .from('orders')
      .select(
        'id, gym_id, buyer_id, status, payment_method, total_amount, coupon_id, sold_by, stripe_payment_intent_id',
      )
      .eq('id', orderId)
      .maybeSingle<OrderRow>();
    return data ?? null;
  }

  private async refundStripeCharge(
    order: OrderRow,
    paymentIntentId: string | null,
  ): Promise<void> {
    if (!paymentIntentId) {
      this.logger.error(
        `Order ${order.id} needs a refund but has no payment_intent id`,
      );
      return;
    }
    try {
      await this.stripe.refunds.create({ payment_intent: paymentIntentId });
      this.logger.log(
        `Refund issued for order ${order.id} (${paymentIntentId})`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Stripe refund failed for order ${order.id}: ${msg}`);
    }
  }

  /** Best-effort: replace the placeholder method with what Stripe charged. */
  private async resolveRealPaymentMethod(
    orderId: string,
    paymentIntentId: string | null,
  ): Promise<void> {
    if (!paymentIntentId) return;
    try {
      const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['payment_method'],
      });
      const pm = pi.payment_method;
      if (!pm || typeof pm === 'string') return;

      let method: PosPaymentMethod | null = null;
      if (pm.type === 'pix') method = 'pix';
      else if (pm.type === 'card') {
        method = pm.card?.funding === 'debit' ? 'debit' : 'credit';
      }
      if (method) {
        await this.supabase
          .from('orders')
          .update({ payment_method: method })
          .eq('id', orderId);
      }
    } catch {
      // Cosmetic only — keep the placeholder method on any failure.
    }
  }
}
