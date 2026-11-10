-- Row Level Security for every table (Task 9) - SPEC §5, PDPA.
--
-- Role model:
--   host     : everything, all tables, all actions.
--   admin    : READ all branches. WRITE customers/contracts/contract_teams/stations
--              only when the row's branch division is in current_division_scope().
--   recorder : READ all branches. WRITE visits/station_checks only when the row's
--              branch division is in current_division_scope().
--   viewer   : = anon (not logged in). Can SELECT only monthly_branch_snapshots and
--              v_branch_summary. NO policy exists for anon on PII tables => 0 rows.
--   reference tables (zones, branches, teams, customer_types, tier_rules):
--              SELECT for authenticated, write host only.
--
-- Notes:
--   * Branch of a row is reached by join:
--       customers.branch_id | contracts->customers | stations->contracts->customers
--       visits->contracts->customers | station_checks->visits->...
--     The scope helpers below are SECURITY DEFINER so the lookup does not depend on
--     (and cannot recurse into) the caller's own RLS.
--   * Policies that call helper functions are TO authenticated only (helpers are not
--     executable by anon).
--   * profiles uses ENABLE (not FORCE) RLS: the SECURITY DEFINER helpers read profiles
--     as the table owner and must keep the owner bypass.
--   * Tables keep Supabase's default grants; with RLS on and no matching policy, anon
--     simply gets 0 rows.

-- =====================================================================
-- 1. Scope helpers (SECURITY DEFINER, pinned search_path)
-- =====================================================================
CREATE FUNCTION public.branch_in_scope(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT b.division = ANY (public.current_division_scope())
       FROM public.branches b WHERE b.id = p_branch_id),
    false
  );
$$;

CREATE FUNCTION public.contract_in_scope(p_contract_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT public.branch_in_scope(cu.branch_id)
       FROM public.contracts c
       JOIN public.customers cu ON cu.id = c.customer_id
      WHERE c.id = p_contract_id),
    false
  );
$$;

CREATE FUNCTION public.station_in_scope(p_station_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT public.contract_in_scope(s.contract_id)
       FROM public.stations s WHERE s.id = p_station_id),
    false
  );
$$;

CREATE FUNCTION public.visit_in_scope(p_visit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT public.contract_in_scope(v.contract_id)
       FROM public.visits v WHERE v.id = p_visit_id),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.branch_in_scope(uuid)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contract_in_scope(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.station_in_scope(uuid)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.visit_in_scope(uuid)    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.branch_in_scope(uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contract_in_scope(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.station_in_scope(uuid)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.visit_in_scope(uuid)    TO authenticated, service_role;

-- =====================================================================
-- 2. follow_up_no trigger must see the FULL station history
--    (a division-scoped role may not be able to see every check of a station).
--    Body identical to Task 6; only SECURITY DEFINER added.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_follow_up_no() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  this_date date;
BEGIN
  SELECT visit_date INTO this_date FROM public.visits WHERE id = NEW.visit_id;
  NEW.follow_up_no := 1 + (
    SELECT count(*)
    FROM public.station_checks sc
    JOIN public.visits v ON v.id = sc.visit_id
    WHERE sc.station_id = NEW.station_id
      AND v.visit_date < this_date
  );
  RETURN NEW;
END;
$$;

-- =====================================================================
-- 3. Enable RLS on EVERY table (no FORCE; see header note on profiles)
-- =====================================================================
ALTER TABLE public.zones                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_types           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tier_rules               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_teams           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stations                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visits                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.station_checks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.month_closures           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_branch_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log                ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 4. Reference tables: read = authenticated, write = host
-- =====================================================================
CREATE POLICY zones_select ON public.zones FOR SELECT TO authenticated USING (true);
CREATE POLICY zones_host_write ON public.zones FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());

CREATE POLICY branches_select ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY branches_host_write ON public.branches FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());

CREATE POLICY teams_select ON public.teams FOR SELECT TO authenticated USING (true);
CREATE POLICY teams_host_write ON public.teams FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());

CREATE POLICY customer_types_select ON public.customer_types FOR SELECT TO authenticated USING (true);
CREATE POLICY customer_types_host_write ON public.customer_types FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());

CREATE POLICY tier_rules_select ON public.tier_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY tier_rules_host_write ON public.tier_rules FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());

-- =====================================================================
-- 5. profiles: own row readable; ONLY host writes (no self-escalation,
--    no self-update at all - role/division_scope cannot be changed by non-host)
-- =====================================================================
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY profiles_host_all ON public.profiles FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());

-- =====================================================================
-- 6. PII tables
--    READ : host / admin / recorder (all branches). anon: no policy => 0 rows.
--    WRITE: host always; admin on customers/contracts/contract_teams/stations and
--           recorder on visits/station_checks only when the branch is in scope.
-- =====================================================================

-- ---- customers ----
CREATE POLICY customers_select ON public.customers FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));
CREATE POLICY customers_host_write ON public.customers FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());
CREATE POLICY customers_admin_insert ON public.customers FOR INSERT TO authenticated
  WITH CHECK (public.current_app_role() = 'admin' AND public.branch_in_scope(branch_id));
