import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';

export type StripeEventResult =
  | { handled: true; event: string }
  | { handled: false; reason: string };

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
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
      return this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
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
      case 'invoice.payment_succeeded':
        return this.onInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);

      case 'invoice.payment_failed':
        return this.onInvoicePaymentFailed(event.data.object as Stripe.Invoice);

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        if (sub.status === 'past_due') {
          return this.onSubscriptionPastDue(sub);
        }
        return { handled: false, reason: `customer.subscription.updated — status ${sub.status} not handled` };
      }

      case 'customer.subscription.deleted':
        return this.onSubscriptionDeleted(event.data.object as Stripe.Subscription);

      default:
        this.logger.debug(`Stripe event not handled: ${event.type}`);
        return { handled: false, reason: `event type '${event.type}' not configured` };
    }
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
      return { handled: false, reason: 'invoice has no subscription reference' };
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

    const plan = Array.isArray(sub.gym_plans) ? sub.gym_plans[0] : sub.gym_plans;
    const now = new Date();
    let nextBilling = new Date(now);
    if (plan?.billing_cycle === 'monthly') nextBilling.setMonth(nextBilling.getMonth() + 1);
    else if (plan?.billing_cycle === 'quarterly') nextBilling.setMonth(nextBilling.getMonth() + 3);
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
      .or(`stripe_invoice_id.eq.${stripeInvoiceId},and(subscription_id.eq.${sub.id},status.neq.paid)`)
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
      return { handled: false, reason: 'invoice.payment_failed — no subscription reference' };
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
