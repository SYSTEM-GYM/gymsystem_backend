-- Expand public.users with physical/personal data captured at admin registration
ALTER TABLE public.users
  ADD COLUMN first_name  TEXT,
  ADD COLUMN last_name   TEXT,
  ADD COLUMN birth_date  DATE,
  ADD COLUMN weight      NUMERIC(5, 2),   -- kg, e.g. 87.50
  ADD COLUMN height      NUMERIC(5, 2),   -- cm, e.g. 175.00
  ADD COLUMN cpf         TEXT UNIQUE,
  ADD COLUMN photo_url   TEXT;            -- public URL in student-photos bucket

-- photo_url index for fast lookups from biometric module
CREATE INDEX idx_users_cpf ON public.users(cpf) WHERE cpf IS NOT NULL;
