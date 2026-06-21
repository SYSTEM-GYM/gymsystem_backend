import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

export type WebhookProcessResult =
  | { success: true; transactionId: string }
  | { success: false; reason: 'user_not_found' | 'db_error' | 'payment_failed' };

type UserRow = { id: string; status: string; home_gym_id: string | null };

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async processPaymentWebhook(dto: PaymentWebhookDto): Promise<WebhookProcessResult> {
    const { external_reference: userId, amount, payment_method, status, category } = dto;

    if (status === 'failed') {
      this.logger.warn(
        `Payment failed: userId=${userId} category=${category} method=${payment_method} amount=${amount}`,
      );
      return { success: false, reason: 'payment_failed' };
    }

    this.logger.log(
      `Processing paid webhook: userId=${userId} category=${category} method=${payment_method} amount=${amount}`,
    );

    const { data: userRow, error: userError } = await this.supabase
      .from('users')
      .select('id, status, home_gym_id')
      .eq('id', userId)
      .single<UserRow>();

    if (userError || !userRow) {
      this.logger.error(
        `User not found for webhook: userId=${userId} — ${userError?.message ?? 'no row'}`,
      );
      return { success: false, reason: 'user_not_found' };
    }

    const { data: transaction, error: insertError } = await this.supabase
      .from('financial_transactions')
      .insert({
        user_id: userId,
        gym_id: userRow.home_gym_id,
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
      this.logger.error(
        `Failed to insert transaction for userId=${userId}: ${insertError?.message}`,
      );
      return { success: false, reason: 'db_error' };
    }

    this.logger.log(`Transaction saved: id=${transaction.id} userId=${userId}`);

    if (category === 'subscription') {
      const { error: activateError } = await this.supabase
        .from('users')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (activateError) {
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
