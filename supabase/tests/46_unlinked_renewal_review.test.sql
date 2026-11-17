-- M28b (20261115210000): ตรวจ Renew ที่ไม่ผูกสัญญาเก่า
--   * link_renewal_contract: host + admin ในขอบเขต (นอกขอบเขต / recorder / viewer / anon ปฏิเสธ) · กฎ 2 เดือน · audit
--   * close_unlinked_renewal: host + admin ในขอบเขต · ปิดแล้วหายจาก list_unlinked_renewals · audit · ปิดซ้ำ/ผูกแล้ว/New ปฏิเสธ
--   * ผูกหลังปิดได้ (ล้างสถานะปิด) · REST เขียนช่องปิดรายการตรงไม่ได้ (AG019) · CHECK + ล้างอัตโนมัติ
-- วันที่ตายตัว ยกเว้นช่วงเปิด Renew ไม่ผูก (app_settings) ตั้งเทียบวันนี้ → ไม่พังเมื่อเลย 2027-04-01
BEGIN;
SELECT plan(65);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}'),
  ('00000000-0000-0000-0000-0000000000a4', 'viewer',   'user_a4', 'viewer',   '{central}');

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;
CREATE FUNCTION pg_temp.td() RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.td() TO PUBLIC;
CREATE FUNCTION pg_temp.bc() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION pg_temp.bc() TO PUBLIC;
CREATE FUNCTION pg_temp.bp() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION pg_temp.bp() TO PUBLIC;

-- ช่วงเปิด Renew ไม่ผูก = อีก 30 วัน (ใช้กับเทส INSERT ผ่าน REST)
UPDATE app_settings SET allow_unlinked_renew_until = pg_temp.td() + 30;

INSERT INTO customers (id, branch_id, name) VALUES
  (pg_temp.id('c1'), pg_temp.bc(), 'Alpha'),
  (pg_temp.id('c2'), pg_temp.bp(), 'Beta (province)'),
  (pg_temp.id('c3'), pg_temp.bc(), 'Gamma');

-- สัญญาเก่า: o1 อยู่ในช่วง (จบ 31 ธ.ค. 2026 → Renew เริ่ม ม.ค.–ก.พ. 2027) · o2 ไกลเกินช่วง · o3 ลูกค้าอื่น · po จังหวัด
INSERT INTO contracts (id, customer_id, contract_no, start_date, end_date, term_months, value_total, sale_type) VALUES
  (pg_temp.id('01'), pg_temp.id('c1'), 'O-1',  '2026-01-01', '2026-12-31', 12, 24000, 'new'),
  (pg_temp.id('02'), pg_temp.id('c1'), 'O-2',  '2024-01-01', '2024-12-31', 12, 24000, 'new'),
  (pg_temp.id('03'), pg_temp.id('c3'), 'O-3',  '2026-01-01', '2026-12-31', 12, 24000, 'new'),
  (pg_temp.id('04'), pg_temp.id('c2'), 'PO-1', '2026-01-01', '2026-12-31', 12, 24000, 'new'),
  (pg_temp.id('05'), pg_temp.id('c1'), 'N-1',  '2027-01-15', NULL,         12, 24000, 'new');
-- Renew ไม่ผูก (ข้อมูลเก่า: postgres ไม่บังคับเหตุผล)
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, sale_type) VALUES
  (pg_temp.id('a1'), pg_temp.id('c1'), 'U-1', '2027-01-15', 12, 24000, 'renew'),
  (pg_temp.id('a2'), pg_temp.id('c1'), 'U-2', '2027-01-15', 12, 24000, 'renew'),
  (pg_temp.id('a3'), pg_temp.id('c1'), 'U-3', '2027-01-15', 12, 24000, 'renew'),
  (pg_temp.id('a4'), pg_temp.id('c1'), 'U-4', '2027-01-15', 12, 24000, 'renew'),
  (pg_temp.id('a5'), pg_temp.id('c1'), 'U-5', '2027-01-15', 12, 24000, 'renew'),
  (pg_temp.id('a6'), pg_temp.id('c1'), 'U-6', '2027-01-15', 12, 24000, 'renew'),
  (pg_temp.id('a7'), pg_temp.id('c1'), 'U-7', '2027-01-15', 12, 24000, 'renew'),
  (pg_temp.id('d1'), pg_temp.id('c2'), 'U-P', '2027-01-15', 12, 24000, 'renew');
-- Renew ที่ผูกแล้ว (ข้อมูลเก่า)
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, sale_type, renewed_from_contract_id) VALUES
  (pg_temp.id('b1'), pg_temp.id('c1'), 'L-1', '2027-01-10', 12, 24000, 'renew', pg_temp.id('01'));