CREATE POLICY customers_admin_update ON public.customers FOR UPDATE TO authenticated
  USING (public.current_app_role() = 'admin' AND public.branch_in_scope(branch_id))
  WITH CHECK (public.current_app_role() = 'admin' AND public.branch_in_scope(branch_id));

-- ---- contracts ----
CREATE POLICY contracts_select ON public.contracts FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));
CREATE POLICY contracts_host_write ON public.contracts FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());
CREATE POLICY contracts_admin_insert ON public.contracts FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'admin'
    AND public.branch_in_scope((SELECT cu.branch_id FROM public.customers cu WHERE cu.id = customer_id))
  );
CREATE POLICY contracts_admin_update ON public.contracts FOR UPDATE TO authenticated
  USING (public.current_app_role() = 'admin' AND public.contract_in_scope(id))
  WITH CHECK (
    public.current_app_role() = 'admin'
    AND public.branch_in_scope((SELECT cu.branch_id FROM public.customers cu WHERE cu.id = customer_id))
  );

-- ---- contract_teams (admin may also remove a team link) ----
CREATE POLICY contract_teams_select ON public.contract_teams FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));
CREATE POLICY contract_teams_host_write ON public.contract_teams FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());
CREATE POLICY contract_teams_admin_insert ON public.contract_teams FOR INSERT TO authenticated
  WITH CHECK (public.current_app_role() = 'admin' AND public.contract_in_scope(contract_id));
CREATE POLICY contract_teams_admin_update ON public.contract_teams FOR UPDATE TO authenticated
  USING (public.current_app_role() = 'admin' AND public.contract_in_scope(contract_id))
  WITH CHECK (public.current_app_role() = 'admin' AND public.contract_in_scope(contract_id));
CREATE POLICY contract_teams_admin_delete ON public.contract_teams FOR DELETE TO authenticated
  USING (public.current_app_role() = 'admin' AND public.contract_in_scope(contract_id));

-- ---- stations ----
CREATE POLICY stations_select ON public.stations FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));
CREATE POLICY stations_host_write ON public.stations FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());
CREATE POLICY stations_admin_insert ON public.stations FOR INSERT TO authenticated
  WITH CHECK (public.current_app_role() = 'admin' AND public.contract_in_scope(contract_id));
CREATE POLICY stations_admin_update ON public.stations FOR UPDATE TO authenticated
  USING (public.current_app_role() = 'admin' AND public.contract_in_scope(contract_id))
  WITH CHECK (public.current_app_role() = 'admin' AND public.contract_in_scope(contract_id));

-- ---- visits (recorder: insert / update / delete within scope; all audited) ----
CREATE POLICY visits_select ON public.visits FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));
CREATE POLICY visits_host_write ON public.visits FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());
CREATE POLICY visits_recorder_insert ON public.visits FOR INSERT TO authenticated
  WITH CHECK (public.current_app_role() = 'recorder' AND public.contract_in_scope(contract_id));
CREATE POLICY visits_recorder_update ON public.visits FOR UPDATE TO authenticated
  USING (public.current_app_role() = 'recorder' AND public.contract_in_scope(contract_id))
  WITH CHECK (public.current_app_role() = 'recorder' AND public.contract_in_scope(contract_id));
CREATE POLICY visits_recorder_delete ON public.visits FOR DELETE TO authenticated
  USING (public.current_app_role() = 'recorder' AND public.contract_in_scope(contract_id));

-- ---- station_checks (visit AND station must both be in scope) ----
CREATE POLICY station_checks_select ON public.station_checks FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));
CREATE POLICY station_checks_host_write ON public.station_checks FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());
CREATE POLICY station_checks_recorder_insert ON public.station_checks FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'recorder'
    AND public.visit_in_scope(visit_id) AND public.station_in_scope(station_id)
  );
CREATE POLICY station_checks_recorder_update ON public.station_checks FOR UPDATE TO authenticated
  USING (public.current_app_role() = 'recorder' AND public.visit_in_scope(visit_id))
  WITH CHECK (
    public.current_app_role() = 'recorder'
    AND public.visit_in_scope(visit_id) AND public.station_in_scope(station_id)
  );
CREATE POLICY station_checks_recorder_delete ON public.station_checks FOR DELETE TO authenticated
  USING (public.current_app_role() = 'recorder' AND public.visit_in_scope(visit_id));

-- =====================================================================
-- 7. Ops tables
-- =====================================================================
-- month_closures: staff read, host write
CREATE POLICY month_closures_select ON public.month_closures FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));
CREATE POLICY month_closures_host_write ON public.month_closures FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());

-- monthly_branch_snapshots: PUBLIC dashboard data (no PII). anon + authenticated read.
CREATE POLICY snapshots_select_public ON public.monthly_branch_snapshots
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY snapshots_host_write ON public.monthly_branch_snapshots FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());

-- audit_log: host read only. Rows are written by the SECURITY DEFINER audit_trigger
-- (owner bypasses RLS), so no INSERT policy is needed.
CREATE POLICY audit_log_host_select ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_host());
