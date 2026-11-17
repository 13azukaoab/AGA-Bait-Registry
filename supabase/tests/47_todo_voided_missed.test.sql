-- M35 ① (20261115220000): ตกบริการที่โมฆะเพราะต่อสัญญา / มีสัญญาใหม่ (DECISIONS 2.47 + 2.51) สำหรับ /todo
--   * contract_renewed_by = กฎเดียวกับ contract_is_renewed (ผลตรงกันทุกสัญญา) · เลือก Renew ที่ผูกมาก่อน
--   * list_voided_missed_services: เกณฑ์เดือนตกเดียวกับ list_pending_missed_services · ตัดที่เดือนที่ถูกแทน
--   * สิทธิ์: host / admin ทุกสาขา · recorder ในขอบเขต · viewer / anon ปฏิเสธ (PDPA)
-- วันที่อ้างจากเดือนปัจจุบัน (Asia/Bangkok) ผ่าน pg_temp.m(n) → เทสไม่พังเมื่อเวลาผ่านไป · ข้อมูลสมมติทั้งหมด
--   o1 (ส่วนกลาง) เริ่ม m(-8) 12 เดือน · m(-7) routine · m(-6) ไม่ชดเชย · m(-5) มีหมายเหตุ
--      Renew r1 (ผูกมา) เริ่ม m(-2) (ซ้อนช่วง) → โมฆะ m(-8), m(-5), m(-4), m(-3), m(-2), m(-1) · reason renewed
--      (เจ้าของเลือกแบบ ข: เดือนช่วงซ้อนนับเป็นโมฆะด้วย ไม่ตัดที่เดือนเริ่มสัญญาใหม่)
--      + New x1 ลูกค้าเดียวกัน เริ่มหลังจบ o1 → ต้องเลือก r1 (ผูกมาชนะ)
--   o2 (ส่วนกลาง ลูกค้าอื่น) เริ่ม m(-14) 12 เดือน (เดือนสุดท้าย m(-3)) · ตั้งสถานี m(-4)
--      New n2 เริ่ม m(-1) (หลังจบ) → โมฆะ m(-4), m(-3) · reason new_contract
--   o3 (ต่างจังหวัด) เริ่ม m(-8) · Renew r3 เริ่ม m(-6) (ซ้อน) → โมฆะ m(-8)..m(-1)
--   o4 ไม่มีสัญญาใหม่ → ไม่อยู่ในรายการโมฆะ (อยู่ในรอตัดสิน) · o5 สัญญาใหม่ถูกยกเลิก → ไม่โมฆะ
BEGIN;
SELECT plan(37);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recprov@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',          'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',         'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder',      'user_a3', 'recorder', '{central}'),
  ('00000000-0000-0000-0000-0000000000a4', 'viewer',        'user_a4', 'viewer',   '{central}'),
  ('00000000-0000-0000-0000-0000000000a5', 'recorder prov', 'user_a5', 'recorder', '{province}');

CREATE FUNCTION pg_temp.m(n int) RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok')) + make_interval(months => n))::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.m(int) TO PUBLIC;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;
CREATE FUNCTION pg_temp.as_user(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || p, true) $$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO PUBLIC;
-- เดือนที่โมฆะของสัญญา (เรียงเดือน) จากมุมมองผู้เรียกปัจจุบัน
CREATE FUNCTION pg_temp.voided(p_contract text, p_month date DEFAULT NULL) RETURNS date[] LANGUAGE sql AS
  $$ SELECT coalesce(array_agg(missed_month ORDER BY missed_month), '{}')
       FROM public.list_voided_missed_services(NULL, p_month) WHERE contract_id = pg_temp.id(p_contract) $$;
GRANT EXECUTE ON FUNCTION pg_temp.voided(text, date) TO PUBLIC;
CREATE FUNCTION pg_temp.pending(p_contract text) RETURNS date[] LANGUAGE sql AS
  $$ SELECT coalesce(array_agg(missed_month ORDER BY missed_month), '{}')
       FROM public.list_pending_missed_services(NULL, NULL) WHERE contract_id = pg_temp.id(p_contract) $$;
