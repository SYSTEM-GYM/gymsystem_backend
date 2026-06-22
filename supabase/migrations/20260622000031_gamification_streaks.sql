-- ── Gamification: streaks + XP degradation ──────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS current_streak        INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak        INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_workout_date     DATE,
  ADD COLUMN IF NOT EXISTS xp_penalty_applied_at DATE;

-- Index for heatmap: student workout volume in last 15 days
CREATE INDEX IF NOT EXISTS set_logs_exercise_date_idx
  ON public.set_logs (exercise_id, created_at DESC);

CREATE INDEX IF NOT EXISTS workout_logs_student_finished_idx
  ON public.workout_logs (student_id, finished_at DESC);

-- Students can read their own profile fields (extends existing policy via OR)
-- No new policy needed — existing "users_select_own" covers new columns.

NOTIFY pgrst, 'reload schema';
