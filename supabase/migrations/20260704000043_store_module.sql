-- ═══════════════════════════════════════════════════════════════════════════
-- STORE MODULE — Multi-tenant E-commerce & POS foundation
--
-- Architecture contract:
--   • Single DB, every table carries gym_id → tenant isolation via RLS
--   • Policies read the tenant from the JWT (app_metadata.gym_id) with a
--     SECURITY DEFINER fallback for legacy sessions issued before the
--     custom_access_token_hook went live (same zero-downtime strategy as
--     the frontend auth-utils).
--   • Money paths (order creation, payment confirmation, stock deduction,
--     refunds) run ONLY through the NestJS backend with the service_role —
--     clients never write orders/order_items/stock directly. RLS reflects
--     that: no INSERT/UPDATE policies for customers on those tables.
--   • Stock is deducted atomically at payment approval via the
--     store_confirm_order_stock() RPC (row locks, all-or-nothing) — never
--     at add-to-cart time.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. JWT claim helpers ─────────────────────────────────────────────────────
-- app_metadata claims first (no table hit), users-table fallback for legacy
-- sessions. current_user_gym_id()/current_user_role() already exist
-- (migrations 041 / 006) as SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.jwt_gym_id()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    NULLIF((auth.jwt() -> 'app_metadata') ->> 'gym_id', '')::uuid,
    public.current_user_gym_id()
  )
$$;

CREATE OR REPLACE FUNCTION public.jwt_role()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    NULLIF((auth.jwt() -> 'app_metadata') ->> 'role', ''),
    public.current_user_role()
  )
$$;

-- Staff = anyone who can operate the store dashboard/POS of their gym
CREATE OR REPLACE FUNCTION public.is_gym_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT public.jwt_role() IN ('admin', 'gym_admin', 'master', 'receptionist')
$$;

-- ── 1. store_categories ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  name        VARCHAR(80) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gym_id, name)
);

CREATE INDEX IF NOT EXISTS idx_store_categories_gym
  ON public.store_categories(gym_id, sort_order);