GRANT EXECUTE ON FUNCTION pg_temp.pending(text) TO PUBLIC;
CREATE FUNCTION pg_temp.seen() RETURNS uuid[] LANGUAGE sql AS
  $$ SELECT coalesce(array_agg(DISTINCT contract_id ORDER BY contract_id), '{}')
       FROM public.list_voided_missed_services() $$;
GRANT EXECUTE ON FUNCTION pg_temp.seen() TO PUBLIC;

CREATE TEMP TABLE _b AS
SELECT (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1)  AS x,
       (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1) AS p;
GRANT SELECT ON _b TO PUBLIC;

INSERT INTO customers (id, branch_id, name) VALUES
  (pg_temp.id('c1'), (SELECT x FROM _b), 'Test Central 1'),
  (pg_temp.id('c2'), (SELECT x FROM _b), 'Test Central 2'),
  (pg_temp.id('c3'), (SELECT p FROM _b), 'Test Province'),
  (pg_temp.id('c4'), (SELECT x FROM _b), 'Test Central 4'),
  (pg_temp.id('c5'), (SELECT x FROM _b), 'Test Central 5');

-- สัญญาเก่า (ตั้งสถานีแล้ว)
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at) VALUES
  (pg_temp.id('01'), pg_temp.id('c1'), 'TST-O1', pg_temp.m(-8),  12, 24000, pg_temp.m(-8)),
  (pg_temp.id('02'), pg_temp.id('c2'), 'TST-O2', pg_temp.m(-14), 12, 24000, pg_temp.m(-4)),
  (pg_temp.id('03'), pg_temp.id('c3'), 'TST-O3', pg_temp.m(-8),  12, 24000, pg_temp.m(-8)),
  (pg_temp.id('04'), pg_temp.id('c4'), 'TST-O4', pg_temp.m(-4),  12, 24000, pg_temp.m(-4)),
  (pg_temp.id('05'), pg_temp.id('c5'), 'TST-O5', pg_temp.m(-4),  12, 24000, pg_temp.m(-4));
-- สัญญาที่แทน
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, renewed_from_contract_id) VALUES
  (pg_temp.id('a1'), pg_temp.id('c1'), 'TST-R1', pg_temp.m(-2), 12, 24000, pg_temp.id('01')),
  (pg_temp.id('a3'), pg_temp.id('c3'), 'TST-R3', pg_temp.m(-6), 12, 24000, pg_temp.id('03')),
  (pg_temp.id('a5'), pg_temp.id('c5'), 'TST-R5', pg_temp.m(-1), 12, 24000, pg_temp.id('05'));
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total) VALUES
  (pg_temp.id('b1'), pg_temp.id('c1'), 'TST-X1', pg_temp.m(5),  12, 24000),   -- New หลังจบ o1 (o1 ยังเลือก r1)
  (pg_temp.id('b2'), pg_temp.id('c2'), 'TST-N2', pg_temp.m(-1), 12, 24000);   -- New หลังจบ o2
UPDATE contracts SET status = 'cancelled', cancelled_at = now() WHERE id = pg_temp.id('a5');

-- o1: m(-7) routine · m(-6) ไม่ชดเชย · m(-5) หมายเหตุ
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time) VALUES
  (pg_temp.id('e1'), pg_temp.id('01'), pg_temp.m(-7) + 9, 'routine', '09:00', '10:00');
INSERT INTO missed_service_resolutions (contract_id, missed_month, kind, reason) VALUES
  (pg_temp.id('01'), pg_temp.m(-6), 'waived', 'test');
INSERT INTO missed_service_notes (contract_id, missed_month, note) VALUES
  (pg_temp.id('01'), pg_temp.m(-5), 'test note');

