-- Expand expense categories to support full gym cost breakdown
ALTER TABLE public.financial_transactions
  DROP CONSTRAINT IF EXISTS financial_transactions_category_check;

ALTER TABLE public.financial_transactions
  ADD CONSTRAINT financial_transactions_category_check
    CHECK (category IN (
      'subscription',
      'ecommerce',
      'rent',
      'energy',
      'water',
      'payroll',
      'maintenance',
      'supplies',
      'equipment',
      'other'
    ));
