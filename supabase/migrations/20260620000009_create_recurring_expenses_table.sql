-- Template table for fixed monthly expenses.
-- The cron job reads this daily and generates financial_transactions rows.
CREATE TABLE public.recurring_expenses (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  description  TEXT,
  amount       NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  category     TEXT        NOT NULL CHECK (category IN (
                  'rent', 'energy', 'water', 'payroll',
                  'maintenance', 'supplies', 'equipment', 'other'
               )),
  day_of_month INTEGER     NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;

-- Only admins can manage recurring expense templates
CREATE POLICY "recurring_expenses_admin_all" ON public.recurring_expenses
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE INDEX idx_recurring_expenses_active_day
  ON public.recurring_expenses(is_active, day_of_month)
  WHERE is_active = true;

-- Seed with common gym fixed costs for demonstration
INSERT INTO public.recurring_expenses (name, description, amount, category, day_of_month) VALUES
  ('Aluguel do Espaço',       'Mensalidade do imóvel',          3500.00, 'rent',        5),
  ('Energia Elétrica',        'Conta de luz estimada',           800.00, 'energy',      10),
  ('Conta de Água',           'Conta de água estimada',          120.00, 'water',       10),
  ('Folha de Pagamento',      'Salários dos funcionários',      6200.00, 'payroll',      5),
  ('Manutenção de Equipamentos', 'Revisão mensal de aparelhos',  350.00, 'maintenance', 15);
