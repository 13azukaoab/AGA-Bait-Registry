-- M23 (20261115100000): ล็อก contracts.renewed_from_contract_id หลังสร้าง (DECISIONS 2.48 ①)
--   * กำหนดได้ตอนเปิดงานต่อสัญญา (save_job_opening โหมดสร้าง) เท่านั้น
--   * host / admin / recorder แก้ผ่าน UPDATE ตรงๆ → AG009 (ทั้งเปลี่ยนค่า ล้างเป็น NULL และตั้งค่าให้สัญญาที่ยังไม่ผูก)
--   * แก้ช่องอื่นของสัญญาที่ต่อแล้ว / บันทึกซ้ำผ่าน save_job_opening ด้วยค่าเดิม ยังทำได้
--   * M18 โมฆะตอนต่อสัญญา ยังทำงาน · ลบสัญญาเก่า (FK ON DELETE SET NULL) ยังทำได้
-- วันที่อ้างจาก "เดือนปัจจุบัน" (Asia/Bangkok) ผ่าน pg_temp.m(n) → เทสไม่พังเมื่อเวลาผ่านไป
--   d1 = สัญญาเก่าที่ต่อ (มีเดือนตกบริการค้าง) · d2 = สัญญาอื่นของลูกค้าเดียวกัน (ยังไม่ผูก) · d3/d4 = คู่ทดสอบลบสัญญาเก่า
BEGIN;
SELECT plan(33);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}');
INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Central');

CREATE FUNCTION pg_temp.m(n int) RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok')) + make_interval(months => n))::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.m(int) TO PUBLIC;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;
-- เดือนตกบริการค้างของสัญญา (ว่าง = ไม่มี)
CREATE FUNCTION pg_temp.pending(p text) RETURNS date[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(missed_month ORDER BY missed_month), '{}')
    FROM public.list_pending_missed_services() WHERE contract_id = pg_temp.id(p)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.pending(text) TO PUBLIC;
CREATE FUNCTION pg_temp.link(p text) RETURNS uuid LANGUAGE sql AS $$
  SELECT renewed_from_contract_id FROM public.contracts WHERE id = pg_temp.id(p)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.link(text) TO PUBLIC;

INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at) VALUES
  (pg_temp.id('d1'), pg_temp.id('c1'), 'L-1', pg_temp.m(-18), 12, 50000, pg_temp.m(-18)),
  (pg_temp.id('d2'), pg_temp.id('c1'), 'L-2', pg_temp.m(-18), 12, 50000, pg_temp.m(-18)),
  (pg_temp.id('d3'), pg_temp.id('c1'), 'L-3', pg_temp.m(-18), 12, 50000, pg_temp.m(-18));

-- ผลลัพธ์ของ save_job_opening (เก็บไว้ตรวจ)
CREATE TEMP TABLE _r (tag text, contract_id uuid, updated_at timestamptz);
GRANT ALL ON _r TO PUBLIC;

-- ---------- โครงสร้าง ----------
SELECT has_trigger('public', 'contracts', 'contracts_renewed_from_lock', 'guard trigger exists on contracts');
SELECT ok(NOT has_function_privilege('authenticated', 'public.contracts_renewed_from_lock()', 'EXECUTE'),
  'guard function is not callable by authenticated directly');

-- ---------- ก่อนต่อสัญญา: d1 มีเดือนตกบริการค้าง ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT ok(cardinality(pg_temp.pending('d1')) > 0, 'before renewal: d1 has open missed months');

-- ---------- เปิดงานต่อสัญญาผ่าน save_job_opening (ทางเดียวที่ตั้งช่องนี้ได้) ----------
SELECT lives_ok(format($$
  INSERT INTO _r SELECT 'new', contract_id, updated_at FROM public.save_job_opening(
    p_branch_id := (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1),
    p_customer_name := 'Central', p_customer_type := NULL, p_contract_no := 'L-R1',
    p_start_date := %L, p_end_date := %L, p_term_months := 12, p_value_total := 50000, p_sale_type := 'renew',
    p_customer_id := %L, p_renewed_from_contract_id := %L)
$$, pg_temp.m(-6), pg_temp.m(6) - 1, pg_temp.id('c1'), pg_temp.id('d1')),
  'admin opens a renewal job via save_job_opening');
