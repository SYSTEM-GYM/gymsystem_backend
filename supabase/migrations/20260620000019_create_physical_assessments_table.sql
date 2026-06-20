-- Physical assessments history per student
CREATE TABLE public.physical_assessments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date                DATE NOT NULL DEFAULT CURRENT_DATE,
  weight              NUMERIC(5,2),
  height              NUMERIC(5,2),
  body_fat_percentage NUMERIC(5,2),
  lean_mass           NUMERIC(5,2),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.physical_assessments ENABLE ROW LEVEL SECURITY;

-- Admin can read/write assessments for students of their gym
CREATE POLICY "admin_manage_assessments"
  ON public.physical_assessments
  FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Students can read their own assessments
CREATE POLICY "student_read_own_assessments"
  ON public.physical_assessments
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX idx_physical_assessments_user_id ON public.physical_assessments(user_id);
CREATE INDEX idx_physical_assessments_date    ON public.physical_assessments(date DESC);
