-- customers table (Task 4). Contains customer PII.
-- RLS is added in a later migration: viewer/anon must never read this table.
CREATE TABLE public.customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES public.branches(id),
  name          text NOT NULL,
  address       text,
  phone         text,
  contact_name  text,
  customer_type text REFERENCES public.customer_types(code),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
