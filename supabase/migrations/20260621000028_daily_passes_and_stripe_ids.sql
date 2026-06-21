-- ── daily_passes ─────────────────────────────────────────────────────────────
create table if not exists public.daily_passes (
  id               uuid         primary key default gen_random_uuid(),
  student_id       uuid         not null references public.users(id) on delete cascade,
  purchased_at     timestamptz  not null default now(),
  valid_for_date   date         not null,
  used_at          timestamptz,
  status           varchar(20)  not null default 'available'
                   check (status in ('available', 'used', 'expired')),
  created_at       timestamptz  not null default now()
);

-- Prevent a student from having two available passes for the same date
create unique index if not exists daily_passes_student_date_unique
  on public.daily_passes (student_id, valid_for_date)
  where (status = 'available');

create index if not exists daily_passes_student_idx    on public.daily_passes(student_id);
create index if not exists daily_passes_date_idx       on public.daily_passes(valid_for_date);

-- ── Stripe ID columns ─────────────────────────────────────────────────────────
-- Stored on the student row so we can look up subscriptions from webhook events
alter table public.users
  add column if not exists stripe_customer_id varchar(255);

create unique index if not exists users_stripe_customer_idx
  on public.users (stripe_customer_id)
  where (stripe_customer_id is not null);

-- Stored on subscriptions so Stripe sub events can hit the right row
alter table public.gym_subscriptions
  add column if not exists stripe_subscription_id varchar(255);

create unique index if not exists gym_subscriptions_stripe_idx
  on public.gym_subscriptions (stripe_subscription_id)
  where (stripe_subscription_id is not null);

-- Stored on invoices so invoice events can mark the correct row paid
alter table public.gym_invoices
  add column if not exists stripe_invoice_id varchar(255);

create unique index if not exists gym_invoices_stripe_idx
  on public.gym_invoices (stripe_invoice_id)
  where (stripe_invoice_id is not null);

-- ── RLS: daily_passes ─────────────────────────────────────────────────────────
alter table public.daily_passes enable row level security;

-- Students can view their own passes
create policy "daily_passes_student_read"
  on public.daily_passes for select
  using (auth.uid() = student_id);

-- Only admins can insert / update / delete passes
create policy "daily_passes_admin_all"
  on public.daily_passes for all
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
