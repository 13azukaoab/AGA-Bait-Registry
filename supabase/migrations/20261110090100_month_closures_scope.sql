-- month_closures v1.2 + v1.5 (SPEC §6, §7.7, §14 ข้อ 11, 14)
--
-- Logic summary:
--   * v1.2: no "reopen" step any more -> drop reopened_by / reopened_at.
--     "Recompute snapshot + send Dashboard" is recorded in last_resync_at/by.
--   * v1.5: a month is closed in two independent parts:
--       scope = 'central'    (24 central branches, computed from the registry)
--       scope = 'provincial' (19 provincial branches, manual numbers §6.5)
--     key = (month_key, scope) -> one month can hold up to 2 rows.
--     NOTE: the enum label is 'provincial' (SPEC §6), while branches.division uses
--     'province'. The app maps division 'province' <-> scope 'provincial'.
--   * Who may close (RLS):
--       host     : both scopes, any action (existing month_closures_host_write)
--       recorder : INSERT / UPDATE only scope 'central', and only when 'central' is
--                  in the recorder's division_scope. No DELETE (no reopen step).
--                  Phase 1: provincial is host-only (§14 ข้อ 14 ก) — to open it to
--                  recorders later, add a policy for scope 'provincial' + division
--                  'province' instead of rewriting this one.
--       admin / anon : read (admin) or nothing (anon); no writes.
--   * closed_by / closed_at default to the signed-in user / now(); the audit trigger
--     (added in 20261110090400) keeps the real author of every change.
--   * month_key format stays ISO 'YYYY-MM' (same as the 20261104 migrations).

CREATE TYPE public.closure_scope AS ENUM ('central', 'provincial');

ALTER TABLE public.month_closures
  DROP COLUMN reopened_by,
  DROP COLUMN reopened_at,
  ADD COLUMN scope public.closure_scope NOT NULL DEFAULT 'central',
  ADD COLUMN last_resync_at timestamptz,
  ADD COLUMN last_resync_by uuid REFERENCES auth.users (id);

-- existing rows (if any) were central closures; new rows must name their scope
ALTER TABLE public.month_closures ALTER COLUMN scope DROP DEFAULT;

ALTER TABLE public.month_closures
  ALTER COLUMN closed_by SET DEFAULT auth.uid(),
  ALTER COLUMN closed_at SET DEFAULT now();

ALTER TABLE public.month_closures DROP CONSTRAINT month_closures_pkey;
ALTER TABLE public.month_closures ADD PRIMARY KEY (month_key, scope);

-- ---- RLS: recorder may close / re-sync the central part only ----
CREATE POLICY month_closures_recorder_insert ON public.month_closures
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'recorder'
    AND scope = 'central'
    AND 'central'::public.division = ANY (public.current_division_scope())
  );

CREATE POLICY month_closures_recorder_update ON public.month_closures
  FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'recorder'
    AND scope = 'central'
    AND 'central'::public.division = ANY (public.current_division_scope())
  )
  WITH CHECK (
    public.current_app_role() = 'recorder'
    AND scope = 'central'
    AND 'central'::public.division = ANY (public.current_division_scope())
  );
