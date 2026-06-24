-- ── Squad Streak Rescues ─────────────────────────────────────────────────────
-- Allows squad members to collectively vote to protect a teammate's streak
-- when they missed a workout day.

CREATE TABLE IF NOT EXISTS public.squad_streak_rescues (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_id        uuid        NOT NULL REFERENCES public.gymconnect_squads(id)  ON DELETE CASCADE,
  student_id      uuid        NOT NULL REFERENCES public.users(id)              ON DELETE CASCADE,
  missed_date     DATE        NOT NULL,
  votes_collected INT         NOT NULL DEFAULT 0,
  status          VARCHAR(10) NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (squad_id, student_id, missed_date)
);

-- Tracks individual votes to prevent double-voting
CREATE TABLE IF NOT EXISTS public.squad_rescue_votes (
  rescue_id  uuid NOT NULL REFERENCES public.squad_streak_rescues(id) ON DELETE CASCADE,
  voter_id   uuid NOT NULL REFERENCES public.users(id)                ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rescue_id, voter_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS squad_streak_rescues_squad_idx   ON public.squad_streak_rescues(squad_id);
CREATE INDEX IF NOT EXISTS squad_streak_rescues_student_idx ON public.squad_streak_rescues(student_id);
CREATE INDEX IF NOT EXISTS squad_streak_rescues_status_idx  ON public.squad_streak_rescues(status, missed_date);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.squad_streak_rescues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.squad_rescue_votes   ENABLE ROW LEVEL SECURITY;

-- Squad members can read rescues for their squads
CREATE POLICY "rescues_read"
  ON public.squad_streak_rescues FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.gymconnect_squad_members m
      WHERE m.squad_id = squad_streak_rescues.squad_id
        AND m.student_id = auth.uid()
    )
  );

-- The at-risk student (or any squadmate) can request a rescue
CREATE POLICY "rescues_insert"
  ON public.squad_streak_rescues FOR INSERT
  WITH CHECK (
    auth.uid() = student_id
    AND EXISTS (
      SELECT 1 FROM public.gymconnect_squad_members m
      WHERE m.squad_id = squad_streak_rescues.squad_id
        AND m.student_id = auth.uid()
    )
  );

-- Squad members can read all votes
CREATE POLICY "rescue_votes_read"
  ON public.squad_rescue_votes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.squad_streak_rescues r
      JOIN public.gymconnect_squad_members m ON m.squad_id = r.squad_id
      WHERE r.id = squad_rescue_votes.rescue_id
        AND m.student_id = auth.uid()
    )
  );

-- Any squad member can cast one vote per rescue (PK enforces uniqueness)
CREATE POLICY "rescue_votes_insert"
  ON public.squad_rescue_votes FOR INSERT
  WITH CHECK (
    auth.uid() = voter_id
    AND EXISTS (
      SELECT 1 FROM public.squad_streak_rescues r
      JOIN public.gymconnect_squad_members m ON m.squad_id = r.squad_id
      WHERE r.id = squad_rescue_votes.rescue_id
        AND m.student_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
