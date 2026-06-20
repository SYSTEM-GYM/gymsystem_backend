-- Multi-tenant: users belong to a home gym; global_access allows cross-branch check-in
ALTER TABLE public.users
  ADD COLUMN home_gym_id  UUID    REFERENCES public.gyms(id) ON DELETE SET NULL,
  ADD COLUMN global_access BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_users_home_gym_id ON public.users(home_gym_id);
