-- Multi-tenant: track which gym each transaction belongs to (nullable for legacy rows)
ALTER TABLE public.financial_transactions
  ADD COLUMN gym_id UUID REFERENCES public.gyms(id) ON DELETE SET NULL;

CREATE INDEX idx_financial_transactions_gym_id ON public.financial_transactions(gym_id);
