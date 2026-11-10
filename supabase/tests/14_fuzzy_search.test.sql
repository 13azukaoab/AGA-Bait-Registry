-- pg_trgm fuzzy search on customer name / contract number (SPEC §8.1, v1.6 ข้อ 7)
BEGIN;
SELECT plan(8);

SELECT ok(EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'), 'pg_trgm installed');
SELECT has_index('public', 'customers', 'customers_name_trgm_idx', 'trigram index on customers.name');
SELECT has_index('public', 'contracts', 'contracts_contract_no_trgm_idx', 'trigram index on contracts.contract_no');
SELECT ok((SELECT indexdef FROM pg_indexes WHERE indexname = 'customers_name_trgm_idx') ~ 'USING gin .*gin_trgm_ops',
  'customers name index is GIN gin_trgm_ops');
SELECT ok((SELECT indexdef FROM pg_indexes WHERE indexname = 'contracts_contract_no_trgm_idx') ~ 'USING gin .*gin_trgm_ops',
  'contract_no index is GIN gin_trgm_ops');

-- Thai text must produce trigrams (depends on the database ctype; checked 10 Nov 2026
-- on local en_US.UTF-8 — re-run on the cloud project before relying on it)
SELECT cmp_ok(coalesce(array_length(extensions.show_trgm('บ้านสวนจันทร์'), 1), 0), '>', 0,
  'Thai name yields trigrams');
SELECT cmp_ok(extensions.similarity('บ้านสวนจันทร์', 'บ้านสวนจันท'), '>=', 0.5::real,
  'Thai typo still similar (>= 0.5)');
SELECT cmp_ok(extensions.similarity('CT26-0001234', 'ct260001234'), '>=', 0.5::real,
  'contract number without dash still similar (>= 0.5)');

SELECT * FROM finish();
ROLLBACK;
