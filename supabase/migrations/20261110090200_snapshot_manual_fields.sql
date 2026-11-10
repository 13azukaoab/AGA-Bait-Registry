-- monthly_branch_snapshots v1.4 — provincial manual numbers (SPEC §6, §6.5)
--
-- Logic summary:
--   * v_s1 … v_xl3 : value per tier (8). For source='manual' the app derives
--       cust = s1+…+xl3, vS = v_s1+v_s3, vM = v_m1+v_m3, vL = v_l1+v_l3,
--       vXL = v_xl1+v_xl3, value = sum of the 8 — never typed twice (§6.5).
--     Dashboard JSON still only emits vS/vM/vL/vXL (§9.1 unchanged).
--   * report_cust / report_value : totals typed from the branch report, used to
--       check the entry (NULL = not compared yet -> warning in the UI).
--   * confirmed_at / confirmed_by : "updated" status (NULL = "not updated yet",
--       e.g. a value carried over from the previous month).
--   * Write access is unchanged: only host writes ANY snapshot row
--     (snapshots_host_write from 20261104100318). That already satisfies
--     "source='manual' rows are host-only" (§6.5); computed rows are written by
--     host or by the server (service role) when a month is closed / re-synced.
--   * Read access is unchanged: anon + authenticated may read (public Dashboard).

ALTER TABLE public.monthly_branch_snapshots
  ADD COLUMN v_s1  numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN v_s3  numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN v_m1  numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN v_m3  numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN v_l1  numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN v_l3  numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN v_xl1 numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN v_xl3 numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN report_cust  int,
  ADD COLUMN report_value numeric(14,2),
  ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN confirmed_by uuid REFERENCES auth.users (id);
