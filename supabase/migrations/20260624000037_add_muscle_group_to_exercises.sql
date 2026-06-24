-- Add muscle_group to exercises
-- Stores a high-level body-area label (chest, back, legs, etc.)
-- Backfilled from primary_muscle using ExerciseDB target→bodyPart mapping.
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS muscle_group VARCHAR(100);

-- Best-effort backfill: map ExerciseDB target values → body area categories
UPDATE public.exercises
SET muscle_group = CASE
  WHEN primary_muscle IN ('pectorals', 'upper chest', 'serratus anterior') THEN 'chest'
  WHEN primary_muscle IN ('lats', 'traps', 'upper back', 'lower back', 'spine', 'rhomboids', 'infraspinatus', 'teres major') THEN 'back'
  WHEN primary_muscle IN ('delts', 'front delts', 'rear delts', 'lateral delts') THEN 'shoulders'
  WHEN primary_muscle IN ('biceps', 'forearms', 'brachialis', 'brachioradialis') THEN 'biceps'
  WHEN primary_muscle IN ('triceps', 'anconeus') THEN 'triceps'
  WHEN primary_muscle IN ('quads', 'quadriceps', 'hamstrings', 'calves', 'adductors', 'abductors', 'tibialis anterior') THEN 'legs'
  WHEN primary_muscle IN ('glutes', 'hip flexors') THEN 'glutes'
  WHEN primary_muscle IN ('abs', 'upper abs', 'lower abs', 'obliques', 'transverse abdominis') THEN 'core'
  WHEN primary_muscle IN ('cardiovascular system') THEN 'cardio'
  ELSE NULL
END
WHERE primary_muscle IS NOT NULL AND muscle_group IS NULL;

CREATE INDEX IF NOT EXISTS idx_exercises_muscle_group
  ON public.exercises(muscle_group) WHERE muscle_group IS NOT NULL;

NOTIFY pgrst, 'reload schema';
