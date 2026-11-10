-- profiles + role/division helper functions
-- Used later by RLS policies (SPEC §5). RLS itself is enabled in a later migration.
--
-- Logic summary:
--   * profiles is 1:1 with auth.users (cascade delete).
--   * division_scope is an array so one user can be scoped to several divisions
--     (phase 1 seeds '{central}').
--   * The helper functions are SECURITY DEFINER so policies on other tables (and on
--     profiles itself) can call them without recursing into profiles' own RLS.
--     They read only the row of auth.uid(), and pin search_path = public.
--   * No profile row (or no signed-in user) => current_app_role() and
--     current_division_scope() return NULL, is_host() returns false.
--   * Named current_app_role (not current_role): current_role is a reserved
--     built-in in PostgreSQL.

CREATE TABLE profiles (
  user_id        uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name   text,
  role           user_role NOT NULL,
  division_scope division[] NOT NULL DEFAULT '{}',
  team_id        uuid REFERENCES teams (id)
);
CREATE INDEX profiles_team_id_idx ON profiles (team_id);

CREATE FUNCTION public.current_app_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.role FROM public.profiles p WHERE p.user_id = auth.uid();
$$;

CREATE FUNCTION public.current_division_scope()
RETURNS division[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.division_scope FROM public.profiles p WHERE p.user_id = auth.uid();
$$;

CREATE FUNCTION public.is_host()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT p.role = 'host' FROM public.profiles p WHERE p.user_id = auth.uid()),
    false
  );
$$;

-- Do not expose to anonymous callers; signed-in users and server roles only.
REVOKE ALL ON FUNCTION public.current_app_role()      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_division_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_host()               FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_role()      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_division_scope() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_host()               TO authenticated, service_role;
