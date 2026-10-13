-- Students can now delete the workouts they created. workout_logs referenced
-- the collection with ON DELETE CASCADE, so deleting a workout also wiped its
-- session history and set_logs (muscle radar, squad leaderboard counts).
-- Keep the history and just detach it from the deleted collection.

ALTER TABLE public.workout_logs
  ALTER COLUMN collection_id DROP NOT NULL;

-- Drop every FK on workout_logs.collection_id, whatever its name, so the
-- CASCADE cannot survive next to the new constraint.
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'public.workout_logs'::regclass
       AND con.contype = 'f'
       AND att.attname = 'collection_id'
  LOOP
    EXECUTE format('ALTER TABLE public.workout_logs DROP CONSTRAINT %I', fk.conname);
  END LOOP;
END $$;

ALTER TABLE public.workout_logs
  ADD CONSTRAINT workout_logs_collection_id_fkey
  FOREIGN KEY (collection_id)
  REFERENCES public.exercise_collections(id)
  ON DELETE SET NULL;