SELECT is((SELECT c.renewed_from_contract_id FROM contracts c WHERE c.id = (SELECT contract_id FROM _r WHERE tag = 'new')),
  pg_temp.id('d1'), 'the renewal link is set on creation');
SELECT is(pg_temp.pending('d1'), '{}'::date[], 'M18: after renewal the old contract''s open missed months are void');

-- ---------- ทุกบทบาท แก้ช่องนี้ด้วย UPDATE ตรงๆ ไม่ได้ ----------
CREATE FUNCTION pg_temp.upd_new(p_value text) RETURNS text LANGUAGE sql AS $$
  SELECT format('UPDATE contracts SET renewed_from_contract_id = %s WHERE id = (SELECT contract_id FROM _r WHERE tag = ''new'')', p_value)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.upd_new(text) TO PUBLIC;
CREATE FUNCTION pg_temp.upd_d2(p_value text) RETURNS text LANGUAGE sql AS $$
  SELECT format('UPDATE contracts SET renewed_from_contract_id = %s WHERE id = %L', p_value, pg_temp.id('d2'))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.upd_d2(text) TO PUBLIC;

-- admin (login อยู่แล้ว)
SELECT throws_ok(pg_temp.upd_new(format('%L', pg_temp.id('d2'))), 'AG009', NULL, 'admin: pointing a renewal at another contract is refused (AG009)');
SELECT throws_ok(pg_temp.upd_new('NULL'), 'AG009', NULL, 'admin: clearing the link is refused (AG009)');
SELECT throws_ok(pg_temp.upd_d2(format('%L', pg_temp.id('d1'))), 'AG009', NULL, 'admin: linking an unlinked contract afterwards is refused (AG009)');
-- recorder
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
-- recorder เขียน contracts ไม่ได้อยู่แล้ว (RLS กรองจน 0 แถว ไม่ error) → ต้องไม่เปลี่ยนค่า (เช็กรวมที่ท้ายกลุ่ม)
SELECT lives_ok(pg_temp.upd_new(format('%L', pg_temp.id('d2'))), 'recorder: pointing a renewal at another contract changes nothing (RLS, 0 rows)');
SELECT lives_ok(pg_temp.upd_new('NULL'), 'recorder: clearing the link changes nothing (RLS, 0 rows)');
SELECT lives_ok(pg_temp.upd_d2(format('%L', pg_temp.id('d1'))), 'recorder: linking an unlinked contract changes nothing (RLS, 0 rows)');
-- host
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok(pg_temp.upd_new(format('%L', pg_temp.id('d2'))), 'AG009', NULL, 'host: pointing a renewal at another contract is refused (AG009)');
SELECT throws_ok(pg_temp.upd_new('NULL'), 'AG009', NULL, 'host: clearing the link is refused (AG009)');
SELECT throws_ok(pg_temp.upd_d2(format('%L', pg_temp.id('d1'))), 'AG009', NULL, 'host: linking an unlinked contract afterwards is refused (AG009)');

SELECT is((SELECT c.renewed_from_contract_id FROM contracts c WHERE c.id = (SELECT contract_id FROM _r WHERE tag = 'new')),
  pg_temp.id('d1'), 'the renewal link is unchanged after every refused attempt');
SELECT is(pg_temp.link('d2'), NULL::uuid, 'the unlinked contract stays unlinked');
SELECT is(pg_temp.pending('d1'), '{}'::date[], 'M18: d1 stays void (no one could unlink the renewal)');
SELECT ok(cardinality(pg_temp.pending('d2')) > 0, 'M18: d2 (not renewed) keeps its open missed months — no one could void it');

-- ---------- ข้อความ error (ให้ FE แสดง) ----------
SELECT throws_ok(pg_temp.upd_new('NULL'), 'AG009', 'renewed_from_contract_id cannot be changed after the contract is created',
  'error code AG009 carries a stable message');

