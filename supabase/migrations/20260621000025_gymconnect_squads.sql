-- ── gymconnect_squads ────────────────────────────────────────────────────────
create table if not exists public.gymconnect_squads (
  id          uuid        primary key default gen_random_uuid(),
  name        varchar(80) not null,
  description text,
  invite_code varchar(8)  not null unique default upper(substr(md5(random()::text), 1, 6)),
  created_by  uuid        not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ── gymconnect_squad_members ──────────────────────────────────────────────────
create table if not exists public.gymconnect_squad_members (
  squad_id    uuid        not null references public.gymconnect_squads(id) on delete cascade,
  student_id  uuid        not null references public.users(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (squad_id, student_id)
);

-- ── indexes ──────────────────────────────────────────────────────────────────
create index if not exists gymconnect_squad_members_student_idx on public.gymconnect_squad_members(student_id);
create index if not exists gymconnect_squad_members_squad_idx   on public.gymconnect_squad_members(squad_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.gymconnect_squads         enable row level security;
alter table public.gymconnect_squad_members  enable row level security;

-- Any authenticated student can read squads (needed to look up by invite_code)
create policy "squads_read_all"
  on public.gymconnect_squads for select
  using (auth.uid() is not null);

-- Any authenticated student can create a squad
create policy "squads_insert"
  on public.gymconnect_squads for insert
  with check (auth.uid() = created_by);

-- Only the creator can update or delete their squad
create policy "squads_owner_mutate"
  on public.gymconnect_squads for update
  using (auth.uid() = created_by);

create policy "squads_owner_delete"
  on public.gymconnect_squads for delete
  using (auth.uid() = created_by);

-- Members: anyone authenticated can read membership rows
create policy "squad_members_read"
  on public.gymconnect_squad_members for select
  using (auth.uid() is not null);

-- Students can join (insert their own row)
create policy "squad_members_join"
  on public.gymconnect_squad_members for insert
  with check (auth.uid() = student_id);

-- Students can leave (delete their own row)
create policy "squad_members_leave"
  on public.gymconnect_squad_members for delete
  using (auth.uid() = student_id);