-- a6 = ยกเลิกแล้ว
UPDATE contracts SET status = 'cancelled' WHERE id = pg_temp.id('a6');

CREATE FUNCTION pg_temp.link(p_c text, p_old text) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT * FROM public.link_renewal_contract(%L, %L)', pg_temp.id(p_c), pg_temp.id(p_old))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.link(text, text) TO PUBLIC;
CREATE FUNCTION pg_temp.cl(p_c text, p_note text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT * FROM public.close_unlinked_renewal(%L, %L)', pg_temp.id(p_c), p_note)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.cl(text, text) TO PUBLIC;
CREATE FUNCTION pg_temp.listed(p_c text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.list_unlinked_renewals() WHERE contract_id = pg_temp.id(p_c))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.listed(text) TO PUBLIC;

-- =====================================================================
-- โครงสร้าง + สิทธิ์
-- =====================================================================
SELECT has_function('public', 'close_unlinked_renewal', ARRAY['uuid', 'text'], 'close_unlinked_renewal exists');
SELECT has_trigger('public', 'contracts', 'contracts_unlinked_close_guard', 'close guard trigger exists');
SELECT ok(NOT has_function_privilege('anon', 'public.close_unlinked_renewal(uuid, text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.link_renewal_contract(uuid, uuid)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.close_unlinked_renewal(uuid, text)', 'EXECUTE'),
  'anon cannot call link/close · authenticated can (role checked inside)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.contracts_unlinked_close_guard()', 'EXECUTE'),
  'guard function is not callable directly');

-- =====================================================================
-- admin ในขอบเขต ผูกสัญญาเก่า
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT lives_ok(pg_temp.link('a1', '01'), 'admin (in scope) links an unlinked Renew inside the 2-month window');
SELECT ok((SELECT renewed_from_contract_id = pg_temp.id('01') AND renew_unlinked_reason IS NULL
             FROM contracts WHERE id = pg_temp.id('a1')),
  'the link is set');
RESET ROLE;
SELECT ok(EXISTS (SELECT 1 FROM audit_log
                   WHERE table_name = 'contracts' AND row_id = pg_temp.id('a1') AND action = 'update'
                     AND old_data->>'renewed_from_contract_id' IS NULL
                     AND new_data->>'renewed_from_contract_id' = pg_temp.id('01')::text
                     AND changed_by = '00000000-0000-0000-0000-0000000000a2'),
  'the admin link is recorded in audit_log with the admin as actor');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok(pg_temp.link('a2', '02'), 'AG010', NULL, 'admin: old contract outside the 2-month window → AG010');
SELECT throws_ok(pg_temp.link('a2', '03'), 'P0001', NULL, 'admin: old contract of another customer → P0001 (M9)');
SELECT throws_ok(pg_temp.link('a1', '01'), 'AG014', NULL, 'admin: an already linked Renew → AG014');
SELECT throws_ok(pg_temp.link('05', '01'), 'AG014', NULL, 'admin: a New contract → AG014');
SELECT is((SELECT renewed_from_contract_id FROM contracts WHERE id = pg_temp.id('a2')), NULL::uuid, 'refused links changed nothing');

