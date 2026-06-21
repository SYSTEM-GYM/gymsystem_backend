-- ── workout_logs: one row per completed workout session ─────────────────────
create table if not exists public.workout_logs (
  id              uuid        primary key default gen_random_uuid(),
  student_id      uuid        not null references public.users(id) on delete cascade,
  collection_id   uuid        not null references public.exercise_collections(id) on delete cascade,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  created_at      timestamptz not null default now()
);

-- ── set_logs: one row per set within a session ───────────────────────────────
create table if not exists public.set_logs (
  id              uuid        primary key default gen_random_uuid(),
  workout_log_id  uuid        not null references public.workout_logs(id) on delete cascade,
  exercise_id     uuid        not null references public.exercises(id) on delete cascade,
  set_number      int         not null,
  weight_kg       numeric(6,2),
  reps_completed  int,
  created_at      timestamptz not null default now()
);

-- ── indexes ──────────────────────────────────────────────────────────────────
create index if not exists workout_logs_student_id_idx on public.workout_logs(student_id);
create index if not exists set_logs_workout_log_id_idx  on public.set_logs(workout_log_id);
create index if not exists set_logs_exercise_id_idx     on public.set_logs(exercise_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.workout_logs enable row level security;
alter table public.set_logs     enable row level security;

-- Students can only read/write their own sessions
create policy "students_own_workout_logs"
  on public.workout_logs
  for all
  using  (auth.uid() = student_id)
  with check (auth.uid() = student_id);

-- Admin service role bypasses RLS — no extra policy needed.
-- Students can manage set_logs that belong to their workout_logs
create policy "students_own_set_logs"
  on public.set_logs
  for all
  using (
    exists (
      select 1 from public.workout_logs wl
      where wl.id = set_logs.workout_log_id
        and wl.student_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workout_logs wl
      where wl.id = set_logs.workout_log_id
        and wl.student_id = auth.uid()
    )
  );
