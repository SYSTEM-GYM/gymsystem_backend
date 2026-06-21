-- Coupon codes for discounts on plans and daily passes
create table if not exists public.gym_coupons (
  id                   uuid          primary key default gen_random_uuid(),
  code                 varchar(50)   not null unique,
  discount_percentage  int           not null check (discount_percentage >= 1 and discount_percentage <= 100),
  max_uses             int           null,       -- null = unlimited
  current_uses         int           not null default 0,
  expires_at           timestamptz   null,       -- null = never expires
  active               boolean       not null default true,
  created_at           timestamptz   not null default now()
);

create index if not exists gym_coupons_code_idx on public.gym_coupons (lower(code));

-- RLS: admins manage; students may only read active, non-expired coupons to validate
alter table public.gym_coupons enable row level security;

create policy "admins_all_coupons" on public.gym_coupons
  for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "students_read_active_coupons" on public.gym_coupons
  for select
  using (
    active = true
    and (expires_at is null or expires_at > now())
    and (max_uses is null or current_uses < max_uses)
  );

-- Atomic increment to prevent race conditions on heavily-used coupons
create or replace function public.increment_coupon_uses(coupon_id uuid)
returns void
language sql
security definer
as $$
  update public.gym_coupons
  set current_uses = current_uses + 1
  where id = coupon_id;
$$;
