-- M30b (20261115230000): ลบ contracts.term_years + กระจก + p_term_years
--   * คอลัมน์ / trigger / function กระจก / CHECK กระจก หายหมด · term_months เป็นแหล่งเดียว
--   * save_job_opening เหลือ signature เดียว (ไม่มี p_term_years) · สิทธิ์เดิม (authenticated ใช่ · anon ไม่)
--   * list_unlinked_renewals ไม่คืนคอลัมน์ปี · trigger กฎ 2 เดือนฟัง term_months
--   * ผู้เขียนแบบเดิมที่ยังส่งปี → error ชัดเจน (42703 / 42883) ไม่เงียบ
--   * กรณีบังคับ CLAUDE.md: 12 เดือน ≡ 1 ปี · 36 เดือน ≡ 3 ปี · Custom 5 เดือน
-- ข้อมูลสมมติทั้งหมด
BEGIN;
SELECT plan(24);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'user_a2', 'admin', '{central}');

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;
CREATE FUNCTION pg_temp.br() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION pg_temp.br() TO PUBLIC;

INSERT INTO customers (id, branch_id, name) VALUES (pg_temp.id('c1'), pg_temp.br(), 'Test Drop Years');

-- =====================================================================
-- โครงสร้าง: ของเดิมหายหมด
-- =====================================================================
SELECT hasnt_column('public', 'contracts', 'term_years', 'contracts.term_years is gone');
SELECT col_not_null('public', 'contracts', 'term_months', 'term_months is still NOT NULL');
SELECT hasnt_trigger('public', 'contracts', 'contracts_00_term_sync', 'mirror trigger is gone');
SELECT hasnt_function('public', 'contracts_term_sync', 'mirror trigger function is gone');
SELECT hasnt_function('public', 'contract_term_years_of', ARRAY['integer'], 'contract_term_years_of is gone');
SELECT is((SELECT count(*)::int FROM pg_constraint
            WHERE conrelid = 'public.contracts'::regclass AND conname = 'contracts_term_years_mirror_check'),
  0, 'mirror CHECK is gone');
SELECT is((SELECT count(*)::int FROM pg_constraint
            WHERE conrelid = 'public.contracts'::regclass AND conname = 'contracts_term_months_check'),
  1, 'term_months CHECK 1–36 kept');
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND (p.prosrc ~ 'term_years' OR 'p_term_years' = ANY (coalesce(p.proargnames, '{}'))
                   OR 'term_years' = ANY (coalesce(p.proargnames, '{}')))),
  NULL::text[], 'no function body, parameter or result column mentions term_years');

-- =====================================================================
-- save_job_opening / list_unlinked_renewals / trigger กฎ 2 เดือน
-- =====================================================================
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'save_job_opening' AND pronamespace = 'public'::regnamespace),
  1, 'exactly one save_job_opening');
SELECT has_function('public', 'save_job_opening',
  ARRAY['uuid', 'text', 'text', 'text', 'date', 'date', 'numeric', 'sale_type', 'uuid[]', 'uuid', 'uuid', 'boolean',
        'text', 'text', 'boolean', 'uuid', 'date', 'date', 'time without time zone', 'text',
        'timestamp with time zone', 'text', 'integer'],
  'save_job_opening ends with p_term_months (no p_term_years)');
SELECT ok(has_function_privilege('authenticated',
    'public.save_job_opening(uuid, text, text, text, date, date, numeric, public.sale_type, uuid[], uuid, uuid, boolean, text, text, boolean, uuid, date, date, time, text, timestamptz, text, integer)',
    'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.save_job_opening(uuid, text, text, text, date, date, numeric, public.sale_type, uuid[], uuid, uuid, boolean, text, text, boolean, uuid, date, date, time, text, timestamptz, text, integer)',
    'EXECUTE'),
  'save_job_opening: authenticated yes, anon no');
SELECT ok(has_function_privilege('authenticated', 'public.list_unlinked_renewals(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.list_unlinked_renewals(uuid)', 'EXECUTE'),
  'list_unlinked_renewals: authenticated yes, anon no');
SELECT is((SELECT proargnames[array_length(proargnames, 1)] FROM pg_proc
            WHERE oid = 'public.list_unlinked_renewals(uuid)'::regprocedure),
  'term_months', 'list_unlinked_renewals still ends with term_months');
SELECT ok((SELECT array_agg(a.attname::text) FROM pg_trigger t
             JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])
            WHERE t.tgrelid = 'public.contracts'::regclass AND t.tgname = 'contracts_renewed_gap_guard')
          @> ARRAY['start_date', 'end_date', 'term_months', 'sale_type', 'renewed_from_contract_id'],
  'gap guard trigger still listens to term_months and the date columns');

-- =====================================================================
-- ผู้เขียนแบบเดิม → error ชัดเจน
-- =====================================================================
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total)
                   VALUES (pg_temp.id('c1'), 'TST-Y1', '2026-01-01', 1, 1000)$$, '42703', NULL,
  'REST/SQL writer still sending term_years → 42703 (column does not exist)');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$SELECT * FROM public.save_job_opening(
      p_branch_id := pg_temp.br(), p_customer_name := 'Test Drop Years', p_customer_type := NULL,
      p_contract_no := 'TST-Y2', p_start_date := '2026-03-01', p_end_date := NULL, p_value_total := 1000,
      p_sale_type := 'new', p_customer_id := pg_temp.id('c1'), p_term_years := 1)$$, '42883', NULL,
  'RPC caller still sending p_term_years → 42883 (no such function)');
SELECT lives_ok($$SELECT * FROM public.save_job_opening(
      p_branch_id := pg_temp.br(), p_customer_name := 'Test Drop Years', p_customer_type := NULL,
      p_contract_no := 'TST-M12', p_start_date := '2026-01-15', p_end_date := NULL, p_value_total := 150000,
      p_sale_type := 'new', p_customer_id := pg_temp.id('c1'), p_term_months := 12)$$,
  'RPC with p_term_months 12 works');
RESET ROLE;
SELECT is((SELECT term_months FROM contracts WHERE contract_no = 'TST-M12'), 12::smallint, 'stored 12 months');

-- =====================================================================
-- กรณีบังคับ (CLAUDE.md) ฝั่ง SQL: 12 ≡ 1 ปี · 36 ≡ 3 ปี · Custom 5 เดือน
-- =====================================================================
SELECT is(contract_default_end_date('2026-01-15', 12), '2027-01-14'::date, '15/01/2026 + 12 months (1 year) → 14/01/2027');
SELECT is(contract_default_end_date('2026-04-03', 12), '2027-04-02'::date, '03/04/2026 + 12 months → 02/04/2027 (Apr 2026 – Mar 2027)');
SELECT is(contract_default_end_date('2026-01-01', 36), '2028-12-31'::date, '01/01/2026 + 36 months (3 years) → 31/12/2028');
SELECT is(contract_default_end_date('2026-01-15', 5),  '2026-06-14'::date, '15/01/2026 + 5 months → 14/06/2026');
SELECT is(contract_default_end_date('2026-01-31', 1),  '2026-02-28'::date, '31/01 + 1 month → 28/02 (month-end clamp)');
SELECT is((SELECT count(*)::int FROM contracts WHERE term_months IS NULL OR term_months NOT BETWEEN 1 AND 36),
  0, 'every contract still has a valid term_months');

SELECT * FROM finish();
ROLLBACK;
