-- Smoke test: confirms Docker + pgTAP harness works (`supabase test db`).
BEGIN;
SELECT plan(1);
SELECT has_schema('public');
SELECT * FROM finish();
ROLLBACK;
