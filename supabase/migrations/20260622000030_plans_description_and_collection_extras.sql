-- Add description to gym_plans
ALTER TABLE public.gym_plans
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Add weight, rest, notes to collection_exercises
ALTER TABLE public.collection_exercises
  ADD COLUMN IF NOT EXISTS rest_seconds INTEGER NOT NULL DEFAULT 90 CHECK (rest_seconds >= 0),
  ADD COLUMN IF NOT EXISTS notes        TEXT;
