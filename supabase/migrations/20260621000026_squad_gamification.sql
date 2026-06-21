-- ── squad_challenges ──────────────────────────────────────────────────────────
create table if not exists public.squad_challenges (
  id                  uuid         primary key default gen_random_uuid(),
  squad_id            uuid         not null references public.gymconnect_squads(id) on delete cascade,
  title               varchar(100) not null,
  description         text,
  challenge_type      varchar(20)  not null check (challenge_type in ('frequency', 'volume', 'max_weight')),
  target_value        numeric(10,2) not null,
  target_exercise_id  uuid         references public.exercises(id) on delete set null,
  end_date            timestamptz  not null,
  created_by          uuid         not null references public.users(id) on delete cascade,
  created_at          timestamptz  not null default now()
);

-- ── squad_shared_workouts ─────────────────────────────────────────────────────
create table if not exists public.squad_shared_workouts (
  id             uuid        primary key default gen_random_uuid(),
  squad_id       uuid        not null references public.gymconnect_squads(id) on delete cascade,
  collection_id  uuid        not null references public.exercise_collections(id) on delete cascade,
  shared_by      uuid        not null references public.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (squad_id, collection_id)
);

-- ── indexes ──────────────────────────────────────────────────────────────────
create index if not exists squad_challenges_squad_idx         on public.squad_challenges(squad_id);
create index if not exists squad_challenges_end_date_idx      on public.squad_challenges(end_date);
create index if not exists squad_shared_workouts_squad_idx    on public.squad_shared_workouts(squad_id);

-- ── RLS: squad_challenges ────────────────────────────────────────────────────
alter table public.squad_challenges enable row level security;

-- Squad members can read challenges for their squads
create policy "squad_challenges_read"
  on public.squad_challenges for select
  using (
    exists (
      select 1 from public.gymconnect_squad_members m
      where m.squad_id = squad_challenges.squad_id
        and m.student_id = auth.uid()
    )
  );

-- Only the squad creator can insert challenges
create policy "squad_challenges_insert"
  on public.squad_challenges for insert
  with check (
    auth.uid() = created_by
    and exists (
      select 1 from public.gymconnect_squads s
      where s.id = squad_challenges.squad_id
        and s.created_by = auth.uid()
    )
  );

-- ── RLS: squad_shared_workouts ────────────────────────────────────────────────
alter table public.squad_shared_workouts enable row level security;

-- Squad members can read shared workouts for their squads
create policy "squad_shared_workouts_read"
  on public.squad_shared_workouts for select
  using (
    exists (
      select 1 from public.gymconnect_squad_members m
      where m.squad_id = squad_shared_workouts.squad_id
        and m.student_id = auth.uid()
    )
  );

-- Any squad member can share a workout
create policy "squad_shared_workouts_insert"
  on public.squad_shared_workouts for insert
  with check (
    auth.uid() = shared_by
    and exists (
      select 1 from public.gymconnect_squad_members m
      where m.squad_id = squad_shared_workouts.squad_id
        and m.student_id = auth.uid()
    )
  );

-- Sharer or squad creator can remove a shared workout
create policy "squad_shared_workouts_delete"
  on public.squad_shared_workouts for delete
  using (
    auth.uid() = shared_by
    or exists (
      select 1 from public.gymconnect_squads s
      where s.id = squad_shared_workouts.squad_id
        and s.created_by = auth.uid()
    )
  );
