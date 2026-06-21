-- Phase 2: Motor de Treinos, horários de filial, gym_id em despesas recorrentes

-- ── Multi-tenant: gym_id em despesas recorrentes ────────────────────────────
ALTER TABLE public.recurring_expenses
  ADD COLUMN IF NOT EXISTS gym_id UUID REFERENCES public.gyms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_gym
  ON public.recurring_expenses(gym_id) WHERE gym_id IS NOT NULL;

-- ── Coleções de exercícios ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.exercise_collections (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id                     UUID REFERENCES public.gyms(id) ON DELETE SET NULL,
  name                       TEXT NOT NULL,
  description                TEXT,
  estimated_duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (estimated_duration_minutes > 0),
  created_by                 UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.collection_exercises (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id    UUID NOT NULL REFERENCES public.exercise_collections(id) ON DELETE CASCADE,
  exercise_id      UUID NOT NULL REFERENCES public.exercises(id) ON DELETE RESTRICT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  default_sets     INTEGER NOT NULL DEFAULT 3 CHECK (default_sets > 0),
  default_reps     INTEGER NOT NULL DEFAULT 12 CHECK (default_reps > 0),
  default_weight_kg NUMERIC(6, 2),
  UNIQUE (collection_id, exercise_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_exercises_collection
  ON public.collection_exercises(collection_id, sort_order);

-- ── Cronogramas de treino por aluno ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workout_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES public.exercise_collections(id) ON DELETE RESTRICT,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('weekly', 'monthly', 'session', 'custom')),
  day_of_week   INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  session_label TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_schedules_user
  ON public.workout_schedules(user_id, schedule_type, day_of_week);

-- ── Log de execução (tracking) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workout_execution_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  exercise_id   UUID NOT NULL REFERENCES public.exercises(id) ON DELETE RESTRICT,
  collection_id UUID REFERENCES public.exercise_collections(id) ON DELETE SET NULL,
  weight_kg     NUMERIC(6, 2),
  reps_done     INTEGER CHECK (reps_done IS NULL OR reps_done >= 0),
  sets_completed INTEGER CHECK (sets_completed IS NULL OR sets_completed >= 0),
  logged_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'completed'
                CHECK (status IN ('completed', 'pending_approval'))
);

CREATE INDEX IF NOT EXISTS idx_workout_execution_logs_user
  ON public.workout_execution_logs(user_id, logged_at DESC);

-- ── Horários de funcionamento por filial ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gym_operating_hours (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time   TIME NOT NULL DEFAULT '06:00',
  close_time  TIME NOT NULL DEFAULT '22:00',
  is_closed   BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (gym_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS public.gym_holidays (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id    UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  date      DATE NOT NULL,
  reason    TEXT,
  is_closed BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (gym_id, date)
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.exercise_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_holidays ENABLE ROW LEVEL SECURITY;

-- Coleções: leitura autenticada, escrita admin
CREATE POLICY "collections_select_authenticated" ON public.exercise_collections
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "collections_admin_write" ON public.exercise_collections
  FOR ALL USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "collection_exercises_select_authenticated" ON public.collection_exercises
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "collection_exercises_admin_write" ON public.collection_exercises
  FOR ALL USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Cronogramas: aluno lê o próprio, admin gerencia
CREATE POLICY "schedules_select_own" ON public.workout_schedules
  FOR SELECT USING (auth.uid() = user_id OR public.current_user_role() = 'admin');

CREATE POLICY "schedules_admin_write" ON public.workout_schedules
  FOR ALL USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Logs: aluno insere/lê o próprio, admin lê
CREATE POLICY "execution_logs_select" ON public.workout_execution_logs
  FOR SELECT USING (auth.uid() = user_id OR public.current_user_role() = 'admin');

CREATE POLICY "execution_logs_insert_own" ON public.workout_execution_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Horários: leitura autenticada, escrita admin
CREATE POLICY "operating_hours_select" ON public.gym_operating_hours
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "operating_hours_admin" ON public.gym_operating_hours
  FOR ALL USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "gym_holidays_select" ON public.gym_holidays
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "gym_holidays_admin" ON public.gym_holidays
  FOR ALL USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

NOTIFY pgrst, 'reload schema';
