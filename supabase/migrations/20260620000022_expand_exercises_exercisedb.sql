-- Expand exercises table to support ExerciseDB fields and R2 media
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS external_id    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS translated_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS primary_muscle  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS secondary_muscles TEXT[],
  ADD COLUMN IF NOT EXISTS equipment      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS difficulty     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS instructions   TEXT,
  ADD COLUMN IF NOT EXISTS common_errors  TEXT,
  ADD COLUMN IF NOT EXISTS tips           TEXT,
  ADD COLUMN IF NOT EXISTS video_url      TEXT;  -- R2 public URL (or Supabase Storage URL)

CREATE UNIQUE INDEX IF NOT EXISTS idx_exercises_external_id
  ON public.exercises(external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exercises_primary_muscle
  ON public.exercises(primary_muscle) WHERE primary_muscle IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exercises_equipment
  ON public.exercises(equipment) WHERE equipment IS NOT NULL;

NOTIFY pgrst, 'reload schema';
