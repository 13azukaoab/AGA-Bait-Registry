-- Public summary view (Task 9). NO PII: only snapshot numbers + area/branch names.
-- Runs with the owner's rights (default, NOT security_invoker) so anon can read it
-- without any access to the underlying reference tables.
CREATE VIEW public.v_branch_summary AS
SELECT
  s.month_key,
  z.name     AS zone_name,
  b.name     AS branch_name,
  b.division AS division,
  s.source,
  s.s1, s.s3, s.m1, s.m3, s.l1, s.l3, s.xl1, s.xl3,
  s.cust,
  s."vS", s."vM", s."vL", s."vXL",
  s.value,
  s.value_annual
FROM public.monthly_branch_snapshots s
JOIN public.branches b ON b.id = s.branch_id
JOIN public.zones z    ON z.id = b.zone_id;

REVOKE ALL ON public.v_branch_summary FROM PUBLIC;
GRANT SELECT ON public.v_branch_summary TO anon, authenticated;
