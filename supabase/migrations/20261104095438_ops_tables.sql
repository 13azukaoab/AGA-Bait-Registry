-- ops tables (Task 7): month_closures + monthly_branch_snapshots
-- Snapshot column names match Dashboard JSON keys (SPEC §9.1) - do not rename.
-- value_annual is stored but not emitted in phase 1. RLS is added in Task 9.

CREATE TABLE public.month_closures (
  month_key   text PRIMARY KEY,
  closed_by   uuid REFERENCES auth.users(id),
  closed_at   timestamptz,
  reopened_by uuid REFERENCES auth.users(id),
  reopened_at timestamptz
);

CREATE TABLE public.monthly_branch_snapshots (
  month_key    text NOT NULL,
  branch_id    uuid NOT NULL REFERENCES public.branches(id),
  source       public.snapshot_source NOT NULL,
  s1           int NOT NULL DEFAULT 0,
  s3           int NOT NULL DEFAULT 0,
  m1           int NOT NULL DEFAULT 0,
  m3           int NOT NULL DEFAULT 0,
  l1           int NOT NULL DEFAULT 0,
  l3           int NOT NULL DEFAULT 0,
  xl1          int NOT NULL DEFAULT 0,
  xl3          int NOT NULL DEFAULT 0,
  cust         int NOT NULL DEFAULT 0,
  "vS"         numeric(14,2) NOT NULL DEFAULT 0,
  "vM"         numeric(14,2) NOT NULL DEFAULT 0,
  "vL"         numeric(14,2) NOT NULL DEFAULT 0,
  "vXL"        numeric(14,2) NOT NULL DEFAULT 0,
  value        numeric(14,2) NOT NULL DEFAULT 0,
  value_annual numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (month_key, branch_id)
);
