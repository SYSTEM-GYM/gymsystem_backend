import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';
import { CheckoutItemDto } from './dto/checkout.dto';

/**
 * All money is handled in integer centavos to avoid floating-point drift;
 * values are converted back to decimal only when persisted (NUMERIC 10,2).
 */
export type PricedItem = {
  variantId: string;
  productId: string;
  titleSnapshot: string;
  variantSnapshot: string | null;
  skuSnapshot: string | null;
  unitPriceCents: number;
  quantity: number;
  totalPriceCents: number;
};

export type PricedOrder = {
  items: PricedItem[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  couponId: string | null;
  couponCode: string | null;
};

type VariantRow = {
  id: string;
  product_id: string;
  gym_id: string;
  size: string | null;
  color: string | null;
  model: string | null;
  sku: string | null;
  price_override: number | null;
  stock_quantity: number;
  active: boolean;
  products: {
    id: string;
    gym_id: string;
    category_id: string | null;
    title: string;
    base_price: number;
    active: boolean;
  } | null;
};

type CouponRow = {
  id: string;
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  min_order_amount: number;
  max_uses: number | null;
  used_count: number;
  starts_at: string;
  expires_at: string | null;
  active: boolean;
  target_skus: string[];
  target_categories: string[];
};

export const toCents = (value: number): number => Math.round(value * 100);
export const fromCents = (cents: number): number => Math.round(cents) / 100;

export function variantLabel(v: {
  size: string | null;
  color: string | null;
  model: string | null;
}): string | null {
  const parts = [v.size, v.color, v.model].filter(
    (p): p is string => !!p && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(' / ') : null;
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Server-side pricing engine: the client sends only variant ids and
   * quantities; every price comes from the catalog and every rule (tenant
   * match, active flags, coupon window/limits) is enforced here. The coupon
   * is validated but NOT consumed — usage is burned atomically only when a
   * payment is confirmed (store_consume_coupon RPC).
   */
  async priceOrder(
    gymId: string,
    items: CheckoutItemDto[],
    couponCode?: string,
  ): Promise<PricedOrder> {
    // Merge duplicate variant lines
    const quantities = new Map<string, number>();
    for (const item of items) {
      quantities.set(
        item.variantId,
        (quantities.get(item.variantId) ?? 0) + item.quantity,
      );
    }
    const variantIds = [...quantities.keys()];

    const { data, error } = await this.supabase
      .from('product_variants')
      .select(
        `id, product_id, gym_id, size, color, model, sku, price_override,
         stock_quantity, active,
         products ( id, gym_id, category_id, title, base_price, active )`,
      )
      .in('id', variantIds);

    if (error) {
      throw new BadRequestException('Erro ao carregar os produtos do pedido.');
    }

    const rows = (data ?? []) as unknown as VariantRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));

    const priced: PricedItem[] = [];
    // Category per variant, needed for coupon targeting eligibility
    const categoryByVariant = new Map<string, string | null>();
    let subtotalCents = 0;

    for (const [variantId, quantity] of quantities) {
      const row = byId.get(variantId);
      const product = row?.products;

      if (!row || !product) {
        throw new BadRequestException('Produto não encontrado.');
      }
      // Tenant isolation: every line must belong to the caller's gym
      if (row.gym_id !== gymId || product.gym_id !== gymId) {
        throw new BadRequestException(
          'Produto indisponível para esta unidade.',
        );
      }
      if (!row.active || !product.active) {
        throw new BadRequestException(
          `"${product.title}" não está mais disponível.`,
        );
      }

      const unitPriceCents = toCents(row.price_override ?? product.base_price);
      const totalPriceCents = unitPriceCents * quantity;
      subtotalCents += totalPriceCents;
      categoryByVariant.set(variantId, product.category_id);

      priced.push({
        variantId,
        productId: product.id,
        titleSnapshot: product.title,
        variantSnapshot: variantLabel(row),
        skuSnapshot: row.sku,
        unitPriceCents,
        quantity,
        totalPriceCents,
      });
    }

    let discountCents = 0;
    let couponId: string | null = null;
    let appliedCode: string | null = null;

    if (couponCode && couponCode.trim()) {
      const coupon = await this.validateCoupon(
        gymId,
        couponCode.trim().toUpperCase(),
        subtotalCents,
      );

      // Targeted coupons discount ONLY the eligible lines (by SKU or by
      // product category). Empty targeting arrays = whole store.
      const isTargeted =
        coupon.target_skus.length > 0 || coupon.target_categories.length > 0;

      const eligibleCents = isTargeted
        ? priced.reduce((acc, item) => {
            const categoryId = categoryByVariant.get(item.variantId) ?? null;
            const matchesSku =
              item.skuSnapshot !== null &&
              coupon.target_skus.includes(item.skuSnapshot);
            const matchesCategory =
              categoryId !== null &&
              coupon.target_categories.includes(categoryId);
            return (
              acc + (matchesSku || matchesCategory ? item.totalPriceCents : 0)
            );
          }, 0)
        : subtotalCents;

      if (isTargeted && eligibleCents === 0) {
        throw new BadRequestException(
          'Este cupom não se aplica aos itens do seu carrinho.',
        );
      }

      discountCents =
        coupon.discount_type === 'percentage'
          ? Math.round((eligibleCents * toCents(coupon.discount_value)) / 10000)
          : Math.min(eligibleCents, toCents(coupon.discount_value));
      couponId = coupon.id;
      appliedCode = coupon.code;
    }

    return {
      items: priced,
      subtotalCents,
      discountCents,
      totalCents: subtotalCents - discountCents,
      couponId,
      couponCode: appliedCode,
    };
  }

  private async validateCoupon(
    gymId: string,
    code: string,
    subtotalCents: number,
  ): Promise<CouponRow> {
    const { data } = await this.supabase
      .from('store_coupons')
      .select(
        'id, code, discount_type, discount_value, min_order_amount, max_uses, used_count, starts_at, expires_at, active, target_skus, target_categories',
      )
      .eq('gym_id', gymId)
      .eq('code', code)
      .maybeSingle<CouponRow>();

    if (!data || !data.active) {
      throw new BadRequestException('Cupom inválido.');
    }
    const now = Date.now();
    if (new Date(data.starts_at).getTime() > now) {
      throw new BadRequestException('Este cupom ainda não está ativo.');
    }
    if (data.expires_at && new Date(data.expires_at).getTime() < now) {
      throw new BadRequestException('Este cupom expirou.');
    }
    if (data.max_uses !== null && data.used_count >= data.max_uses) {
      throw new BadRequestException('Este cupom atingiu o limite de usos.');
    }
    if (subtotalCents < toCents(data.min_order_amount)) {
      throw new BadRequestException(
        `Este cupom exige pedido mínimo de R$ ${data.min_order_amount.toFixed(2).replace('.', ',')}.`,
      );
    }
    return data;
  }
}
