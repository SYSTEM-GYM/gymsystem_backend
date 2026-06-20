-- Add 'ecommerce' as a valid transaction category
ALTER TABLE public.financial_transactions
  DROP CONSTRAINT IF EXISTS financial_transactions_category_check;

ALTER TABLE public.financial_transactions
  ADD CONSTRAINT financial_transactions_category_check
    CHECK (category IN ('subscription', 'rent', 'energy', 'payroll', 'ecommerce', 'other'));
