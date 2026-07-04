-- Student PWA access fixes after the multi-tenant RLS migration.
--
-- Audit result of student-facing SELECT paths:
--   public.users              → "users_select_own" (auth.uid() = id)      ✔ customers OK
--   public.exercises           → "exercises_select_authenticated"          ✔ customers OK
--   public.exercise_collections/collection_exercises/workout_schedules    ✔ customers OK
--   public.gyms                → ONLY "gyms_select_owner" (admin + owner) ✘ customers see
--                                 nothing, so the app shows "Nenhuma filial vinculada"
--
-- This migration closes the gyms gap and hardens users_update_own with an
-- explicit WITH CHECK for the new self-service profile editing.

-- ── 1. Helper: home gym of the calling user ─────────────────────────────────
-- SECURITY DEFINER so the gyms policy doesn't depend on users RLS evaluation
-- order (same pattern as public.current_user_role()).
CREATE OR REPLACE FUNCTION public.current_user_gym_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT home_gym_id FROM public.users WHERE id = auth.uid() $$;

-- ── 2. Members can read their own linked gym ────────────────────────────────
-- Grants read of the single gyms row referenced by users.home_gym_id, for any
-- authenticated role (customer, trainer, receptionist). Admin/owner policies
-- remain untouched and are OR-ed with this one (PERMISSIVE).
DROP POLICY IF EXISTS "gyms_select_member" ON public.gyms;
CREATE POLICY "gyms_select_member" ON public.gyms
  FOR SELECT TO authenticated
  USING (id = public.current_user_gym_id());

-- ── 3. Self-service profile updates ─────────────────────────────────────────
-- users_update_own had USING but no WITH CHECK; make the write barrier
-- explicit so a user can never move a row to another id.
DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

NOTIFY pgrst, 'reload schema';
