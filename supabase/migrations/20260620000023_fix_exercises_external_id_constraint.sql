-- Replace the partial unique index with a proper UNIQUE constraint so that
-- PostgREST upsert (ON CONFLICT) works correctly.
DROP INDEX IF EXISTS idx_exercises_external_id;

ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_external_id_unique UNIQUE (external_id);

NOTIFY pgrst, 'reload schema';
