-- Fuzzy search on customer name / contract number (SPEC §8.1, v1.6 ข้อ 7)
--
-- Logic summary:
--   * pg_trgm lives in the Supabase "extensions" schema (no extra cost).
--   * GIN trigram indexes speed up ILIKE '%…%', similarity() and the % operator on
--     the raw columns. The screen-5 rule (lower-case, strip spaces/dots/dashes, then
--     bigram score) is applied by the app on the candidate rows these indexes find.
--   * Thai names: trigrams depend on the database ctype. Verified on local
--     en_US.UTF-8 (supabase/tests/14_fuzzy_search.test.sql) — re-run that test on
--     the cloud project with real Thai names before relying on it.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX customers_name_trgm_idx
  ON public.customers USING gin (name extensions.gin_trgm_ops);

CREATE INDEX contracts_contract_no_trgm_idx
  ON public.contracts USING gin (contract_no extensions.gin_trgm_ops);
