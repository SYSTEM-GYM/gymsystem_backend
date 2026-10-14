-- The workout builder filters exercises by muscle_group using the keys of
-- MUSCLE_GROUP_LABELS (chest, back, shoulders, biceps, triceps, legs, glutes,
-- core, cardio, full_body). Migration 037 derived muscle_group only from the
-- ExerciseDB vocabulary ("pectorals", "delts", "abs"), but the imported data
-- uses free-exercise-db names ("chest", "shoulders", "abdominals",
-- "middle back") and gym_importer/translator.js rewrites some of them in pt-BR.
-- Those rows were left with muscle_group = NULL, so the Peito/Ombros/Core
-- filters returned nothing.

-- ── 1. Single source of truth: primary_muscle (EN or pt-BR) → filter key ────
CREATE OR REPLACE FUNCTION public.muscle_group_for(primary_muscle TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(trim(primary_muscle))
    WHEN 'chest'                 THEN 'chest'
    WHEN 'pectorals'             THEN 'chest'
    WHEN 'upper chest'           THEN 'chest'
    WHEN 'serratus anterior'     THEN 'chest'
    WHEN 'peitorais'             THEN 'chest'
    WHEN 'serrátil anterior'     THEN 'chest'

    WHEN 'lats'                  THEN 'back'
    WHEN 'traps'                 THEN 'back'
    WHEN 'upper back'            THEN 'back'
    WHEN 'middle back'           THEN 'back'
    WHEN 'lower back'            THEN 'back'
    WHEN 'spine'                 THEN 'back'
    WHEN 'neck'                  THEN 'back'
    WHEN 'rhomboids'             THEN 'back'
    WHEN 'levator scapulae'      THEN 'back'
    WHEN 'latíssimo do dorso'    THEN 'back'
    WHEN 'trapézio'              THEN 'back'
    WHEN 'costas superiores'     THEN 'back'
    WHEN 'coluna vertebral'      THEN 'back'
    WHEN 'elevador da escápula'  THEN 'back'

    WHEN 'shoulders'             THEN 'shoulders'
    WHEN 'delts'                 THEN 'shoulders'
    WHEN 'front delts'           THEN 'shoulders'
    WHEN 'rear delts'            THEN 'shoulders'
    WHEN 'lateral delts'         THEN 'shoulders'
    WHEN 'deltoides'             THEN 'shoulders'

    WHEN 'biceps'                THEN 'biceps'
    WHEN 'forearms'              THEN 'biceps'
    WHEN 'bíceps'                THEN 'biceps'
    WHEN 'antebraços'            THEN 'biceps'

    WHEN 'triceps'               THEN 'triceps'
    WHEN 'tríceps'               THEN 'triceps'

    WHEN 'quads'                 THEN 'legs'
    WHEN 'quadriceps'            THEN 'legs'
    WHEN 'hamstrings'            THEN 'legs'
    WHEN 'calves'                THEN 'legs'
    WHEN 'adductors'             THEN 'legs'
    WHEN 'abductors'             THEN 'legs'
    WHEN 'quadríceps'            THEN 'legs'
    WHEN 'isquiotibiais'         THEN 'legs'
    WHEN 'panturrilhas'          THEN 'legs'
    WHEN 'adutores'              THEN 'legs'
    WHEN 'abdutores'             THEN 'legs'

    WHEN 'glutes'                THEN 'glutes'
    WHEN 'glúteos'               THEN 'glutes'

    WHEN 'abdominals'            THEN 'core'
    WHEN 'abs'                   THEN 'core'
    WHEN 'upper abs'             THEN 'core'
    WHEN 'lower abs'             THEN 'core'
    WHEN 'obliques'              THEN 'core'
    WHEN 'abdômen'               THEN 'core'

    WHEN 'cardiovascular system' THEN 'cardio'
    WHEN 'sistema cardiovascular' THEN 'cardio'

    WHEN 'full body'             THEN 'full_body'
    ELSE NULL
  END
$$;

-- ── 2. Backfill rows still missing a group (keeps manual admin choices) ─────
UPDATE public.exercises
   SET muscle_group = public.muscle_group_for(primary_muscle)
 WHERE muscle_group IS NULL
   AND public.muscle_group_for(primary_muscle) IS NOT NULL;

-- ── 3. Keep future imports consistent ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.exercises_fill_muscle_group()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.muscle_group IS NULL THEN
    NEW.muscle_group := public.muscle_group_for(NEW.primary_muscle);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exercises_fill_muscle_group ON public.exercises;
CREATE TRIGGER trg_exercises_fill_muscle_group
  BEFORE INSERT OR UPDATE OF primary_muscle, muscle_group ON public.exercises
  FOR EACH ROW
  EXECUTE FUNCTION public.exercises_fill_muscle_group();
