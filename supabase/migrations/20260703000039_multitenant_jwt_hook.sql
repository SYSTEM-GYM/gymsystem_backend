-- Phase 1 of the Master → Gym Admin → Staff/Student multi-tenant migration.
-- Purely additive: no existing role value, policy, or row is altered/removed.
-- Introduces the expanded role vocabulary and a Custom Access Token Hook that
-- injects { role, gym_id } into app_metadata so RLS (and later, app code) can
-- read tenant context straight from the JWT instead of hitting public.users
-- on every request.

-- ── 1. RBAC expansion (additive) ─────────────────────────────────────────────
-- 'admin' is kept so every existing row and every existing RLS policy
-- (`current_user_role() = 'admin'`) keeps working untouched. The new values
-- are added so future rows/migrations can use the 3-level hierarchy:
--   master        → platform owner, no direct gym data access
--   gym_admin     → tenant owner (successor name for 'admin'; both accepted for now)
--   trainer       → existing value, unchanged
--   receptionist  → new granular staff role
--   customer      → existing value, unchanged
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'master', 'gym_admin', 'trainer', 'receptionist', 'customer'));

-- ── 2. Tenant ID normalization check ─────────────────────────────────────────
-- public.gyms already has owner_id (tenant ownership reference) from
-- 20260620000010_create_gyms_table.sql, and public.users already has
-- home_gym_id from 20260620000011_add_gym_to_users.sql. Nothing to add here —
-- this section is a no-op left in place to document that the check was made.

-- ── 3. JWT Custom Access Token Hook ──────────────────────────────────────────
-- Called by Supabase Auth on every token issuance/refresh. Must be readable
-- and callable only by supabase_auth_admin per Supabase's security model.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims           jsonb;
  existing_app_meta jsonb;
  new_app_meta     jsonb;
  user_role        text;
  user_gym_id      uuid;
BEGIN
  SELECT role, home_gym_id
    INTO user_role, user_gym_id
    FROM public.users
    WHERE id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';
  existing_app_meta := COALESCE(claims -> 'app_metadata', '{}'::jsonb);

  new_app_meta := existing_app_meta
    || jsonb_build_object(
         'role',   user_role,
         'gym_id', user_gym_id
       );

  claims := jsonb_set(claims, '{app_metadata}', new_app_meta);
  event := jsonb_set(event, '{claims}', claims);

  RETURN event;
END;
$$;

-- Supabase Auth invokes the hook as supabase_auth_admin — grant exactly what
-- it needs and nothing more. Client roles must never be able to call this
-- directly (it would let a user forge another user's claims payload shape).
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;

-- The hook runs as supabase_auth_admin, which has no policy on public.users
-- yet (existing policies only allow auth.uid() = id). Add a narrow read-only
-- policy scoped to that role alone.
GRANT SELECT ON public.users TO supabase_auth_admin;

DROP POLICY IF EXISTS "users_select_auth_admin" ON public.users;
CREATE POLICY "users_select_auth_admin" ON public.users
  AS PERMISSIVE FOR SELECT
  TO supabase_auth_admin
  USING (true);

NOTIFY pgrst, 'reload schema';
