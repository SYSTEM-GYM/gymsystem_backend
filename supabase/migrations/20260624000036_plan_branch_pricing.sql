-- ── Plan Branch Pricing ──────────────────────────────────────────────────────
-- Allows a single gym plan to have different prices per branch (filial).
-- The gym_plans.price column is kept as a global fallback.

CREATE TABLE IF NOT EXISTS public.plan_branch_pricing (
  id            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       uuid           NOT NULL REFERENCES public.gym_plans(id)  ON DELETE CASCADE,
  gym_id        uuid           NOT NULL REFERENCES public.gyms(id)       ON DELETE CASCADE,
  monthly_price DECIMAL(10,2)  NOT NULL CHECK (monthly_price >= 0),
  active        BOOLEAN        NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
  UNIQUE (plan_id, gym_id)
);

CREATE INDEX IF NOT EXISTS plan_branch_pricing_plan_idx ON public.plan_branch_pricing(plan_id);
CREATE INDEX IF NOT EXISTS plan_branch_pricing_gym_idx  ON public.plan_branch_pricing(gym_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.plan_branch_pricing ENABLE ROW LEVEL SECURITY;

-- Admins can do everything (service role bypasses RLS anyway)
CREATE POLICY "branch_pricing_admin_all"
  ON public.plan_branch_pricing
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Students can read active pricings for their own gym
CREATE POLICY "branch_pricing_student_read"
  ON public.plan_branch_pricing FOR SELECT
  USING (
    active = true
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.home_gym_id = plan_branch_pricing.gym_id
    )
  );

NOTIFY pgrst, 'reload schema';
