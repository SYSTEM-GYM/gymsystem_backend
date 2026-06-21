import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';

type RecurringExpense = {
  id: string;
  name: string;
  description: string | null;
  amount: number;
  category: string;
  day_of_month: number;
  gym_id: string | null;
};

@Injectable()
export class FinanceCronService {
  private readonly logger = new Logger(FinanceCronService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async processRecurringExpenses(): Promise<void> {
    const today = new Date();
    const dayOfMonth = today.getDate();
    const todayIso = today.toISOString().split('T')[0]; // YYYY-MM-DD

    this.logger.log(`[RecurringExpenses] Job started — day_of_month=${dayOfMonth} date=${todayIso}`);

    // Fetch active templates scheduled for today
    const { data: templates, error: fetchError } = await this.supabase
      .from('recurring_expenses')
      .select('id, name, description, amount, category, day_of_month, gym_id')
      .eq('is_active', true)
      .eq('day_of_month', dayOfMonth)
      .returns<RecurringExpense[]>();

    if (fetchError) {
      this.logger.error(`[RecurringExpenses] Failed to fetch templates: ${fetchError.message}`);
      return;
    }

    if (!templates || templates.length === 0) {
      this.logger.log(`[RecurringExpenses] No recurring expenses scheduled for day ${dayOfMonth}`);
      return;
    }

    this.logger.log(`[RecurringExpenses] Found ${templates.length} template(s) to process`);

    let successCount = 0;
    let failureCount = 0;

    for (const template of templates) {
      // Guard: skip if a pending/paid transaction for this template already exists today.
      // This prevents duplicate inserts if the job runs more than once (e.g., restart).
      const { data: existing } = await this.supabase
        .from('financial_transactions')
        .select('id')
        .eq('description', template.description ?? template.name)
        .eq('due_date', todayIso)
        .eq('type', 'expense')
        .in('status', ['pending', 'paid'])
        .limit(1);

      if (existing && existing.length > 0) {
        this.logger.warn(
          `[RecurringExpenses] Skipping "${template.name}" — transaction already exists for ${todayIso}`,
        );
        continue;
      }

      const { error: insertError } = await this.supabase
        .from('financial_transactions')
        .insert({
          gym_id: template.gym_id,
          type: 'expense',
          status: 'pending',
          amount: template.amount,
          category: template.category,
          description: template.description ?? template.name,
          due_date: todayIso,
        });

      if (insertError) {
        this.logger.error(
          `[RecurringExpenses] Failed to insert "${template.name}": ${insertError.message}`,
        );
        failureCount++;
      } else {
        this.logger.log(
          `[RecurringExpenses] Inserted expense: "${template.name}" amount=${template.amount} category=${template.category}`,
        );
        successCount++;
      }
    }

    this.logger.log(
      `[RecurringExpenses] Job completed — success=${successCount} failures=${failureCount}`,
    );
  }
}