-- =====================================================================
-- โครงสร้าง + สิทธิ์
-- =====================================================================
SELECT has_function('public', 'contract_renewed_by', ARRAY['uuid'], 'contract_renewed_by exists');
SELECT has_function('public', 'list_voided_missed_services', ARRAY['uuid', 'date'], 'list_voided_missed_services exists');
SELECT ok(NOT has_function_privilege('anon', 'public.list_voided_missed_services(uuid, date)', 'EXECUTE'),
  'anon has no EXECUTE on list_voided_missed_services');
SELECT ok(NOT has_function_privilege('anon', 'public.contract_renewed_by(uuid)', 'EXECUTE'),
  'anon has no EXECUTE on contract_renewed_by');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.list_voided_missed_services(uuid, date)'::regprocedure),
  false, 'list_voided_missed_services is SECURITY INVOKER (reads through RLS)');

-- =====================================================================
-- กฎ "ถูกแทน" — นิยามเดียว
-- =====================================================================
SELECT is(public.contract_renewed_by(pg_temp.id('01')), pg_temp.id('a1'), 'o1 superseded by the linked Renew (beats a later New)');
SELECT is(public.contract_renewed_by(pg_temp.id('02')), pg_temp.id('b2'), 'o2 superseded by a New starting after it ended');
SELECT is(public.contract_renewed_by(pg_temp.id('04')), NULL::uuid, 'o4 not superseded');
SELECT is(public.contract_renewed_by(pg_temp.id('05')), NULL::uuid, 'o5: cancelled Renew does not supersede');
SELECT is((SELECT count(*)::int FROM contracts c
            WHERE public.contract_is_renewed(c.id) IS DISTINCT FROM (public.contract_renewed_by(c.id) IS NOT NULL)),
  0, 'contract_is_renewed == (contract_renewed_by IS NOT NULL) for every contract');
SELECT ok(public.contract_is_renewed(pg_temp.id('01')) AND public.contract_is_renewed(pg_temp.id('02'))
          AND public.contract_is_renewed(pg_temp.id('03')) AND NOT public.contract_is_renewed(pg_temp.id('04'))
          AND NOT public.contract_is_renewed(pg_temp.id('05')),
  'contract_is_renewed keeps its old results');

-- =====================================================================
-- host
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is(pg_temp.voided('01'), ARRAY[pg_temp.m(-8), pg_temp.m(-5), pg_temp.m(-4), pg_temp.m(-3), pg_temp.m(-2), pg_temp.m(-1)],
  'o1 voided months: skip routine / waived · overlap months after the Renew start are voided too (ข)');
SELECT ok(ARRAY[pg_temp.m(-2), pg_temp.m(-1)] <@ pg_temp.voided('01') AND pg_temp.pending('01') = '{}'::date[],
  'overlap months: in the voided list, not pending — never missing from both lists');
SELECT is((SELECT array_agg(DISTINCT void_reason) FROM public.list_voided_missed_services() WHERE contract_id = pg_temp.id('01')),
  ARRAY['renewed'], 'o1 reason = renewed');
SELECT is((SELECT array_agg(DISTINCT voided_by_contract_id) FROM public.list_voided_missed_services() WHERE contract_id = pg_temp.id('01')),
  ARRAY[pg_temp.id('a1')], 'o1 voided by r1');
SELECT is((SELECT voided_by_start_date FROM public.list_voided_missed_services() WHERE contract_id = pg_temp.id('01') LIMIT 1),
  pg_temp.m(-2), 'voided_by_start_date = start of the superseding contract');
SELECT ok((SELECT bool_and(voided_at IS NOT NULL) FROM public.list_voided_missed_services()), 'voided_at is filled');
SELECT is((SELECT note FROM public.list_voided_missed_services() WHERE contract_id = pg_temp.id('01') AND missed_month = pg_temp.m(-5)),
  'test note', 'note of the month is returned');
SELECT is((SELECT note FROM public.list_voided_missed_services() WHERE contract_id = pg_temp.id('01') AND missed_month = pg_temp.m(-8)),
  NULL, 'month without note → NULL');
