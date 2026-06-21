-- ── gym_plans ────────────────────────────────────────────────────────────────
create table if not exists public.gym_plans (
  id             uuid          primary key default gen_random_uuid(),
  name           varchar(100)  not null,
  price          numeric(10,2) not null check (price >= 0),
  billing_cycle  varchar(20)   not null check (billing_cycle in ('monthly', 'quarterly', 'yearly')),
  active         boolean       not null default true,
  created_at     timestamptz   not null default now()
);

-- ── gym_subscriptions ─────────────────────────────────────────────────────────
create table if not exists public.gym_subscriptions (
  id                  uuid         primary key default gen_random_uuid(),
  student_id          uuid         not null references public.users(id) on delete cascade,
  plan_id             uuid         not null references public.gym_plans(id) on delete restrict,
  status              varchar(20)  not null check (status in ('active', 'canceled', 'past_due')) default 'active',
  start_date          date         not null default current_date,
  next_billing_date   date         not null,
  created_at          timestamptz  not null default now()
);

-- ── gym_invoices ──────────────────────────────────────────────────────────────
create table if not exists public.gym_invoices (
  id               uuid          primary key default gen_random_uuid(),
  subscription_id  uuid          not null references public.gym_subscriptions(id) on delete cascade,
  student_id       uuid          not null references public.users(id) on delete cascade,
  amount           numeric(10,2) not null check (amount >= 0),
  due_date         date          not null,
  paid_date        date,
  status           varchar(20)   not null check (status in ('paid', 'pending', 'overdue')) default 'pending',
  created_at       timestamptz   not null default now()
);

-- ── indexes ───────────────────────────────────────────────────────────────────
create index if not exists gym_subscriptions_student_idx   on public.gym_subscriptions(student_id);
create index if not exists gym_subscriptions_status_idx    on public.gym_subscriptions(status);
create index if not exists gym_invoices_student_idx        on public.gym_invoices(student_id);
create index if not exists gym_invoices_status_idx         on public.gym_invoices(status);
create index if not exists gym_invoices_due_date_idx       on public.gym_invoices(due_date);

-- ── RLS: gym_plans ────────────────────────────────────────────────────────────
alter table public.gym_plans enable row level security;

create policy "gym_plans_admin_all"
  on public.gym_plans for all
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );

-- ── RLS: gym_subscriptions ────────────────────────────────────────────────────
alter table public.gym_subscriptions enable row level security;

create policy "gym_subscriptions_admin_all"
  on public.gym_subscriptions for all
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );

-- ── RLS: gym_invoices ─────────────────────────────────────────────────────────
alter table public.gym_invoices enable row level security;

create policy "gym_invoices_admin_all"
  on public.gym_invoices for all
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );
