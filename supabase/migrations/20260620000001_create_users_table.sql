-- Extends Supabase auth.users with application-specific profile data
CREATE TABLE public.users (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT        NOT NULL,
  phone         TEXT,
  plan_type     TEXT        NOT NULL DEFAULT 'basic' CHECK (plan_type IN ('basic', 'premium', 'vip')),
  status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'blocked')),
  experience_points BIGINT  NOT NULL DEFAULT 0,
  -- Biometric: store only irreversible embedding hash, never raw image (LGPD)
  face_embedding_hash TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users can only read and update their own profile
CREATE POLICY "users_select_own" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- Service role (backend) can insert on user registration
CREATE POLICY "users_insert_service" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);