SELECT is(pg_temp.voided('02'), ARRAY[pg_temp.m(-4), pg_temp.m(-3)],
  'o2 voided from tracking start (station setup) to its last service month');
SELECT is((SELECT array_agg(DISTINCT void_reason) FROM public.list_voided_missed_services() WHERE contract_id = pg_temp.id('02')),
  ARRAY['new_contract'], 'o2 reason = new_contract');
SELECT is(pg_temp.voided('03'), ARRAY[pg_temp.m(-8), pg_temp.m(-7), pg_temp.m(-6), pg_temp.m(-5), pg_temp.m(-4),
                                 pg_temp.m(-3), pg_temp.m(-2), pg_temp.m(-1)],
  'o3 (province) voided months: overlapping Renew from m(-6) → every missed month up to last month (ข)');
SELECT is(pg_temp.voided('04'), '{}'::date[], 'o4 (not superseded) not listed');
SELECT ok(cardinality(pg_temp.pending('04')) > 0, 'o4 still pending');
SELECT is(pg_temp.voided('05'), '{}'::date[], 'o5 (cancelled Renew) not listed');
SELECT is(pg_temp.voided('01', pg_temp.m(-4)), ARRAY[pg_temp.m(-8), pg_temp.m(-5)], 'p_month caps the months (before m(-4))');
SELECT is((SELECT count(*)::int FROM public.list_voided_missed_services((SELECT p FROM _b), NULL)),
  8, 'p_branch_id filters to the province branch (o3 only)');
SELECT is((SELECT count(*)::int FROM public.list_voided_missed_services() v
            JOIN public.list_pending_missed_services() p USING (contract_id, missed_month)),
  0, 'no month is both pending and voided');

-- =====================================================================
-- admin (ทุกสาขา — อ่านอย่างเดียว) · recorder ในขอบเขต
-- =====================================================================
SELECT pg_temp.as_user('a2');
SELECT is(pg_temp.seen(), ARRAY[pg_temp.id('01'), pg_temp.id('02'), pg_temp.id('03')], 'admin sees all branches');
SELECT pg_temp.as_user('a3');
SELECT is(pg_temp.seen(), ARRAY[pg_temp.id('01'), pg_temp.id('02')], 'central recorder sees central only');
SELECT pg_temp.as_user('a5');
SELECT is(pg_temp.seen(), ARRAY[pg_temp.id('03')], 'province recorder sees province only');

-- =====================================================================
-- viewer / anon (PDPA)
-- =====================================================================
SELECT pg_temp.as_user('a4');
SELECT throws_ok($$SELECT * FROM public.list_voided_missed_services()$$, '42501', NULL, 'viewer is refused');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.list_voided_missed_services()$$, '42501', NULL, 'anon is refused');
SELECT throws_ok($$SELECT public.contract_renewed_by('00000000-0000-0000-0000-000000000001')$$, '42501', NULL,
  'anon cannot call contract_renewed_by');
RESET ROLE;

-- =====================================================================
-- ยกเลิกสัญญาที่แทน → เดือนกลับเป็นรอตัดสิน (2.48) · ไม่อยู่ทั้งสองรายการพร้อมกัน
-- =====================================================================
UPDATE contracts SET status = 'cancelled', cancelled_at = now() WHERE id = pg_temp.id('a3');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is(pg_temp.voided('03'), '{}'::date[], 'Renew cancelled → o3 no longer voided');
SELECT ok(ARRAY[pg_temp.m(-8), pg_temp.m(-7)] <@ pg_temp.pending('03'), 'Renew cancelled → the same months are pending again');
RESET ROLE;

-- เวลาบันทึกสัญญาที่แทน (created_at) ไม่ใช้ตัดเดือน — ตัดที่เดือนเริ่มเท่านั้น
UPDATE contracts SET created_at = (pg_temp.m(-3) + 5)::timestamptz WHERE id = pg_temp.id('b2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is(pg_temp.voided('02'), ARRAY[pg_temp.m(-4), pg_temp.m(-3)], 'created_at of the superseding contract does not cut months');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