-- =====================================================================
-- admin นอกขอบเขต / recorder / viewer / anon
-- =====================================================================
SELECT throws_ok(pg_temp.link('d1', '04'), '42501', NULL, 'admin (central) cannot link a province contract');
SELECT throws_ok(pg_temp.cl('d1'), '42501', NULL, 'admin (central) cannot close a province contract');
SELECT is((SELECT unlinked_closed_at FROM contracts WHERE id = pg_temp.id('d1')), NULL::timestamptz, 'province row is untouched');
SELECT throws_ok(pg_temp.cl('00'), '42501', NULL, 'admin: closing a non-existent contract is 42501 (no existence leak)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok(pg_temp.link('a2', '01'), '42501', NULL, 'recorder cannot link');
SELECT throws_ok(pg_temp.cl('a2'), '42501', NULL, 'recorder cannot close');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT throws_ok(pg_temp.link('a2', '01'), '42501', NULL, 'viewer cannot link');
SELECT throws_ok(pg_temp.cl('a2'), '42501', NULL, 'viewer cannot close');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok(pg_temp.link('a2', '01'), '42501', NULL, 'anon cannot link');
SELECT throws_ok(pg_temp.cl('a2'), '42501', NULL, 'anon cannot close');
RESET ROLE;

-- =====================================================================
-- ปิดรายการ: admin
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT ok(pg_temp.listed('a2') AND pg_temp.listed('a3'), 'before closing: unlinked Renews are listed');
SELECT lives_ok(pg_temp.cl('a3', '  ไม่มีสัญญาเก่าในระบบ  '), 'admin (in scope) closes an unlinked Renew with a note');
SELECT ok((SELECT unlinked_closed_at IS NOT NULL AND unlinked_closed_by = '00000000-0000-0000-0000-0000000000a2'
                  AND unlinked_closed_note = 'ไม่มีสัญญาเก่าในระบบ'
             FROM contracts WHERE id = pg_temp.id('a3')),
  'closed_at / closed_by (the caller) / trimmed note are stored');
SELECT ok(NOT pg_temp.listed('a3') AND pg_temp.listed('a2'), 'the closed row disappears from the list; others stay');
RESET ROLE;
SELECT ok(EXISTS (SELECT 1 FROM audit_log
                   WHERE table_name = 'contracts' AND row_id = pg_temp.id('a3') AND action = 'update'
                     AND old_data->>'unlinked_closed_at' IS NULL AND new_data->>'unlinked_closed_at' IS NOT NULL
                     AND changed_by = '00000000-0000-0000-0000-0000000000a2'),
  'closing is recorded in audit_log');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT ok((SELECT renewed_from_contract_id IS NULL AND sale_type = 'renew' FROM contracts WHERE id = pg_temp.id('a3')),
  'a closed row stays a Renew without a link (permanently, no 2-month check)');
SELECT throws_ok(pg_temp.cl('a3'), 'AG018', NULL, 'admin: closing an already closed row → AG018');

-- ---------- ปิดรายการ: host ----------
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok(pg_temp.cl('a4'), 'host closes an unlinked Renew without a note');
SELECT is((SELECT unlinked_closed_note FROM contracts WHERE id = pg_temp.id('a4')), NULL::text, 'no note → NULL');
SELECT ok(NOT pg_temp.listed('a4'), 'host list no longer shows it');
SELECT lives_ok(pg_temp.cl('d1', 'จังหวัด'), 'host closes a province row (host is not division-scoped)');
SELECT throws_ok(pg_temp.cl('a4'), 'AG018', NULL, 'host: closing again → AG018');
SELECT throws_ok(pg_temp.cl('a1'), 'AG014', NULL, 'host: closing a linked Renew → AG014');
SELECT throws_ok(pg_temp.cl('05'), 'AG014', NULL, 'host: closing a New contract → AG014');
SELECT throws_ok(pg_temp.cl('b1'), 'AG014', NULL, 'host: closing a Renew linked at import → AG014');
SELECT throws_ok(pg_temp.cl('00'), 'AG004', NULL, 'host: closing a non-existent contract → AG004');
SELECT throws_ok($$SELECT * FROM public.close_unlinked_renewal(NULL, NULL)$$, '22004', NULL, 'host: NULL contract → 22004');

-- ---------- สัญญายกเลิกแล้ว: admin แก้ไม่ได้ (AG007 เดิม) · host ได้ ----------
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok(pg_temp.cl('a6'), 'AG007', NULL, 'admin cannot close a cancelled contract (AG007)');
SELECT throws_ok(pg_temp.link('a6', '01'), 'AG007', NULL, 'admin cannot link a cancelled contract (AG007)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok(pg_temp.cl('a6'), 'host can close a cancelled contract');

-- =====================================================================
-- ผูกหลังปิด (ค่าเริ่มต้น: ได้ — ล้างสถานะปิด · กฎ 2 เดือนยังตรวจ)
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok(pg_temp.link('a3', '02'), 'AG010', NULL, 'linking a closed row still enforces the 2-month rule');
SELECT ok((SELECT unlinked_closed_at IS NOT NULL FROM contracts WHERE id = pg_temp.id('a3')), 'a refused link leaves it closed');
SELECT lives_ok(pg_temp.link('a3', '01'), 'admin links a closed row after the old contract turns up');
SELECT ok((SELECT renewed_from_contract_id = pg_temp.id('01')
                  AND unlinked_closed_at IS NULL AND unlinked_closed_by IS NULL AND unlinked_closed_note IS NULL
             FROM contracts WHERE id = pg_temp.id('a3')),
  'linking clears the whole closed state');
RESET ROLE;
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'contracts' AND row_id = pg_temp.id('a3')
                     AND new_data->>'unlinked_closed_at' IS NOT NULL),
  'the earlier closing is still in audit_log');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok(pg_temp.cl('a3'), 'AG014', NULL, 'a linked row can no longer be closed');

-- =====================================================================
-- REST ตรง: เขียนช่องปิดรายการไม่ได้
-- =====================================================================
SELECT throws_ok($$UPDATE contracts SET unlinked_closed_at = now(), unlinked_closed_by = '00000000-0000-0000-0000-0000000000a2'
                    WHERE id = pg_temp.id('a2')$$,
  'AG019', NULL, 'admin REST UPDATE: closing directly → AG019');
