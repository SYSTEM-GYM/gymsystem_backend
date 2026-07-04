-- Phase 4: White-label tenant resolution. Adds a public subdomain slug and a
-- JSONB bag for branding overrides (logo, theme colors) per gym. Additive
-- only — both columns are nullable, no existing row or query is affected.
ALTER TABLE public.gyms
  ADD COLUMN IF NOT EXISTS slug VARCHAR(63),
  ADD COLUMN IF NOT EXISTS white_label_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gyms_slug ON public.gyms(slug) WHERE slug IS NOT NULL;

-- No new RLS policy needed: the frontend resolves tenant branding via the
-- service_role (admin) client in a Server Component, which bypasses RLS —
-- this table is never queried for branding from the browser/anon context.

NOTIFY pgrst, 'reload schema';
