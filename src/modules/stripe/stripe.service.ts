import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';
import { OrdersService } from '../ecomm/orders.service';

export type StripeEventResult =
  | { handled: true; event: string }
  | { handled: false; reason: string };

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly storeOrders: OrdersService,
  ) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      this.logger.error('STRIPE_SECRET_KEY is not configured');
    }
    this.stripe = new Stripe(key ?? 'sk_test_placeholder');
  }

  // ── Signature verification ────────────────────────────────────────────────

  constructEvent(rawBody: Buffer, signature: string): Stripe.Event | null {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET is not configured');
      return null;
    }
    try {
      return this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Stripe signature verification failed: ${msg}`);
      return null;
    }
  }

  // ── Dispatcher ────────────────────────────────────────────────────────────

  async handleEvent(event: Stripe.Event): Promise<StripeEventResult> {
    this.logger.log(`Stripe event received: ${event.type} id=${event.id}`);

    switch (event.type) {
      // ── Store (e-commerce/POS) one-off payments ──────────────────────────
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        if (session.metadata?.kind !== 'store_order') {
          return {
            handled: false,
            reason: `${event.type} — not a store order (kind=${session.metadata?.kind ?? 'none'})`,
          };
        }
        // PIX is async: 'completed' can arrive while payment is still
        // processing; the async_payment_succeeded event settles it later.
        if (session.payment_status !== 'paid') {
          return {
            handled: false,
            reason: `store order session not paid yet (${session.payment_status})`,
          };
        }
        return this.onStoreOrderPaid(session, event.type);
      }

      case 'checkout.session.async_payment_failed': {
        const session = event.data.object;
        if (session.metadata?.kind !== 'store_order') {
          return {
            handled: false,
            reason: 'async_payment_failed — not a store order',
          };
        }
        return this.onStoreOrderPaymentFailed(session);
      }

      case 'invoice.payment_succeeded':
        return this.onInvoicePaymentSucceeded(event.data.object);

      case 'invoice.payment_failed':
        return this.onInvoicePaymentFailed(event.data.object);

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        if (sub.status === 'past_due') {
          return this.onSubscriptionPastDue(sub);
        }
        return {
          handled: false,
          reason: `customer.subscription.updated — status ${sub.status} not handled`,
        };
      }

      case 'customer.subscription.deleted':
        return this.onSubscriptionDeleted(event.data.object);

      default:
        this.logger.debug(`Stripe event not handled: ${event.type}`);
        return {
          handled: false,
          reason: `event type '${event.type}' not configured`,
        };
    }
  }

  // ── Store order settlement (delegates to the ecomm OrdersService) ─────────

  private async onStoreOrderPaid(
    session: Stripe.Checkout.Session,
    eventType: string,
  ): Promise<StripeEventResult> {
    const orderId = session.metadata?.order_id;
    if (!orderId) {
      return {
        handled: false,
        reason: 'store order session without order_id metadata',
      };
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);

    const result = await this.storeOrders.confirmStripePayment({
      orderId,
      paymentIntentId,
      amountTotalCents: session.amount_total ?? null,
    });

    if (!result.handled) {
      this.logger.warn(
        `Store order ${orderId} not confirmed: ${result.reason ?? 'unknown'}`,
      );
      return {
        handled: false,
        reason: result.reason ?? 'store order not confirmed',
      };
    }
    return { handled: true, event: eventType };
  }

  private async onStoreOrderPaymentFailed(
    session: Stripe.Checkout.Session,
  ): Promise<StripeEventResult> {
    const orderId = session.metadata?.order_id;
    if (!orderId) {
      return {
        handled: false,
        reason: 'store order session without order_id metadata',
      };
    }

    // No stock was ever reserved — just close the pending order.
    await this.supabase
      .from('orders')
      .update({
        status: 'canceled',
        canceled_at: new Date().toISOString(),
        notes: 'Pagamento não aprovado pelo gateway.',
      })
      .eq('id', orderId)
      .eq('status', 'pending');

    this.logger.warn(`Store order ${orderId} canceled — async payment failed`);
    return { handled: true, event: 'checkout.session.async_payment_failed' };
  }

  // ── Resolve Stripe subscription ID from Invoice.parent ───────────────────

  private resolveSubIdFromInvoice(invoice: Stripe.Invoice): string | null {
    const subRef = invoice.parent?.subscription_details?.subscription;
    if (!subRef) return null;
    return typeof subRef === 'string' ? subRef : subRef.id;
  }

  // ── invoice.payment_succeeded ─────────────────────────────────────────────

  private async onInvoicePaymentSucceeded(
    invoice: Stripe.Invoice,
  ): Promise<StripeEventResult> {
    const stripeSubId = this.resolveSubIdFromInvoice(invoice);

    if (!stripeSubId) {
      return {
        handled: false,
        reason: 'invoice has no subscription reference',
      };
    }

    // Find our gym_subscription row
    const { data: sub, error: subError } = await this.supabase
      .from('gym_subscriptions')
      .select('id, plan_id, gym_plans(billing_cycle)')
      .eq('stripe_subscription_id', stripeSubId)
      .maybeSingle<{
        id: string;
        plan_id: string;
        gym_plans: { billing_cycle: string } | { billing_cycle: string }[];
      }>();

    if (subError || !sub) {
      this.logger.warn(
        `invoice.payment_succeeded — gym_subscription not found for stripe_sub=${stripeSubId}`,
      );
      return { handled: false, reason: 'gym_subscription not found' };
    }

    const plan = Array.isArray(sub.gym_plans)
      ? sub.gym_plans[0]
      : sub.gym_plans;
    const now = new Date();
    const nextBilling = new Date(now);
    if (plan?.billing_cycle === 'monthly')
      nextBilling.setMonth(nextBilling.getMonth() + 1);
    else if (plan?.billing_cycle === 'quarterly')
      nextBilling.setMonth(nextBilling.getMonth() + 3);
    else nextBilling.setFullYear(nextBilling.getFullYear() + 1);

    // Update subscription to active + advance next_billing_date
    await this.supabase
      .from('gym_subscriptions')
      .update({
        status: 'active',
        next_billing_date: nextBilling.toISOString().split('T')[0],
      })
      .eq('id', sub.id);

    // Mark matching gym_invoice as paid (by stripe_invoice_id or subscription+due_date)
    const stripeInvoiceId = invoice.id;
    const today = now.toISOString().split('T')[0];

    const { error: invoiceError } = await this.supabase
      .from('gym_invoices')
      .update({ status: 'paid', paid_date: today })
      .or(
        `stripe_invoice_id.eq.${stripeInvoiceId},and(subscription_id.eq.${sub.id},status.neq.paid)`,
      )
      .eq('status', 'pending');

    if (invoiceError) {
      this.logger.warn(
        `invoice.payment_succeeded — could not mark gym_invoice paid: ${invoiceError.message}`,
      );
    }

    this.logger.log(
      `invoice.payment_succeeded handled: sub=${sub.id} next_billing=${nextBilling.toISOString().split('T')[0]}`,
    );
    return { handled: true, event: 'invoice.payment_succeeded' };
  }

  // ── invoice.payment_failed ────────────────────────────────────────────────

  private async onInvoicePaymentFailed(
    invoice: Stripe.Invoice,
  ): Promise<StripeEventResult> {
    const stripeSubId = this.resolveSubIdFromInvoice(invoice);

    if (!stripeSubId) {
      return {
        handled: false,
        reason: 'invoice.payment_failed — no subscription reference',
      };
    }

    const { error } = await this.supabase
      .from('gym_subscriptions')
      .update({ status: 'past_due' })
      .eq('stripe_subscription_id', stripeSubId);

    if (error) {
      this.logger.error(
        `invoice.payment_failed — failed to set past_due: stripe_sub=${stripeSubId} ${error.message}`,
      );
      return { handled: false, reason: 'db_error' };
    }

    this.logger.warn(
      `invoice.payment_failed handled — subscription set to past_due: stripe_sub=${stripeSubId}`,
    );
    return { handled: true, event: 'invoice.payment_failed' };
  }

  // ── customer.subscription.past_due ───────────────────────────────────────

  private async onSubscriptionPastDue(
    stripeSub: Stripe.Subscription,
  ): Promise<StripeEventResult> {
    const { error } = await this.supabase
      .from('gym_subscriptions')
      .update({ status: 'past_due' })
      .eq('stripe_subscription_id', stripeSub.id);

    if (error) {
      this.logger.error(
        `customer.subscription.updated(past_due) — db error: ${error.message}`,
      );
      return { handled: false, reason: 'db_error' };
    }

    this.logger.warn(
      `customer.subscription.updated(past_due) handled: stripe_sub=${stripeSub.id}`,
    );
    return { handled: true, event: 'customer.subscription.updated(past_due)' };
  }

  // ── customer.subscription.deleted ────────────────────────────────────────

  private async onSubscriptionDeleted(
    stripeSub: Stripe.Subscription,
  ): Promise<StripeEventResult> {
    const { error } = await this.supabase
      .from('gym_subscriptions')
      .update({ status: 'canceled' })
      .eq('stripe_subscription_id', stripeSub.id);

    if (error) {
      this.logger.error(
        `customer.subscription.deleted — db error: ${error.message}`,
      );
      return { handled: false, reason: 'db_error' };
    }

    this.logger.log(
      `customer.subscription.deleted handled: stripe_sub=${stripeSub.id}`,
    );
    return { handled: true, event: 'customer.subscription.deleted' };
  }
}
