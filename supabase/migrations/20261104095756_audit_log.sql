-- audit_log + generic audit trigger (Task 8)
-- Records every insert/update/delete on the data tables as old/new jsonb.
-- RLS on audit_log is added in a later migration (Task 9).
-- NOTE: audit_action enum is lowercase, TG_OP is uppercase -> lower(TG_OP) cast.

CREATE TABLE public.audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  row_id     uuid,                      -- NULL for tables without a single id (contract_teams)
  action     public.audit_action NOT NULL,
  old_data   jsonb,
  new_data   jsonb,
  changed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_table_row_idx ON public.audit_log (table_name, row_id);
CREATE INDEX audit_log_changed_at_idx ON public.audit_log (changed_at);

CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_row_id uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;

  -- tables without an "id" column (contract_teams) yield NULL here
  v_row_id := NULLIF(COALESCE(v_new, v_old) ->> 'id', '')::uuid;

  INSERT INTO public.audit_log (table_name, row_id, action, old_data, new_data, changed_by)
  VALUES (TG_TABLE_NAME, v_row_id, lower(TG_OP)::public.audit_action, v_old, v_new, auth.uid());

  RETURN NULL; -- AFTER trigger: return value ignored
END;
$$;

CREATE TRIGGER audit_customers
  AFTER INSERT OR UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_contracts
  AFTER INSERT OR UPDATE OR DELETE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_contract_teams
  AFTER INSERT OR UPDATE OR DELETE ON public.contract_teams
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_stations
  AFTER INSERT OR UPDATE OR DELETE ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_visits
  AFTER INSERT OR UPDATE OR DELETE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_station_checks
  AFTER INSERT OR UPDATE OR DELETE ON public.station_checks
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