-- ── 2. products ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id       UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  category_id  UUID REFERENCES public.store_categories(id) ON DELETE SET NULL,
  title        VARCHAR(140) NOT NULL,
  description  TEXT,
  brand        VARCHAR(80),
  base_price   NUMERIC(10,2) NOT NULL CHECK (base_price >= 0),
  media_urls   TEXT[] NOT NULL DEFAULT '{}',      -- Cloudflare R2 public URLs
  active       BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_gym_active
  ON public.products(gym_id, active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_category
  ON public.products(category_id) WHERE category_id IS NOT NULL;

-- ── 3. product_variants ──────────────────────────────────────────────────────
-- gym_id is denormalized from products so RLS never needs a join.
CREATE TABLE IF NOT EXISTS public.product_variants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  gym_id          UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  size            VARCHAR(30),
  color           VARCHAR(40),
  model           VARCHAR(60),
  sku             VARCHAR(60),
  price_override  NUMERIC(10,2) CHECK (price_override IS NULL OR price_override >= 0),
  stock_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product
  ON public.product_variants(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_sku
  ON public.product_variants(gym_id, sku) WHERE sku IS NOT NULL;

-- ── 4. wishlist_items ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wishlist_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_items_student
  ON public.wishlist_items(student_id, created_at DESC);

-- ── 5. store_coupons ─────────────────────────────────────────────────────────
-- Named store_coupons to avoid clashing with gym_coupons (plan checkout, 029).
CREATE TABLE IF NOT EXISTS public.store_coupons (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id            UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  code              VARCHAR(30) NOT NULL,
  discount_type     VARCHAR(12) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value    NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  min_order_amount  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
  max_uses          INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  used_count        INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  starts_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_by        UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gym_id, code)
);

-- ── 6. orders ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orders (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id                      UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  buyer_id                    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  buyer_name                  VARCHAR(140),          -- POS walk-in without account
  origin                      VARCHAR(12) NOT NULL DEFAULT 'storefront'
                              CHECK (origin IN ('storefront', 'pos')),
  status                      VARCHAR(12) NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'paid', 'delivered', 'canceled', 'refunded')),
  payment_method              VARCHAR(12) NOT NULL
                              CHECK (payment_method IN ('pix', 'credit', 'debit', 'cash')),
  subtotal_amount             NUMERIC(10,2) NOT NULL CHECK (subtotal_amount >= 0),
  discount_amount             NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount                NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  coupon_id                   UUID REFERENCES public.store_coupons(id) ON DELETE SET NULL,
  stripe_checkout_session_id  TEXT,
  stripe_payment_intent_id    TEXT,
  sold_by                     UUID REFERENCES public.users(id) ON DELETE SET NULL,  -- POS operator
  notes                       TEXT,
  paid_at                     TIMESTAMPTZ,
  delivered_at                TIMESTAMPTZ,
  canceled_at                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (buyer_id IS NOT NULL OR buyer_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_orders_gym_status
  ON public.orders(gym_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_buyer
  ON public.orders(buyer_id, created_at DESC) WHERE buyer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_stripe_session
  ON public.orders(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;

-- ── 7. order_items ───────────────────────────────────────────────────────────
-- Product/variant references are SET NULL + snapshot columns so history
-- survives catalog deletions and price edits.
CREATE TABLE IF NOT EXISTS public.order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  gym_id            UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  product_id        UUID REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id        UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  title_snapshot    VARCHAR(140) NOT NULL,
  variant_snapshot  VARCHAR(160),                    -- "P / Preto / Dry-fit"
  sku_snapshot      VARCHAR(60),
  unit_price        NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  total_price       NUMERIC(10,2) NOT NULL CHECK (total_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order
  ON public.order_items(order_id);

-- ═════════════════════════════ RLS ══════════════════════════════════════════
ALTER TABLE public.store_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlist_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_coupons     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items       ENABLE ROW LEVEL SECURITY;

-- Catalog: staff manage their gym's rows; customers read active rows of
-- their own gym only.
CREATE POLICY "store_categories_staff_all" ON public.store_categories
  FOR ALL TO authenticated
  USING (public.is_gym_staff() AND gym_id = public.jwt_gym_id())
  WITH CHECK (public.is_gym_staff() AND gym_id = public.jwt_gym_id());

CREATE POLICY "store_categories_customer_read" ON public.store_categories
  FOR SELECT TO authenticated
  USING (active = true AND gym_id = public.jwt_gym_id());

CREATE POLICY "products_staff_all" ON public.products
  FOR ALL TO authenticated
  USING (public.is_gym_staff() AND gym_id = public.jwt_gym_id())
  WITH CHECK (public.is_gym_staff() AND gym_id = public.jwt_gym_id());

CREATE POLICY "products_customer_read" ON public.products
  FOR SELECT TO authenticated
  USING (active = true AND gym_id = public.jwt_gym_id());

CREATE POLICY "product_variants_staff_all" ON public.product_variants
  FOR ALL TO authenticated
  USING (public.is_gym_staff() AND gym_id = public.jwt_gym_id())
  WITH CHECK (public.is_gym_staff() AND gym_id = public.jwt_gym_id());

CREATE POLICY "product_variants_customer_read" ON public.product_variants
  FOR SELECT TO authenticated
  USING (active = true AND gym_id = public.jwt_gym_id());

-- Wishlist: student manages own rows inside their gym; staff can read
-- (demand insights).
CREATE POLICY "wishlist_items_own_all" ON public.wishlist_items
  FOR ALL TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid() AND gym_id = public.jwt_gym_id());

CREATE POLICY "wishlist_items_staff_read" ON public.wishlist_items
  FOR SELECT TO authenticated
  USING (public.is_gym_staff() AND gym_id = public.jwt_gym_id());

-- Coupons: staff only. Customers never list coupons — validation happens
-- server-side in the backend (prevents code enumeration).
CREATE POLICY "store_coupons_staff_all" ON public.store_coupons
  FOR ALL TO authenticated
  USING (public.is_gym_staff() AND gym_id = public.jwt_gym_id())
  WITH CHECK (public.is_gym_staff() AND gym_id = public.jwt_gym_id());

-- Orders: created/updated exclusively by the backend (service_role bypasses
-- RLS). Clients only read: buyers their own orders, staff their gym's.
-- Staff may update status for fulfilment (delivered) and POS flows.
CREATE POLICY "orders_buyer_read" ON public.orders
  FOR SELECT TO authenticated
  USING (buyer_id = auth.uid());

CREATE POLICY "orders_staff_read" ON public.orders
  FOR SELECT TO authenticated
  USING (public.is_gym_staff() AND gym_id = public.jwt_gym_id());

CREATE POLICY "orders_staff_update" ON public.orders
  FOR UPDATE TO authenticated
  USING (public.is_gym_staff() AND gym_id = public.jwt_gym_id())
  WITH CHECK (public.is_gym_staff() AND gym_id = public.jwt_gym_id());

CREATE POLICY "order_items_buyer_read" ON public.order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id AND o.buyer_id = auth.uid()
    )
  );

CREATE POLICY "order_items_staff_read" ON public.order_items
  FOR SELECT TO authenticated
  USING (public.is_gym_staff() AND gym_id = public.jwt_gym_id());

-- ═══════════════ Atomic inventory engine (webhook-time deduction) ═══════════
-- Called by the NestJS backend (service_role) at the EXACT moment a payment
-- is approved. Locks every variant row of the order (deterministic order →
-- no deadlocks), verifies ALL quantities, then deducts all-or-nothing.
-- Returns:
--   { "ok": true }                                       → stock deducted
--   { "ok": false, "out_of_stock": [variant_id, ...] }   → NOTHING deducted;
--     caller must refund via the payment gateway and mark order 'refunded'.
CREATE OR REPLACE FUNCTION public.store_confirm_order_stock(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_missing UUID[] := '{}';
  v_item RECORD;
BEGIN
  -- Lock all variants referenced by the order, in stable id order
  FOR v_item IN
    SELECT oi.variant_id, SUM(oi.quantity) AS qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.variant_id IS NOT NULL
    GROUP BY oi.variant_id
    ORDER BY oi.variant_id
  LOOP
    PERFORM 1 FROM public.product_variants pv
      WHERE pv.id = v_item.variant_id
      FOR UPDATE;

    IF NOT EXISTS (
      SELECT 1 FROM public.product_variants pv
      WHERE pv.id = v_item.variant_id
        AND pv.stock_quantity >= v_item.qty
    ) THEN
      v_missing := array_append(v_missing, v_item.variant_id);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    -- Insufficient stock somewhere → deduct nothing (locks released on
    -- transaction end); caller refunds the payment.
    RETURN jsonb_build_object('ok', false, 'out_of_stock', to_jsonb(v_missing));
  END IF;

  UPDATE public.product_variants pv
  SET stock_quantity = pv.stock_quantity - agg.qty
  FROM (
    SELECT oi.variant_id, SUM(oi.quantity) AS qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.variant_id IS NOT NULL
    GROUP BY oi.variant_id
  ) agg
  WHERE pv.id = agg.variant_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Restores stock when a PAID order is canceled/refunded by staff.
CREATE OR REPLACE FUNCTION public.store_restore_order_stock(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.product_variants pv
  SET stock_quantity = pv.stock_quantity + agg.qty
  FROM (
    SELECT oi.variant_id, SUM(oi.quantity) AS qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.variant_id IS NOT NULL
    GROUP BY oi.variant_id
  ) agg
  WHERE pv.id = agg.variant_id;
END;
$$;

-- Atomically consumes one coupon use; fails closed when the limit is hit.
CREATE OR REPLACE FUNCTION public.store_consume_coupon(p_coupon_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.store_coupons
  SET used_count = used_count + 1
  WHERE id = p_coupon_id
    AND active = true
    AND (max_uses IS NULL OR used_count < max_uses)
    AND (expires_at IS NULL OR expires_at > NOW())
    AND starts_at <= NOW();
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- These RPCs are backend-only: the webhook/POS paths run with service_role.
REVOKE EXECUTE ON FUNCTION public.store_confirm_order_stock(UUID) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.store_restore_order_stock(UUID) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.store_consume_coupon(UUID)      FROM authenticated, anon, public;
GRANT  EXECUTE ON FUNCTION public.store_confirm_order_stock(UUID) TO service_role;
GRANT  EXECUTE ON FUNCTION public.store_restore_order_stock(UUID) TO service_role;
GRANT  EXECUTE ON FUNCTION public.store_consume_coupon(UUID)      TO service_role;

NOTIFY pgrst, 'reload schema';
