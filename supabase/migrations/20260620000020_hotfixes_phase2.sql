-- Phase 2 hotfixes: status banned, anamnesis JSON, audit trail, schema reload

-- Normalize legacy blocked status → banned
UPDATE public.users SET status = 'banned' WHERE status = 'blocked';

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'inactive', 'banned'));

-- Structured anamnesis checklist (checkboxes)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS anamnesis_data JSONB NOT NULL DEFAULT '{}';

-- Audit trail for admin actions
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   UUID NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_audit_logs" ON public.audit_logs;
CREATE POLICY "admin_read_audit_logs"
  ON public.audit_logs
  FOR SELECT
  USING (public.current_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
  ON public.audit_logs (resource_type, resource_id, created_at DESC);

-- Reload PostgREST schema cache (fixes PGRST205)
NOTIFY pgrst, 'reload schema';
