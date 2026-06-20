import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

export type WebhookProcessResult =
  | { success: true; transactionId: string }
  | { success: false; reason: 'user_not_found' | 'db_error' | 'payment_failed' };

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async processPaymentWebhook(dto: PaymentWebhookDto): Promise<WebhookProcessResult> {
    const { external_reference: userId, amount, payment_method, status, category } = dto;

    // Short-circuit on failed payments — log and return early
    if (status === 'failed') {
      this.logger.warn(
        `Payment failed: userId=${userId} category=${category} method=${payment_method} amount=${amount}`,
      );
      return { success: false, reason: 'payment_failed' };
    }

    this.logger.log(
      `Processing paid webhook: userId=${userId} category=${category} method=${payment_method} amount=${amount}`,
    );

    // Verify the user exists before inserting (prevents orphaned transactions)
    const { data: userRow, error: userError } = await this.supabase
      .from('users')
      .select('id, status')
      .eq('id', userId)
      .single();

    if (userError || !userRow) {
      this.logger.error(`User not found for webhook: userId=${userId} — ${userError?.message ?? 'no row'}`);
      return { success: false, reason: 'user_not_found' };
    }

    // Insert the income transaction
    // TODO(multi-tenant): resolve gym_id from userRow.home_gym_id and pass it here
    const { data: transaction, error: insertError } = await this.supabase
      .from('financial_transactions')
      .insert({
        user_id: userId,
        gym_id: null, // populated once webhook DTO carries gym context
        amount,
        type: 'income',
        category,
        status: 'paid',
        description: `Pagamento via ${payment_method.toUpperCase()}`,
        paid_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError || !transaction) {
      this.logger.error(`Failed to insert transaction for userId=${userId}: ${insertError?.message}`);
      return { success: false, reason: 'db_error' };
    }

    this.logger.log(`Transaction saved: id=${transaction.id} userId=${userId}`);

    // Critical side effect: paid subscription → activate user (unlocks turnstile)
    if (category === 'subscription') {
      const { error: activateError } = await this.supabase
        .from('users')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (activateError) {
        // Transaction already committed — log but don't block the webhook response.
        // Admin can manually re-activate if the sync drifts.
        this.logger.error(
          `Transaction saved but failed to activate user=${userId}: ${activateError.message}`,
        );
      } else {
        this.logger.log(`User activated via subscription payment: userId=${userId}`);
      }
    }

    return { success: true, transactionId: transaction.id };
  }
}
