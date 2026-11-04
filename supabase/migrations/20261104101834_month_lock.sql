-- Month lock (Task 10) - SPEC §7.7
-- Blocks INSERT/UPDATE/DELETE on visits and station_checks whose month is CLOSED
-- (a month_closures row exists with reopened_at IS NULL). Host may still edit.
--
-- month_closures.month_key format: ISO 'YYYY-MM' (e.g. '2026-09'), matched
-- against to_char(visit_date, 'YYYY-MM'). (Dashboard JSON 'MMM.YY' is output-only.)
-- On UPDATE both the OLD and NEW month are checked, so a row cannot be moved
-- out of (or into) a closed month.
-- SECURITY DEFINER so the lookup ignores the caller's RLS on month_closures.

CREATE FUNCTION public.block_closed_month()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d date;
  dates date[] := '{}';
  m text;
BEGIN
  IF public.is_host() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_TABLE_NAME = 'visits' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN dates := dates || OLD.visit_date; END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN dates := dates || NEW.visit_date; END IF;
  ELSE -- station_checks: month comes from the parent visit
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      SELECT visit_date INTO d FROM public.visits WHERE id = OLD.visit_id;
      dates := dates || d;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      SELECT visit_date INTO d FROM public.visits WHERE id = NEW.visit_id;
      dates := dates || d;
    END IF;
  END IF;

  FOREACH d IN ARRAY dates LOOP
    CONTINUE WHEN d IS NULL;
    m := to_char(d, 'YYYY-MM');
    IF EXISTS (SELECT 1 FROM public.month_closures
                WHERE month_key = m AND reopened_at IS NULL) THEN
      RAISE EXCEPTION 'month % is closed; edits are not allowed', m
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.block_closed_month() FROM PUBLIC;

CREATE TRIGGER block_closed_month
  BEFORE INSERT OR UPDATE OR DELETE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.block_closed_month();

CREATE TRIGGER block_closed_month
  BEFORE INSERT OR UPDATE OR DELETE ON public.station_checks
  FOR EACH ROW EXECUTE FUNCTION public.block_closed_month();