-- ---------- แก้อย่างอื่นยังทำได้ ----------
SELECT lives_ok($$UPDATE contracts SET note = 'แก้หมายเหตุ' WHERE id = (SELECT contract_id FROM _r WHERE tag = 'new')$$,
  'host can still edit other fields of the renewal');
SELECT lives_ok(format('UPDATE contracts SET renewed_from_contract_id = %L WHERE id = (SELECT contract_id FROM _r WHERE tag = ''new'')', pg_temp.id('d1')),
  'writing the same value back is not a change (allowed)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT lives_ok($$UPDATE contracts SET note = 'admin แก้' WHERE id = pg_temp.id('d2')$$, 'admin can still edit other fields of an unlinked contract');
SELECT lives_ok($$UPDATE contracts SET value_total = 60000 WHERE id = (SELECT contract_id FROM _r WHERE tag = 'new')$$,
  'admin can still edit the value of the renewal');

-- ---------- save_job_opening โหมดแก้ไข ----------
CREATE FUNCTION pg_temp.edit_new(p_renewed text, p_note text) RETURNS text LANGUAGE sql AS $$
  SELECT format($f$
    SELECT * FROM public.save_job_opening(
      p_branch_id := (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1),
      p_customer_name := 'Central', p_customer_type := NULL, p_contract_no := 'L-R1',
      p_start_date := %L, p_end_date := %L, p_term_months := 12, p_value_total := 60000, p_sale_type := 'renew',
      p_contract_id := %L, p_customer_id := %L, p_renewed_from_contract_id := %s, p_note := %L,
      p_expected_updated_at := (SELECT updated_at FROM contracts WHERE id = %L))
  $f$, pg_temp.m(-6), pg_temp.m(6) - 1, (SELECT contract_id FROM _r WHERE tag = 'new'), pg_temp.id('c1'),
       p_renewed, p_note, (SELECT contract_id FROM _r WHERE tag = 'new'))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.edit_new(text, text) TO PUBLIC;
SELECT lives_ok(pg_temp.edit_new(format('%L', pg_temp.id('d1')), 'แก้ผ่านฟอร์ม'),
  'save_job_opening edit mode with the same link still works');
SELECT is((SELECT note FROM contracts WHERE id = (SELECT contract_id FROM _r WHERE tag = 'new')), 'แก้ผ่านฟอร์ม',
  'and the other fields were saved');
SELECT throws_ok(pg_temp.edit_new(format('%L', pg_temp.id('d2')), 'x'), 'AG009', NULL,
  'save_job_opening edit mode cannot change the link (AG009)');
SELECT throws_ok(pg_temp.edit_new('NULL', 'x'), 'AG009', NULL,
  'save_job_opening edit mode cannot clear the link (AG009)');
SELECT is((SELECT note FROM contracts WHERE id = (SELECT contract_id FROM _r WHERE tag = 'new')), 'แก้ผ่านฟอร์ม',
  'a refused edit saved nothing');

-- ---------- M18 ข้อ 2: สัญญาใหม่ถูกยกเลิก → เรื่องค้างของ d1 กลับมา (ยังเป็นไปตามเดิม) ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$UPDATE contracts SET status = 'cancelled' WHERE id = (SELECT contract_id FROM _r WHERE tag = 'new')$$,
  'host cancels the renewal contract');
SELECT ok(cardinality(pg_temp.pending('d1')) > 0, 'M18: cancelling the renewal brings the old contract''s open months back');

-- ---------- ลบสัญญาเก่า: FK ON DELETE SET NULL ยังทำงาน (ไม่ถูกด่านนี้ขวาง) ----------
RESET ROLE;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at, renewed_from_contract_id)
VALUES (pg_temp.id('d4'), pg_temp.id('c1'), 'L-4', pg_temp.m(-6), 12, 50000, pg_temp.m(-6), pg_temp.id('d3'));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$DELETE FROM contracts WHERE id = pg_temp.id('d3')$$, 'host deletes an old contract that has a renewal linked');
SELECT is(pg_temp.link('d4'), NULL::uuid, 'the renewal''s link was cleared by the FK (ON DELETE SET NULL), not blocked by the guard');

SELECT * FROM finish();
ROLLBACK;
