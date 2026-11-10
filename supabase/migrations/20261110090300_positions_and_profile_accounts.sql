-- positions + profiles account fields (SPEC §6 profiles, §17 6 พ.ย. 2026,
-- docs/แผนงานแก้ไข.md A2 + D3)
--
-- Logic summary:
--   * positions = job titles users see on screen (code, Thai name, permission level).
--     The database keeps the same 4 permission levels (user_role) so RLS is
--     unchanged; a new title is just a new row. PM and OM are both full host (D3).
--   * profiles.position_code -> positions.code. When set, profiles.role is
--     DERIVED from the position (BEFORE trigger) so title and permission level can
--     never disagree. Changing a position's level updates all its holders.
--     position_code NULL -> role is taken as given (service / legacy rows).
--   * Account fields (screen 11):
--       username             unique, a-z 0-9 . _ -, 3–20 chars (login name)
--       is_active            false = account closed (soft disable, never deleted,
--                            audit_log keeps pointing to the user)
--       must_change_password true on create / reset; the server sets it false after
--                            the user changes the password
--       last_login           written by the server at sign-in
--   * Guards (BEFORE trigger, SECURITY DEFINER so counts see every row):
--       - the last ACTIVE host cannot be disabled, demoted (directly or through a
--         position) or deleted — serialized with an advisory lock so two hosts
--         cannot demote each other at the same time
--       - a signed-in user cannot disable their own account
--   * The permission helpers now ignore disabled accounts: a closed account whose
--     JWT has not expired yet gets role NULL / is_host false => RLS denies.
--   * Only host writes profiles/positions (profiles policies from 20261104100318;
--     positions policies below). Signed-in users read positions; anon reads nothing.

-- ---------------------------------------------------------------------
-- 1. positions
-- ---------------------------------------------------------------------
CREATE TABLE public.positions (
  code       text PRIMARY KEY CONSTRAINT positions_code_format CHECK (code ~ '^[a-z0-9_]{2,30}$'),
  name_th    text NOT NULL,
  role       public.user_role NOT NULL CONSTRAINT positions_role_not_viewer CHECK (role <> 'viewer'),
  sort_order int  NOT NULL DEFAULT 0
);

INSERT INTO public.positions (code, name_th, role, sort_order) VALUES
  ('job_admin',  'Admin (เปิดงาน)',  'admin',    1),
  ('supervisor', 'หัวหน้างาน',       'recorder', 2),
  ('pm',         'Project Manager', 'host',     3),
  ('om',         'OM',              'host',     4);

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY positions_select ON public.positions FOR SELECT TO authenticated USING (true);
CREATE POLICY positions_host_write ON public.positions FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());

-- ---------------------------------------------------------------------
-- 2. profiles account fields
--    (username is NOT NULL: no profile rows exist before this migration — accounts
--     are created by host through the server after deploy)
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN username text NOT NULL
    CONSTRAINT profiles_username_format CHECK (username ~ '^[a-z0-9._-]{3,20}$'),
  ADD COLUMN is_active            boolean NOT NULL DEFAULT true,
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT true,
  ADD COLUMN last_login           timestamptz,
  ADD COLUMN position_code        text REFERENCES public.positions (code) ON UPDATE CASCADE;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_key UNIQUE (username);
CREATE INDEX profiles_position_code_idx ON public.profiles (position_code);

-- ---------------------------------------------------------------------
-- 3. guard trigger: role from position + last-host + no self-disable
-- ---------------------------------------------------------------------
CREATE FUNCTION public.profiles_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_position_role public.user_role;
  v_other_hosts   int;
BEGIN
  -- role follows the position
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.position_code IS NOT NULL THEN
    SELECT p.role INTO v_position_role FROM public.positions p WHERE p.code = NEW.position_code;
    IF v_position_role IS NOT NULL THEN
      NEW.role := v_position_role;
    END IF;
  END IF;

  -- nobody disables their own account
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL AND NEW.user_id = auth.uid()
     AND OLD.is_active AND NOT NEW.is_active THEN
    RAISE EXCEPTION 'cannot disable your own account' USING ERRCODE = 'P0001';
  END IF;

  -- an active host is leaving the "active host" set -> must not be the last one
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.role = 'host' AND OLD.is_active
     AND (TG_OP = 'DELETE' OR NEW.role <> 'host' OR NOT NEW.is_active) THEN
    PERFORM pg_advisory_xact_lock(hashtext('public.profiles:last_active_host'));
    SELECT count(*) INTO v_other_hosts
      FROM public.profiles p
     WHERE p.role = 'host' AND p.is_active AND p.user_id <> OLD.user_id;
    IF v_other_hosts = 0 THEN
      RAISE EXCEPTION 'cannot disable, demote or delete the last active host'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.profiles_guard() FROM PUBLIC;

CREATE TRIGGER profiles_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard();

-- a position's level change is pushed to its holders (guard re-derives + checks)
CREATE FUNCTION public.positions_sync_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET role = NEW.role WHERE position_code = NEW.code;
  RETURN NULL; -- AFTER trigger
END;
$$;

REVOKE ALL ON FUNCTION public.positions_sync_role() FROM PUBLIC;

CREATE TRIGGER positions_sync_role
  AFTER UPDATE OF role ON public.positions
  FOR EACH ROW WHEN (OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION public.positions_sync_role();

-- ---------------------------------------------------------------------
-- 4. permission helpers ignore disabled accounts (grants are kept by REPLACE)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.role FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_active;
$$;

CREATE OR REPLACE FUNCTION public.current_division_scope()
RETURNS division[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.division_scope FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_active;
$$;

CREATE OR REPLACE FUNCTION public.is_host()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT p.role = 'host' FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_active),
    false
  );
$$;
