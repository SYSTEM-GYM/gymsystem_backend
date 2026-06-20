-- Multi-tenant: each gym is an independent branch owned by an admin user
CREATE TABLE public.gyms (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  city        TEXT        NOT NULL,
  owner_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.gyms ENABLE ROW LEVEL SECURITY;

-- Admins can view all gyms they own; customers see none (nav guards handle UI)
CREATE POLICY "gyms_select_owner" ON public.gyms
  FOR SELECT USING (
    public.current_user_role() = 'admin'
    AND owner_id = auth.uid()
  );

-- Only admins can create gyms
CREATE POLICY "gyms_insert_admin" ON public.gyms
  FOR INSERT WITH CHECK (
    public.current_user_role() = 'admin'
    AND owner_id = auth.uid()
  );

CREATE POLICY "gyms_update_owner" ON public.gyms
  FOR UPDATE USING (
    public.current_user_role() = 'admin'
    AND owner_id = auth.uid()
  );

CREATE POLICY "gyms_delete_owner" ON public.gyms
  FOR DELETE USING (
    public.current_user_role() = 'admin'
    AND owner_id = auth.uid()
  );

CREATE INDEX idx_gyms_owner_id ON public.gyms(owner_id);
