-- visits, station_checks + auto follow_up_no trigger (Task 6)
-- follow_up_no (F1, F2, ...) is counted PER STATION (SPEC 7.5), never per customer,
-- and is always computed by the trigger (client value is overwritten).
-- Ties: two checks of the same station on the SAME visit_date get the same number
-- (strictly-earlier dates only are counted).
-- RLS is added in a later migration (Task 9).

CREATE TABLE public.visits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id         uuid NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
  visit_date          date NOT NULL,
  visit_type          public.visit_type NOT NULL,
  team_id             uuid REFERENCES public.teams(id),
  duration_min        int,
  internal_inspection boolean,
  signed_by_proxy     boolean,
  timber_pcs          int,
  bait_ig_ic_g        int,
  bait_ag_g           int,
  powder_chemical     int,
  first_install       boolean,
  note                text,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX visits_contract_id_idx ON public.visits (contract_id);
CREATE INDEX visits_visit_date_idx ON public.visits (visit_date);

CREATE TABLE public.station_checks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id      uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  station_id    uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  follow_up_no  int,
  termite_caste public.termite_caste,  -- NULL = no termites found
  bait_added_g  int CHECK (bait_added_g % 50 = 0),
  note          text
);

CREATE INDEX station_checks_visit_id_idx ON public.station_checks (visit_id);
CREATE INDEX station_checks_station_id_idx ON public.station_checks (station_id);

CREATE FUNCTION public.set_follow_up_no() RETURNS trigger
LANGUAGE plpgsql
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

CREATE TRIGGER set_follow_up_no
  BEFORE INSERT ON public.station_checks
  FOR EACH ROW EXECUTE FUNCTION public.set_follow_up_no();
