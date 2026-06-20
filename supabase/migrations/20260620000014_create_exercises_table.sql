-- Exercise library: admin-created, shared across all gyms
CREATE TABLE public.exercises (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT        NOT NULL,
  description  TEXT,
  -- Optional video: either a YouTube embed URL or a WebM file in Supabase Storage
  youtube_url  TEXT,
  webm_path    TEXT,        -- path within the 'exercises' storage bucket
  created_by   UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;

-- All authenticated users can browse exercises (needed for workout builder)
CREATE POLICY "exercises_select_authenticated" ON public.exercises
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only admins can create/update/delete exercises
CREATE POLICY "exercises_insert_admin" ON public.exercises
  FOR INSERT WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "exercises_update_admin" ON public.exercises
  FOR UPDATE USING (public.current_user_role() = 'admin');

CREATE POLICY "exercises_delete_admin" ON public.exercises
  FOR DELETE USING (public.current_user_role() = 'admin');

CREATE INDEX idx_exercises_created_by ON public.exercises(created_by);
