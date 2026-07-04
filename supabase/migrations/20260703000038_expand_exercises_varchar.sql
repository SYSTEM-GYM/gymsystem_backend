-- Widen exercises text columns to prevent "value too long for type character varying(50)"
-- crashes during the Cloudflare R2 batch sync (syncExercisesFromCloudflare()).
ALTER TABLE public.exercises
  ALTER COLUMN title           TYPE TEXT,
  ALTER COLUMN translated_name TYPE TEXT,
  ALTER COLUMN muscle_group    TYPE TEXT,
  ALTER COLUMN external_id     TYPE TEXT;

NOTIFY pgrst, 'reload schema';
