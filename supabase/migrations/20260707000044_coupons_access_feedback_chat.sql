-- ═══════════════════════════════════════════════════════════════════════════
-- Expansion 044 — Coupon targeting/flash sales, turnstile access logs,
-- gym hardware settings, anonymous feedback, staff team chat.
--
-- Uses the jwt_gym_id()/jwt_role()/is_gym_staff() helpers from migration 043.
-- All new tables carry gym_id and strict tenant RLS.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Team helper: staff + trainers (chat interno inclui personal) ─────────
CREATE OR REPLACE FUNCTION public.is_gym_team()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT public.jwt_role() IN ('admin', 'gym_admin', 'master', 'receptionist', 'trainer')
$$;

-- ── 1. Coupons: flash-sale precision + targeting ─────────────────────────────
-- expires_at is already TIMESTAMPTZ (exact-time validity works since 043);
-- documented here for the record. Targeting: empty arrays = whole store.
COMMENT ON COLUMN public.store_coupons.expires_at IS
  'Exact expiry instant (TIMESTAMPTZ) — supports flash sales down to the minute.';

ALTER TABLE public.store_coupons
  ADD COLUMN IF NOT EXISTS target_skus       TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_categories TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.store_coupons.target_skus IS
  'SKUs elegíveis; vazio = loja inteira. Aplicado pelo CatalogService no backend.';
COMMENT ON COLUMN public.store_coupons.target_categories IS
  'IDs de store_categories elegíveis; vazio = loja inteira.';

-- ── 2. access_logs (catraca) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.access_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  entry_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exit_time   TIMESTAMPTZ,
  method      VARCHAR(12) NOT NULL DEFAULT 'qr'
              CHECK (method IN ('qr', 'facial', 'manual')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (exit_time IS NULL OR exit_time >= entry_time)
);

CREATE INDEX IF NOT EXISTS idx_access_logs_gym_entry
  ON public.access_logs(gym_id, entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_student
  ON public.access_logs(student_id, entry_time DESC);
-- Fast lookup of "still inside" sessions for exit matching / occupancy
CREATE INDEX IF NOT EXISTS idx_access_logs_open
  ON public.access_logs(gym_id, student_id) WHERE exit_time IS NULL;

ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;

-- Staff see and manage their gym's logs (manual mode + corrections)
CREATE POLICY "access_logs_staff_all" ON public.access_logs
  FOR ALL TO authenticated
  USING (public.is_gym_staff() AND gym_id = public.jwt_gym_id())
  WITH CHECK (public.is_gym_staff() AND gym_id = public.jwt_gym_id());

-- Students see their own attendance history
CREATE POLICY "access_logs_student_read" ON public.access_logs
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- ── 3. gym_hardware_settings ─────────────────────────────────────────────────
-- One row per gym; `extra` absorbs vendor-specific knobs without migrations.
CREATE TABLE IF NOT EXISTS public.gym_hardware_settings (
  gym_id          UUID PRIMARY KEY REFERENCES public.gyms(id) ON DELETE CASCADE,
  turnstile_mode  VARCHAR(12) NOT NULL DEFAULT 'qr'
                  CHECK (turnstile_mode IN ('qr', 'facial', 'manual')),
  ip_address      VARCHAR(45),          -- IPv4/IPv6 do controlador local
  extra           JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.gym_hardware_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gym_hardware_staff_all" ON public.gym_hardware_settings
  FOR ALL TO authenticated
  USING (public.is_gym_staff() AND gym_id = public.jwt_gym_id())
  WITH CHECK (public.is_gym_staff() AND gym_id = public.jwt_gym_id());

-- ── 4. anonymous_feedbacks ───────────────────────────────────────────────────
-- student_id is STORED for abuse handling/reply routing but NEVER exposed to
-- gym staff: there is deliberately NO staff SELECT policy on this table.
-- Admin flows read via the backend/server actions (service_role) which strip
-- student_id before returning data. Students read their own rows to see the
-- reply.
CREATE TABLE IF NOT EXISTS public.anonymous_feedbacks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id       UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  student_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message      TEXT NOT NULL CHECK (char_length(message) BETWEEN 5 AND 2000),
  admin_reply  TEXT,
  is_resolved  BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replied_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_anonymous_feedbacks_gym
  ON public.anonymous_feedbacks(gym_id, is_resolved, created_at DESC);

ALTER TABLE public.anonymous_feedbacks ENABLE ROW LEVEL SECURITY;

-- Student: send feedback to own gym, read own submissions (sees the reply)
CREATE POLICY "anonymous_feedbacks_student_insert" ON public.anonymous_feedbacks
  FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid() AND gym_id = public.jwt_gym_id());

CREATE POLICY "anonymous_feedbacks_student_read" ON public.anonymous_feedbacks
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- NOTE: intentionally no staff policies — anonymity is enforced at the RLS
-- layer, not just in the UI. Replies are written via service_role.

-- ── 5. team_messages (chat interno da equipe) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_messages_gym
  ON public.team_messages(gym_id, created_at DESC);

ALTER TABLE public.team_messages ENABLE ROW LEVEL SECURITY;

-- Team (staff + trainers) of the same gym read the channel
CREATE POLICY "team_messages_team_read" ON public.team_messages
  FOR SELECT TO authenticated
  USING (public.is_gym_team() AND gym_id = public.jwt_gym_id());

-- Members post as themselves only
CREATE POLICY "team_messages_team_insert" ON public.team_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_gym_team()
    AND gym_id = public.jwt_gym_id()
    AND sender_id = auth.uid()
  );

-- Sender may delete own message; gym admins moderate anything in their gym
CREATE POLICY "team_messages_delete" ON public.team_messages
  FOR DELETE TO authenticated
  USING (
    (sender_id = auth.uid() AND public.is_gym_team())
    OR (public.is_gym_staff() AND gym_id = public.jwt_gym_id())
  );

-- Realtime for the chat channel
ALTER PUBLICATION supabase_realtime ADD TABLE public.team_messages;

NOTIFY pgrst, 'reload schema';
