-- Rebrand the original branch ("Filial Pequizeiro" → "GYM CONNECT") and make it
-- the default home gym for every new auth user.
--
-- The default is tracked by a flag (gyms.is_default) instead of a name lookup,
-- so renaming the branch later in Settings never breaks sign-up.

-- ── 1. Default gym flag (at most one row may be the default) ────────────────
ALTER TABLE public.gyms
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gyms_single_default
  ON public.gyms ((is_default))
  WHERE is_default;

-- ── 2. Rename, flag as default and backfill customers without a home gym ───
DO $$
DECLARE
  target_gym_id UUID;
BEGIN
  -- Prefer the original branch; fall back to an already-renamed one so the
  -- migration is idempotent.
  SELECT id
    INTO target_gym_id
    FROM public.gyms
    WHERE name IN ('Filial Pequizeiro', 'GYM CONNECT')
    ORDER BY (name = 'Filial Pequizeiro') DESC, created_at
    LIMIT 1;

  IF target_gym_id IS NULL THEN
    RAISE NOTICE 'default_gym_connect: no "Filial Pequizeiro"/"GYM CONNECT" gym found — skipping rename/backfill';
    RETURN;
  END IF;

  UPDATE public.gyms
    SET name = 'GYM CONNECT', updated_at = NOW()
    WHERE id = target_gym_id;

  UPDATE public.gyms
    SET is_default = false
    WHERE is_default AND id <> target_gym_id;

  UPDATE public.gyms
    SET is_default = true
    WHERE id = target_gym_id;

  -- Customers only: staff/master accounts may be gym-less on purpose, and a
  -- gym_id claim would grant them staff access via is_gym_staff()/is_gym_team().
  UPDATE public.users
    SET home_gym_id = target_gym_id
    WHERE home_gym_id IS NULL
      AND role = 'customer';
END;
$$;

-- ── 3. New-user trigger: link every new profile to the default gym ─────────
-- Admin-driven registration (registerStudent) still overrides home_gym_id
-- right after createUser, so branch-specific sign-ups keep working.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_gym_id UUID;
BEGIN
  SELECT id INTO default_gym_id
    FROM public.gyms
    WHERE is_default
    LIMIT 1;

  INSERT INTO public.users (id, full_name, role, home_gym_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    'customer',
    default_gym_id
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
