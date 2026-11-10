-- audit_log context columns + more audited tables (แผนงาน C3, SPEC §6.5, §7.7, §14 ข้อ 11)
--
-- Logic summary:
--   * audit_log gains branch_id, contract_id, month_key so the history screens and
--     the "edited after close N" chip (§7.7, screen 8) can search without unpacking
--     old_data/new_data. No FK on purpose: audit rows must outlive the data rows.
--   * month_key is always ISO 'YYYY-MM' (same as month_closures). Snapshot rows may
--     carry the Dashboard key 'MMM.YY' -> normalize_month_key() converts it.
--   * How the trigger fills the context (from the row's jsonb):
--       customers                     branch_id
--       contracts                     contract_id = id, branch via customer_id
--       contract_teams / stations     contract_id, branch via contract
--       visits                        contract_id, branch, month of visit_date
--       station_checks                contract + month of the parent visit
--       monthly_branch_snapshots      branch_id, month_key   (source='manual' only)
--       month_closures                month_key              (who closed / re-synced)
--     A visit moved to another month is logged under the NEW month (old month is
--     still in old_data). Rows removed by an ON DELETE CASCADE whose parent is
--     already gone may get NULL context.
--   * Snapshots: only source='manual' rows are audited (§6.5 host edits). Computed
--     rows are rewritten by close / re-sync and would only add noise.

ALTER TABLE public.audit_log
  ADD COLUMN branch_id   uuid,
  ADD COLUMN contract_id uuid,
  ADD COLUMN month_key   text;

CREATE INDEX audit_log_branch_changed_idx   ON public.audit_log (branch_id, changed_at);
CREATE INDEX audit_log_contract_changed_idx ON public.audit_log (contract_id, changed_at);
CREATE INDEX audit_log_month_changed_idx    ON public.audit_log (month_key, changed_at);

-- 'SEP.26' / 'sep.26' -> '2026-09' · 'YYYY-MM' unchanged · anything else as is
CREATE FUNCTION public.normalize_month_key(p_key text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_key ~ '^\d{4}-(0[1-9]|1[0-2])$' THEN p_key
    WHEN upper(p_key) ~ '^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\.\d{2}$'
      THEN to_char(to_date(upper(p_key), 'MON.YY'), 'YYYY-MM')
    ELSE p_key
  END;
$$;

CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old        jsonb;
  v_new        jsonb;
  v_rec        jsonb;
  v_row_id     uuid;
  v_branch     uuid;
  v_contract   uuid;
  v_month      text;
  v_visit_date date;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;
  v_rec := COALESCE(v_new, v_old);

  -- tables without an "id" column (contract_teams, snapshots, closures) yield NULL
  v_row_id := NULLIF(v_rec ->> 'id', '')::uuid;

  CASE TG_TABLE_NAME
    WHEN 'customers' THEN
      v_branch := (v_rec ->> 'branch_id')::uuid;
    WHEN 'contracts' THEN
      v_contract := v_row_id;
      SELECT cu.branch_id INTO v_branch
        FROM public.customers cu WHERE cu.id = (v_rec ->> 'customer_id')::uuid;
    WHEN 'contract_teams', 'stations' THEN
      v_contract := (v_rec ->> 'contract_id')::uuid;
    WHEN 'visits' THEN
      v_contract := (v_rec ->> 'contract_id')::uuid;
      v_month    := to_char((v_rec ->> 'visit_date')::date, 'YYYY-MM');
    WHEN 'station_checks' THEN
      SELECT v.contract_id, v.visit_date INTO v_contract, v_visit_date
        FROM public.visits v WHERE v.id = (v_rec ->> 'visit_id')::uuid;
      v_month := to_char(v_visit_date, 'YYYY-MM');
    WHEN 'monthly_branch_snapshots' THEN
      v_branch := (v_rec ->> 'branch_id')::uuid;
      v_month  := public.normalize_month_key(v_rec ->> 'month_key');
    WHEN 'month_closures' THEN
      v_month := public.normalize_month_key(v_rec ->> 'month_key');
    ELSE
      NULL;
  END CASE;

  IF v_branch IS NULL AND v_contract IS NOT NULL THEN
    SELECT cu.branch_id INTO v_branch
      FROM public.contracts c
      JOIN public.customers cu ON cu.id = c.customer_id
     WHERE c.id = v_contract;
  END IF;

  INSERT INTO public.audit_log
    (table_name, row_id, action, old_data, new_data, changed_by, branch_id, contract_id, month_key)
  VALUES
    (TG_TABLE_NAME, v_row_id, lower(TG_OP)::public.audit_action, v_old, v_new, auth.uid(),
     v_branch, v_contract, v_month);

  RETURN NULL; -- AFTER trigger: return value ignored
END;
$$;

-- who closed / re-synced a month (§14 ข้อ 11: closer name kept in audit_log)
CREATE TRIGGER audit_month_closures
  AFTER INSERT OR UPDATE OR DELETE ON public.month_closures
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- provincial manual numbers (§6.5). One trigger per event because a WHEN clause
-- cannot use NEW on DELETE or OLD on INSERT.
CREATE TRIGGER audit_snapshots_manual_write
  AFTER INSERT ON public.monthly_branch_snapshots
  FOR EACH ROW WHEN (NEW.source = 'manual')
  EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_snapshots_manual_update
  AFTER UPDATE ON public.monthly_branch_snapshots
  FOR EACH ROW WHEN (OLD.source = 'manual' OR NEW.source = 'manual')
  EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_snapshots_manual_delete
  AFTER DELETE ON public.monthly_branch_snapshots
  FOR EACH ROW WHEN (OLD.source = 'manual')
  EXECUTE FUNCTION public.audit_trigger();
