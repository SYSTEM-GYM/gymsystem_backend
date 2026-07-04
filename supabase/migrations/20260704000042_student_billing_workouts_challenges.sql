-- Student self-service phase 2:
--   A. Billing visibility  → fixes the "plano inativo" bug: gym_subscriptions /
--      gym_plans / gym_invoices only had admin policies, so the student client
--      always saw zero rows and the wallet rendered "sem assinatura".
--      (Status values are lowercase everywhere — no case-sensitivity issue.)
--   B. Student-created workouts → owner-scoped CRUD on collections + schedules.
--   C. Challenge opt-in + photo proof → participation table + storage bucket.

-- ── A. Billing: students read their own rows ────────────────────────────────
DROP POLICY IF EXISTS "gym_subscriptions_student_read" ON public.gym_subscriptions;
CREATE POLICY "gym_subscriptions_student_read" ON public.gym_subscriptions
  FOR SELECT TO authenticated
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "gym_invoices_student_read" ON public.gym_invoices;
CREATE POLICY "gym_invoices_student_read" ON public.gym_invoices
  FOR SELECT TO authenticated
  USING (auth.uid() = student_id);

-- Active plans are catalog data for the in-app checkout.
DROP POLICY IF EXISTS "gym_plans_member_read" ON public.gym_plans;
CREATE POLICY "gym_plans_member_read" ON public.gym_plans
  FOR SELECT TO authenticated
  USING (active = true);

-- ── B. Student custom workouts (owner-scoped) ───────────────────────────────
-- exercise_collections: any authenticated user may create collections they own
-- and manage only those. Admin policies remain untouched (PERMISSIVE OR).
DROP POLICY IF EXISTS "collections_owner_insert" ON public.exercise_collections;
CREATE POLICY "collections_owner_insert" ON public.exercise_collections
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "collections_owner_update" ON public.exercise_collections;
CREATE POLICY "collections_owner_update" ON public.exercise_collections
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "collections_owner_delete" ON public.exercise_collections;
CREATE POLICY "collections_owner_delete" ON public.exercise_collections
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- collection_exercises: writable when the parent collection is owned
DROP POLICY IF EXISTS "collection_exercises_owner_write" ON public.collection_exercises;
CREATE POLICY "collection_exercises_owner_write" ON public.collection_exercises
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.exercise_collections c
      WHERE c.id = collection_exercises.collection_id
        AND c.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.exercise_collections c
      WHERE c.id = collection_exercises.collection_id
        AND c.created_by = auth.uid()
    )
  );

-- workout_schedules: students manage their own schedule rows so a custom
-- workout can appear on their shelf without admin intervention.
DROP POLICY IF EXISTS "schedules_self_insert" ON public.workout_schedules;
CREATE POLICY "schedules_self_insert" ON public.workout_schedules
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "schedules_self_delete" ON public.workout_schedules;
CREATE POLICY "schedules_self_delete" ON public.workout_schedules
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── C. Challenge participation (explicit opt-in) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.challenge_participants (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id       UUID NOT NULL REFERENCES public.squad_challenges(id) ON DELETE CASCADE,
  student_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  proof_photo_url    TEXT,
  proof_uploaded_at  TIMESTAMPTZ,
  UNIQUE (challenge_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_participants_challenge
  ON public.challenge_participants(challenge_id);

ALTER TABLE public.challenge_participants ENABLE ROW LEVEL SECURITY;

-- Squad members can see who is participating (and their proofs)
DROP POLICY IF EXISTS "challenge_participants_read" ON public.challenge_participants;
CREATE POLICY "challenge_participants_read" ON public.challenge_participants
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.squad_challenges ch
      JOIN public.gymconnect_squad_members m ON m.squad_id = ch.squad_id
      WHERE ch.id = challenge_participants.challenge_id
        AND m.student_id = auth.uid()
    )
  );

-- A member joins a challenge for themself only, and only in their own squad
DROP POLICY IF EXISTS "challenge_participants_join" ON public.challenge_participants;
CREATE POLICY "challenge_participants_join" ON public.challenge_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.squad_challenges ch
      JOIN public.gymconnect_squad_members m ON m.squad_id = ch.squad_id
      WHERE ch.id = challenge_participants.challenge_id
        AND m.student_id = auth.uid()
    )
  );

-- Participants update their own row (proof photo) or withdraw
DROP POLICY IF EXISTS "challenge_participants_update_own" ON public.challenge_participants;
CREATE POLICY "challenge_participants_update_own" ON public.challenge_participants
  FOR UPDATE TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "challenge_participants_delete_own" ON public.challenge_participants;
CREATE POLICY "challenge_participants_delete_own" ON public.challenge_participants
  FOR DELETE TO authenticated
  USING (student_id = auth.uid());

-- ── Storage: challenge proof photos ─────────────────────────────────────────
-- Same pattern as student-photos: public bucket, URL stored on the row.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'challenge-proofs',
  'challenge-proofs',
  true,                           -- public: proof_photo_url stored as plain URL
  8388608,                        -- 8 MB per photo
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Anyone authenticated can view (bucket is public anyway; this covers list ops)
DROP POLICY IF EXISTS "challenge_proofs_select" ON storage.objects;
CREATE POLICY "challenge_proofs_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'challenge-proofs');

-- Students upload only inside their own {user_id}/ folder
DROP POLICY IF EXISTS "challenge_proofs_insert_own" ON storage.objects;
CREATE POLICY "challenge_proofs_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'challenge-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "challenge_proofs_update_own" ON storage.objects;
CREATE POLICY "challenge_proofs_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'challenge-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "challenge_proofs_delete_own" ON storage.objects;
CREATE POLICY "challenge_proofs_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'challenge-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

NOTIFY pgrst, 'reload schema';
