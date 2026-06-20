-- Replaces the initial financial_transactions table with the correct business schema.
-- The original migration used amount_cents + payment-gateway types.
-- This version uses decimal amounts, income/expense classification, categories, and due dates.

DROP TABLE IF EXISTS public.financial_transactions;

CREATE TABLE public.financial_transactions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount      NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  type        TEXT        NOT NULL CHECK (type IN ('income', 'expense')),
  category    TEXT        NOT NULL CHECK (category IN ('subscription', 'rent', 'energy', 'payroll', 'other')),
  status      TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue')),
  description TEXT,
  due_date    DATE,
  paid_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;

-- Helper: resolve role of the calling user without exposing public.users to clients
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT role FROM public.users WHERE id = auth.uid() $$;

-- Admins can read every transaction
CREATE POLICY "financial_transactions_admin_select" ON public.financial_transactions
  FOR SELECT USING (public.current_user_role() = 'admin');

-- Admins can insert any transaction
CREATE POLICY "financial_transactions_admin_insert" ON public.financial_transactions
  FOR INSERT WITH CHECK (public.current_user_role() = 'admin');

-- Admins can update any transaction
CREATE POLICY "financial_transactions_admin_update" ON public.financial_transactions
  FOR UPDATE USING (public.current_user_role() = 'admin');

-- Customers can only view their own income records (payment history)
CREATE POLICY "financial_transactions_customer_select_own_income" ON public.financial_transactions
  FOR SELECT USING (
    auth.uid() = user_id
    AND type = 'income'
    AND public.current_user_role() = 'customer'
  );

CREATE INDEX idx_financial_transactions_user_id   ON public.financial_transactions(user_id);
CREATE INDEX idx_financial_transactions_due_date  ON public.financial_transactions(due_date);
CREATE INDEX idx_financial_transactions_type_status ON public.financial_transactions(type, status);
