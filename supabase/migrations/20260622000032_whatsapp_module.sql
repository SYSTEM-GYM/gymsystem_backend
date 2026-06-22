-- ── WhatsApp CRM Module ──────────────────────────────────────────────────────

-- Contacts: one per student, keyed on their WhatsApp phone number
CREATE TABLE IF NOT EXISTS public.wa_contacts (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID         REFERENCES public.users(id) ON DELETE SET NULL,
  phone       VARCHAR(20)  NOT NULL UNIQUE,    -- E.164 format: +5511999999999
  name        VARCHAR(100),                     -- display name (from WA or manual)
  opt_in      BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_contacts_student_idx  ON public.wa_contacts(student_id);
CREATE INDEX IF NOT EXISTS wa_contacts_phone_idx    ON public.wa_contacts(phone);

-- Messages: every inbound/outbound WhatsApp message
CREATE TABLE IF NOT EXISTS public.wa_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID        NOT NULL REFERENCES public.wa_contacts(id) ON DELETE CASCADE,
  direction       VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content         TEXT        NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  wa_message_id   TEXT,                          -- external ID from WA Business API
  sent_by         UUID        REFERENCES public.users(id) ON DELETE SET NULL, -- admin who sent
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_messages_contact_idx  ON public.wa_messages(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wa_messages_wa_id_idx    ON public.wa_messages(wa_message_id) WHERE wa_message_id IS NOT NULL;

-- Templates: reusable message templates (maps to WA Business approved templates)
CREATE TABLE IF NOT EXISTS public.wa_templates (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(100) NOT NULL UNIQUE,
  content_template TEXT         NOT NULL,    -- use {{1}}, {{2}} for variables
  type             VARCHAR(20)  NOT NULL CHECK (type IN ('billing', 'promo', 'welcome', 'reminder')),
  variables        TEXT[]       NOT NULL DEFAULT '{}',  -- variable names for UI
  active           BOOLEAN      NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Automations: trigger-based auto-sends
CREATE TABLE IF NOT EXISTS public.wa_automations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type   VARCHAR(30) NOT NULL UNIQUE
                 CHECK (trigger_type IN ('renewal_3d', 'renewal_1d', 'birthday', 'welcome', 'overdue')),
  template_id    UUID        REFERENCES public.wa_templates(id) ON DELETE SET NULL,
  active         BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default automations (all inactive until admin enables)
INSERT INTO public.wa_automations (trigger_type, active) VALUES
  ('renewal_3d', false),
  ('renewal_1d', false),
  ('birthday',   false),
  ('welcome',    false),
  ('overdue',    false)
ON CONFLICT (trigger_type) DO NOTHING;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.wa_contacts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_automations ENABLE ROW LEVEL SECURITY;

-- Admins have full access
CREATE POLICY "wa_contacts_admin_all"
  ON public.wa_contacts FOR ALL
  USING   (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "wa_messages_admin_all"
  ON public.wa_messages FOR ALL
  USING   (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "wa_templates_admin_all"
  ON public.wa_templates FOR ALL
  USING   (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "wa_automations_admin_all"
  ON public.wa_automations FOR ALL
  USING   (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

NOTIFY pgrst, 'reload schema';
