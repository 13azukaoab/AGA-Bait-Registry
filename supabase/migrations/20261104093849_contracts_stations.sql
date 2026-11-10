-- contracts, contract_teams (many-to-many), stations (Task 5)
-- RESTRICT on customers/contracts/stations: never auto-delete (SPEC 7.8).
-- RLS is added in a later migration (Task 9).

CREATE TABLE public.contracts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  contract_no   text NOT NULL UNIQUE,
  start_date    date NOT NULL,
  end_date      date,
  term_years    smallint NOT NULL CHECK (term_years IN (1, 3)),
  value_total   numeric(12,2) NOT NULL,
  sale_type     public.sale_type,
  site_plan_ig  text,
  site_plan_ic  text,
  status        public.contract_status NOT NULL DEFAULT 'active',
  sale_name     text,
  am_name       text,
  cancelled_at  timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contracts_customer_id_idx ON public.contracts (customer_id);

CREATE TABLE public.contract_teams (
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  team_id     uuid NOT NULL REFERENCES public.teams(id),
  PRIMARY KEY (contract_id, team_id)
);

CREATE INDEX contract_teams_team_id_idx ON public.contract_teams (team_id);

CREATE TABLE public.stations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  uuid NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
  code         text,
  type         public.station_type NOT NULL,
  installed_at date,
  status       public.station_status NOT NULL DEFAULT 'active',
  removed_at   timestamptz,
  collected_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stations_contract_id_idx ON public.stations (contract_id);
