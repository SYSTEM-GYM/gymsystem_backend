CREATE TABLE public.financial_transactions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount_cents    BIGINT      NOT NULL,
  currency        TEXT        NOT NULL DEFAULT 'BRL',
  type            TEXT        NOT NULL CHECK (type IN ('payment', 'refund', 'expense')),
  method          TEXT        CHECK (method IN ('pix', 'credit_card', 'debit_card', 'cash')),
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  description     TEXT,
  reference_id    TEXT,               -- external payment gateway reference
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;

-- Users can only view their own transactions
CREATE POLICY "financial_transactions_select_own" ON public.financial_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Only service role inserts/updates transactions (no client writes)
CREATE POLICY "financial_transactions_insert_service" ON public.financial_transactions
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "financial_transactions_update_service" ON public.financial_transactions
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE INDEX idx_financial_transactions_user_id ON public.financial_transactions(user_id);
CREATE INDEX idx_financial_transactions_created_at ON public.financial_transactions(created_at DESC);