SELECT throws_ok($$UPDATE contracts SET unlinked_closed_note = 'x' WHERE id = pg_temp.id('a2')$$,
  'AG019', NULL, 'admin REST UPDATE: writing only the note → AG019');
SELECT throws_ok($$UPDATE contracts SET unlinked_closed_at = NULL, unlinked_closed_by = NULL, unlinked_closed_note = NULL
                    WHERE id = pg_temp.id('a4')$$,
  'AG019', NULL, 'admin REST UPDATE: re-opening a closed row directly → AG019');
SELECT throws_ok($$UPDATE contracts SET sale_type = 'new' WHERE id = pg_temp.id('a4')$$,
  'AG019', NULL, 'admin cannot reopen a closed row by flipping sale_type (auto-clear is not a back door)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$UPDATE contracts SET unlinked_closed_at = now(), unlinked_closed_by = '00000000-0000-0000-0000-0000000000a1'
                    WHERE id = pg_temp.id('a2')$$,
  'AG019', NULL, 'host REST UPDATE: closing directly → AG019');
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_months, value_total, sale_type, renew_unlinked_reason,
                                          unlinked_closed_at, unlinked_closed_by)
                   VALUES (pg_temp.id('c1'), 'REST-C', '2027-01-15', 12, 24000, 'renew', 'x', now(), '00000000-0000-0000-0000-0000000000a1')$$,
  'AG019', NULL, 'host REST INSERT: a row born closed → AG019');
-- GUC ตั้งมือ: ต้องตรงแถว + ผู้ปิดต้องเป็นผู้เรียก
SELECT set_config('aga.renewal_close', pg_temp.id('a2')::text, true);
SELECT throws_ok($$UPDATE contracts SET unlinked_closed_at = now(), unlinked_closed_by = '00000000-0000-0000-0000-0000000000a2'
                    WHERE id = pg_temp.id('a2')$$,
  'AG019', NULL, 'GUC set by hand but closed_by is someone else → AG019');
SELECT throws_ok($$UPDATE contracts SET unlinked_closed_at = now(), unlinked_closed_by = '00000000-0000-0000-0000-0000000000a1'
                    WHERE id = pg_temp.id('a5')$$,
  'AG019', NULL, 'GUC set by hand for another row → AG019');
SELECT set_config('aga.renewal_close', '', true);
SELECT lives_ok($$UPDATE contracts SET note = 'ok' WHERE id = pg_temp.id('a2')$$, 'other fields of an unlinked Renew are still editable');
SELECT lives_ok(pg_temp.cl('a2'), 'the RPC still works after the refused REST attempts (GUC does not linger)');

-- =====================================================================
-- CHECK + ล้างอัตโนมัติ (postgres)
-- =====================================================================
RESET ROLE;
SELECT throws_ok($$UPDATE contracts SET unlinked_closed_at = now() WHERE id = pg_temp.id('a5')$$,
  '23514', NULL, 'CHECK: closed_at without closed_by is refused');
UPDATE contracts SET unlinked_closed_at = now(), unlinked_closed_by = pg_temp.id('a1') WHERE id = pg_temp.id('a5');
SELECT ok((SELECT unlinked_closed_at IS NOT NULL FROM contracts WHERE id = pg_temp.id('a5')),
  'postgres (import) can set the closed state on an unlinked Renew');
UPDATE contracts SET sale_type = 'new' WHERE id = pg_temp.id('a5');
SELECT ok((SELECT unlinked_closed_at IS NULL AND unlinked_closed_by IS NULL FROM contracts WHERE id = pg_temp.id('a5')),
  'a row that stops being an unlinked Renew (→ New) has its closed state cleared');
UPDATE contracts SET unlinked_closed_at = now(), unlinked_closed_by = pg_temp.id('a1') WHERE id = pg_temp.id('05');
SELECT ok((SELECT unlinked_closed_at IS NULL FROM contracts WHERE id = pg_temp.id('05')),
  'the closed state cannot stick to a New contract');

-- =====================================================================
-- list: admin เห็นเฉพาะที่ยังไม่ปิด ในขอบเขต
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT ok(pg_temp.listed('a7') AND NOT pg_temp.listed('a4') AND NOT pg_temp.listed('d1'),
  'admin list: open rows in scope only (closed and out-of-scope rows are absent)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT ok(pg_temp.listed('a7') AND NOT pg_temp.listed('d1') AND NOT pg_temp.listed('a6'),
  'host list: open rows; closed rows (incl. province / cancelled) are absent');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT * FROM public.list_unlinked_renewals()$$, '42501', NULL, 'recorder still cannot read the list');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
