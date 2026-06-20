import { IsIn, IsNumber, IsPositive, IsString, IsUUID, Min } from 'class-validator';

export class PaymentWebhookDto {
  @IsUUID()
  external_reference: string; // maps to public.users.id

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsString()
  @IsIn(['pix', 'credit', 'debit'])
  payment_method: 'pix' | 'credit' | 'debit';

  @IsString()
  @IsIn(['paid', 'failed'])
  status: 'paid' | 'failed';

  @IsString()
  @IsIn(['subscription', 'ecommerce'])
  category: 'subscription' | 'ecommerce';
}
