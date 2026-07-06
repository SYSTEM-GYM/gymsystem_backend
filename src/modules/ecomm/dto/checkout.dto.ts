import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CheckoutItemDto {
  @IsUUID()
  variantId!: string;

  @IsInt()
  @Min(1)
  @Max(50)
  quantity!: number;
}

/**
 * Storefront checkout payload. Deliberately carries NO prices — every amount
 * is recomputed server-side from the catalog (CatalogService.priceOrder).
 */
export class CheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items!: CheckoutItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(30)
  couponCode?: string;
}

export const POS_PAYMENT_METHODS = ['pix', 'credit', 'debit', 'cash'] as const;
export type PosPaymentMethod = (typeof POS_PAYMENT_METHODS)[number];

/**
 * Point-of-sale payload: payment was already collected at the counter
 * (card machine / cash / PIX on the spot), so the sale is confirmed and the
 * stock deducted synchronously in the same request.
 */
export class PosSaleDto extends CheckoutDto {
  @IsIn(POS_PAYMENT_METHODS)
  paymentMethod!: PosPaymentMethod;

  /** Registered student buying at the counter (optional). */
  @IsOptional()
  @IsUUID()
  buyerId?: string;

  /** Walk-in buyer without an account. */
  @IsOptional()
  @IsString()
  @MaxLength(140)
  buyerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
