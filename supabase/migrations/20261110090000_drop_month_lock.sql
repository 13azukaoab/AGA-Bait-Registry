-- Remove the closed-month lock (SPEC v1.2 §7.7 — owner decision 6 Nov 2026)
--
-- 20261104101834_month_lock.sql blocked every non-host edit to visits/station_checks
-- of a closed month. SPEC v1.2 reversed that: a closed month is NOT locked.
--
-- What enforces the rules now (no new code needed):
--   * who may edit service results  -> existing RLS on visits/station_checks
--       host: everything · recorder: rows whose branch is in division_scope
--       admin / viewer(anon): no write policy => rejected
--   * every edit is recorded         -> existing audit_visits / audit_station_checks
--   * Dashboard keeps the old numbers -> snapshots are only rewritten on an explicit
--                                         "recompute snapshot" (app/server logic)

DROP TRIGGER IF EXISTS block_closed_month ON public.visits;
DROP TRIGGER IF EXISTS block_closed_month ON public.station_checks;
DROP FUNCTION IF EXISTS public.block_closed_month();
