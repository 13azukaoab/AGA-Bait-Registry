-- PERF (20261115370000): list_pending_missed_services แบบ set-based — ผลต้องเท่าเนื้อเดิมทุกแถว ทุกลำดับ
--   * pg_temp.old_list = สำเนาเนื้อเดิม (20261115300001_contract_pause.sql ข้อ 6a · เรียก helper ทีละแถว) ทุกบรรทัด
--   * เทียบ old vs new ด้วย results_eq (ลำดับต้องตรงด้วย · WITH ORDINALITY) ต่อ role × สาขา × เดือน (15 ชุดพารามิเตอร์)
--   * กันเทียบแบบว่างทั้งคู่: ตรวจค่าตายตัวของกรณีสำคัญด้วย (เดือนพัก · ต่อสัญญา · ยกเลิก · ปิด · ชดเชย · ขอบเขต)
--   * viewer / ไม่มีโปรไฟล์ / บัญชีถูกปิด / postgres ไม่มี JWT → 42501 ทั้งเนื้อเดิมและเนื้อใหม่
-- วันที่อ้างจากเดือนปัจจุบัน (Asia/Bangkok) ผ่าน pg_temp.m(n) · ข้อมูลสมมติทั้งหมด (ไม่ใช่ข้อมูลลูกค้าจริง)
--
-- fixture (ส่วนกลาง x ยกเว้นระบุ):
--   d1 เริ่ม m(-10) · m(-9) routine (ไม่ตก) · m(-8) มีแค่รอบแก้ปัญหา (ยังตก) · m(-7) ชดเชยด้วยการเข้า m(-1)
--      · m(-6) ไม่ชดเชย (waived) · m(-1) มีแค่การเข้าชดเชย (ไม่นับเป็น routine → ยังตก)
--   d2 พักปิดแล้ว [m(-7)+10 → m(-5)+4] = พัก m(-7), m(-6) · m(-5) กลับมาต่อ = ตก · พักเปิด m(-2)+3 = พัก m(-2), m(-1)
--   d3 พัก-กลับในเดือนเดียวกัน m(-4) → ไม่มีเดือนพัก
--   0a พักผ่าน pause_contract (status = paused) ตั้งแต่ m(-2)
--   d4 → Renew d5 ผูกมา = ถูกแทน · d6 → Renew d7 ผูกมาแต่ถูกยกเลิก = ไม่ถูกแทน
--   d8 จบ m(-3) → New d9 เริ่ม m(-1) = ถูกแทน · da → New db เริ่มก่อน da จบ = ไม่ถูกแทน
--   dc end_date ตั้งเอง m(-9)+10 (สั้นกว่าค่าเริ่มต้น) → New dd เริ่ม m(-7) = ถูกแทน
--   de วันจบ m(-2)-1 → New df เริ่มวันเดียวกันพอดี = ไม่ถูกแทน (ต้องเริ่ม "หลัง" วันจบ)
--   e1 ต่างจังหวัด · e2 ต่างจังหวัด status closed (ยังนับ)
--   f1 ยกเลิก (ไม่นับ) · f2 expired_pending_collection (ยังนับ) · f3 ยังไม่ตั้งสถานี (ไม่นับ)
--   f4 36 เดือน ตั้งสถานีช้ากว่าวันเริ่ม (นับจากเดือนตั้งสถานี) · f5 Custom 5 เดือน (จบแล้ว)
BEGIN;
SELECT plan(39);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recprov@test.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'noprofile@test.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'disabled@test.local');
-- a6 ไม่มีแถวใน profiles · a7 มีโปรไฟล์แต่ถูกปิด → current_app_role() = NULL ทั้งคู่
INSERT INTO profiles (user_id, display_name, username, role, division_scope, is_active) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',          'user_a1', 'host',     '{central,province}', true),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',         'user_a2', 'admin',    '{central}',          true),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder',      'user_a3', 'recorder', '{central}',          true),
  ('00000000-0000-0000-0000-0000000000a4', 'recorder prov', 'user_a4', 'recorder', '{province}',         true),
  ('00000000-0000-0000-0000-0000000000a5', 'viewer',        'user_a5', 'viewer',   '{central}',          true),
  ('00000000-0000-0000-0000-0000000000a7', 'disabled',      'user_a7', 'recorder', '{central}',          false);

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;
CREATE FUNCTION pg_temp.m(n int) RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok')) + make_interval(months => n))::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.m(int) TO PUBLIC;
CREATE FUNCTION pg_temp.as_user(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || p, true) $$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO PUBLIC;
CREATE FUNCTION pg_temp.no_user() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', '', true) $$;
GRANT EXECUTE ON FUNCTION pg_temp.no_user() TO PUBLIC;

-- =====================================================================
-- สำเนาเนื้อเดิม (20261115300001_contract_pause.sql ข้อ 6a) — ห้ามแก้ ใช้เป็นตัวเทียบ
-- =====================================================================
CREATE FUNCTION pg_temp.old_list(p_branch_id uuid DEFAULT NULL, p_month date DEFAULT NULL)
RETURNS TABLE (
  contract_id           uuid,
  customer_id           uuid,
  branch_id             uuid,
  missed_month          date,
  last_service_month    date,
  makeup_deadline_month date,
  past_deadline         boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role      text := current_app_role();
  v_now_month date := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
  v_upto      date;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'not allowed to read missed services' USING ERRCODE = '42501';
  END IF;
  v_upto := least(coalesce(date_trunc('month', p_month)::date, v_now_month), v_now_month);

  RETURN QUERY
  WITH c AS (
    SELECT ct.id AS contract_id, cu.id AS customer_id, cu.branch_id,
           missed_tracking_start_month(ct.start_date, ct.stations_initialized_at) AS track_from,
           (date_trunc('month', ct.start_date) + make_interval(months => ct.term_months - 1))::date AS last_month
      FROM contracts ct
      JOIN customers cu ON cu.id = ct.customer_id
     WHERE ct.status <> 'cancelled' AND ct.cancelled_at IS NULL
       AND NOT contract_is_renewed(ct.id)
       AND ct.stations_initialized_at IS NOT NULL
       AND (p_branch_id IS NULL OR cu.branch_id = p_branch_id)
       AND (v_role <> 'recorder' OR contract_in_scope(ct.id))
  ), m AS (
    SELECT c.*, gs::date AS missed_month
      FROM c,
           generate_series(c.track_from, least(c.last_month, (v_upto - interval '1 month')::date),
                           interval '1 month') gs
  )
  SELECT m.contract_id, m.customer_id, m.branch_id, m.missed_month, m.last_month,
         (m.last_month + make_interval(months => missed_makeup_deadline_months()))::date,
         v_now_month > (m.last_month + make_interval(months => missed_makeup_deadline_months()))::date
    FROM m
   WHERE NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = m.contract_id AND vi.visit_type = 'routine'
                        AND vi.makeup_for_month IS NULL
                        AND vi.visit_date >= m.missed_month
                        AND vi.visit_date < (m.missed_month + interval '1 month')::date)
     AND NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = m.contract_id AND vi.makeup_for_month = m.missed_month)
     AND NOT EXISTS (SELECT 1 FROM missed_service_resolutions r
                      WHERE r.contract_id = m.contract_id AND r.missed_month = m.missed_month
                        AND r.kind = 'waived')
     AND NOT contract_month_paused(m.contract_id, m.missed_month)
   ORDER BY m.branch_id, m.customer_id, m.contract_id, m.missed_month;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.old_list(uuid, date) TO PUBLIC;

-- เดือนตกของสัญญา (เนื้อใหม่ · มุมมองผู้เรียกปัจจุบัน · ทุกสาขา · เดือนปัจจุบัน)
CREATE FUNCTION pg_temp.months(p_c text) RETURNS date[] LANGUAGE sql AS
  $$ SELECT coalesce(array_agg(missed_month ORDER BY missed_month), '{}')
       FROM public.list_pending_missed_services() WHERE contract_id = pg_temp.id(p_c) $$;
GRANT EXECUTE ON FUNCTION pg_temp.months(text) TO PUBLIC;

CREATE TEMP TABLE _b AS
SELECT (SELECT id FROM branches WHERE division = 'central'  ORDER BY name LIMIT 1) AS x,
       (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1) AS p;
GRANT SELECT ON _b TO PUBLIC;

-- ชุดพารามิเตอร์: สาขา (ทุกสาขา / ส่วนกลาง / ต่างจังหวัด) × เดือน (ปัจจุบัน / NULL / ย้อนหลัง 2 แบบ / อนาคต → ตัดที่ปัจจุบัน)
CREATE TEMP TABLE _p AS
SELECT row_number() OVER (ORDER BY bo, mo_ord) AS ord, b, mo
  FROM (VALUES (1, NULL::uuid), (2, (SELECT x FROM _b)), (3, (SELECT p FROM _b))) bb(bo, b)
 CROSS JOIN (VALUES (1, NULL::date), (2, pg_temp.m(0)), (3, pg_temp.m(-4)), (4, pg_temp.m(-12) + 14), (5, pg_temp.m(3)))
       mm(mo_ord, mo);
GRANT SELECT ON _p TO PUBLIC;

-- ผลทุกชุดพารามิเตอร์ ต่อกันตามลำดับ (ลำดับแถวในแต่ละชุด = ลำดับที่ฟังก์ชันคืน)
CREATE FUNCTION pg_temp.q(p_fn text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format(
    'SELECT p.ord, r.ord AS rn, r.contract_id, r.customer_id, r.branch_id, r.missed_month,
            r.last_service_month, r.makeup_deadline_month, r.past_deadline
       FROM pg_temp._p p
      CROSS JOIN LATERAL %s(p.b, p.mo) WITH ORDINALITY
            AS r(contract_id, customer_id, branch_id, missed_month, last_service_month,
                 makeup_deadline_month, past_deadline, ord)
      ORDER BY p.ord, r.ord', p_fn)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.q(text) TO PUBLIC;

-- =====================================================================
-- fixture
-- =====================================================================
INSERT INTO customers (id, branch_id, name) VALUES
  (pg_temp.id('c1'), (SELECT x FROM _b), 'SB visits (สมมติ)'),
  (pg_temp.id('c2'), (SELECT x FROM _b), 'SB pause (สมมติ)'),
  (pg_temp.id('c3'), (SELECT x FROM _b), 'SB pause same month (สมมติ)'),
  (pg_temp.id('c0'), (SELECT x FROM _b), 'SB pause rpc (สมมติ)'),
  (pg_temp.id('c4'), (SELECT x FROM _b), 'SB renew linked (สมมติ)'),
  (pg_temp.id('c5'), (SELECT x FROM _b), 'SB renew cancelled (สมมติ)'),
  (pg_temp.id('c6'), (SELECT x FROM _b), 'SB new after end (สมมติ)'),
  (pg_temp.id('c7'), (SELECT x FROM _b), 'SB new overlap (สมมติ)'),
  (pg_temp.id('c8'), (SELECT x FROM _b), 'SB explicit end (สมมติ)'),
  (pg_temp.id('c9'), (SELECT x FROM _b), 'SB new on end day (สมมติ)'),
  (pg_temp.id('ca'), (SELECT p FROM _b), 'SB province (สมมติ)'),
  (pg_temp.id('cb'), (SELECT p FROM _b), 'SB province closed (สมมติ)'),
  (pg_temp.id('cc'), (SELECT x FROM _b), 'SB cancelled (สมมติ)'),
  (pg_temp.id('cd'), (SELECT x FROM _b), 'SB expired (สมมติ)'),
  (pg_temp.id('ce'), (SELECT x FROM _b), 'SB no stations (สมมติ)'),
  (pg_temp.id('cf'), (SELECT x FROM _b), 'SB 36 months late setup (สมมติ)'),
  (pg_temp.id('b0'), (SELECT x FROM _b), 'SB custom 5 months (สมมติ)');

INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at) VALUES
  (pg_temp.id('d1'), pg_temp.id('c1'), 'SB-D1', pg_temp.m(-10), 12, 24000, pg_temp.m(-10) + 2),
  (pg_temp.id('d2'), pg_temp.id('c2'), 'SB-D2', pg_temp.m(-10), 12, 24000, pg_temp.m(-10) + 2),
  (pg_temp.id('d3'), pg_temp.id('c3'), 'SB-D3', pg_temp.m(-6),  12, 24000, pg_temp.m(-6) + 2),
  (pg_temp.id('0a'), pg_temp.id('c0'), 'SB-0A', pg_temp.m(-6),  12, 24000, pg_temp.m(-6) + 2),
  (pg_temp.id('d4'), pg_temp.id('c4'), 'SB-D4', pg_temp.m(-13), 12, 24000, pg_temp.m(-13) + 2),
  (pg_temp.id('d6'), pg_temp.id('c5'), 'SB-D6', pg_temp.m(-8),  12, 24000, pg_temp.m(-8) + 2),
  (pg_temp.id('d8'), pg_temp.id('c6'), 'SB-D8', pg_temp.m(-14), 12, 24000, pg_temp.m(-14) + 2),
  (pg_temp.id('da'), pg_temp.id('c7'), 'SB-DA', pg_temp.m(-6),  12, 24000, pg_temp.m(-6) + 2),
  (pg_temp.id('de'), pg_temp.id('c9'), 'SB-DE', pg_temp.m(-14), 12, 24000, pg_temp.m(-14) + 2),
  (pg_temp.id('e1'), pg_temp.id('ca'), 'SB-E1', pg_temp.m(-5),  12, 24000, pg_temp.m(-5) + 2),
  (pg_temp.id('e2'), pg_temp.id('cb'), 'SB-E2', pg_temp.m(-9),  12, 24000, pg_temp.m(-9) + 2),
  (pg_temp.id('f1'), pg_temp.id('cc'), 'SB-F1', pg_temp.m(-6),  12, 24000, pg_temp.m(-6) + 2),
  (pg_temp.id('f2'), pg_temp.id('cd'), 'SB-F2', pg_temp.m(-15), 12, 24000, pg_temp.m(-15) + 2),
  (pg_temp.id('f3'), pg_temp.id('ce'), 'SB-F3', pg_temp.m(-6),  12, 24000, NULL),
  (pg_temp.id('f4'), pg_temp.id('cf'), 'SB-F4', pg_temp.m(-40), 36, 72000, pg_temp.m(-30) + 5),
  (pg_temp.id('f5'), pg_temp.id('b0'), 'SB-F5', pg_temp.m(-8),  5,  10000, pg_temp.m(-8) + 2);
-- dc: วันจบตั้งเอง (สั้นกว่าค่าเริ่มต้น)
INSERT INTO contracts (id, customer_id, contract_no, start_date, end_date, term_months, value_total, stations_initialized_at) VALUES
  (pg_temp.id('dc'), pg_temp.id('c8'), 'SB-DC', pg_temp.m(-12), pg_temp.m(-9) + 10, 12, 24000, pg_temp.m(-12) + 2);
-- สัญญาที่มาแทน (Renew ผูก)
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at, renewed_from_contract_id) VALUES
  (pg_temp.id('d5'), pg_temp.id('c4'), 'SB-D5', pg_temp.m(-1), 12, 24000, pg_temp.m(-1) + 2, pg_temp.id('d4')),
  (pg_temp.id('d7'), pg_temp.id('c5'), 'SB-D7', pg_temp.m(-3), 12, 24000, NULL,              pg_temp.id('d6'));
-- สัญญาที่มาแทน (New ไม่ผูก)
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at) VALUES
  (pg_temp.id('d9'), pg_temp.id('c6'), 'SB-D9', pg_temp.m(-1),     12, 24000, NULL),
  (pg_temp.id('db'), pg_temp.id('c7'), 'SB-DB', pg_temp.m(-3),     12, 24000, pg_temp.m(-3) + 2),
  (pg_temp.id('dd'), pg_temp.id('c8'), 'SB-DD', pg_temp.m(-7),     12, 24000, NULL),
  (pg_temp.id('df'), pg_temp.id('c9'), 'SB-DF', pg_temp.m(-2) - 1, 12, 24000, NULL);
UPDATE contracts SET status = 'cancelled', cancelled_at = now() WHERE id IN (pg_temp.id('d7'), pg_temp.id('f1'));
UPDATE contracts SET status = 'closed', closed_at = now() WHERE id = pg_temp.id('e2');
UPDATE contracts SET status = 'expired_pending_collection' WHERE id = pg_temp.id('f2');

-- d1: routine m(-9) · รอบแก้ปัญหา m(-8) · ไม่ชดเชย m(-6) · ชดเชย m(-7) ด้วยการเข้าเดือน m(-1)
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time) VALUES
  (pg_temp.id('e5'), pg_temp.id('d1'), pg_temp.m(-9) + 5, 'routine', '09:00', '10:00'),
  (pg_temp.id('e6'), pg_temp.id('d1'), pg_temp.m(-8) + 5, 'problem', '09:00', '10:00'),
  (pg_temp.id('e7'), pg_temp.id('e1'), pg_temp.m(-3) + 5, 'routine', '09:00', '10:00');
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time, makeup_for_month) VALUES
  (pg_temp.id('e8'), pg_temp.id('d1'), pg_temp.m(-1) + 2, 'routine', '09:00', '10:00', pg_temp.m(-7));
INSERT INTO missed_service_resolutions (contract_id, missed_month, kind, reason) VALUES
  (pg_temp.id('d1'), pg_temp.m(-6), 'waived', 'ลูกค้าปิดอาคาร (สมมติ)');

-- ช่วงพัก (ใส่หลังการเข้า — visits_pause_guard กัน routine ในเดือนพัก)
INSERT INTO contract_pauses (contract_id, paused_from, resumed_at, end_kind, reason) VALUES
  (pg_temp.id('d2'), pg_temp.m(-7) + 10, pg_temp.m(-5) + 4,  'resumed', 'ค้างชำระ (สมมติ)'),
  (pg_temp.id('d3'), pg_temp.m(-4),      pg_temp.m(-4) + 15, 'resumed', 'ค้างชำระ (สมมติ)');
INSERT INTO contract_pauses (contract_id, paused_from, reason) VALUES
  (pg_temp.id('d2'), pg_temp.m(-2) + 3, 'ค้างชำระ (สมมติ)');

-- 0a: พักผ่าน RPC จริง (status = paused)
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT lives_ok(format('SELECT public.pause_contract(%L, %L, %L)', pg_temp.id('0a'), pg_temp.m(-2) + 9, 'ค้างชำระ (สมมติ)'),
  'test setup: host pauses 0a from month -2 via pause_contract');
RESET ROLE;
SELECT pg_temp.no_user();

-- =====================================================================
-- โครงสร้าง: เหมือนเนื้อเดิม (INVOKER · plpgsql · STABLE · search_path · สิทธิ์ · signature/คอลัมน์)
-- =====================================================================
SELECT ok((SELECT NOT prosecdef AND provolatile = 's'
                  AND prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
             FROM pg_proc WHERE oid = 'public.list_pending_missed_services(uuid, date)'::regprocedure),
  'list_pending_missed_services stays plpgsql STABLE SECURITY INVOKER');
SELECT ok((SELECT 'search_path=public, pg_temp' = ANY (proconfig)
             FROM pg_proc WHERE oid = 'public.list_pending_missed_services(uuid, date)'::regprocedure),
  'search_path = public, pg_temp');
SELECT ok(NOT has_function_privilege('anon', 'public.list_pending_missed_services(uuid, date)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.list_pending_missed_services(uuid, date)', 'EXECUTE'),
  'grants unchanged: anon no · authenticated yes');
SELECT is(pg_get_function_result('public.list_pending_missed_services(uuid, date)'::regprocedure),
          pg_get_function_result('pg_temp.old_list(uuid, date)'::regprocedure),
  'return columns unchanged');
SELECT is(pg_get_function_arguments('public.list_pending_missed_services(uuid, date)'::regprocedure),
          pg_get_function_arguments('pg_temp.old_list(uuid, date)'::regprocedure),
  'arguments and defaults unchanged');
SELECT ok((SELECT prosrc !~ 'contract_is_renewed|contract_month_paused|contract_in_scope'
             FROM pg_proc WHERE oid = 'public.list_pending_missed_services(uuid, date)'::regprocedure),
  'new body no longer calls the per-row helpers');

-- =====================================================================
-- old vs new: ทุกแถว ทุกลำดับ ต่อ role
-- =====================================================================
SET LOCAL ROLE authenticated;

SELECT pg_temp.as_user('a1');
SELECT cmp_ok((SELECT count(*)::int FROM pg_temp.old_list()), '>', 20, 'host: fixture yields rows (not a vacuous comparison)');
SELECT results_eq(pg_temp.q('public.list_pending_missed_services'), pg_temp.q('pg_temp.old_list'),
  'host: new == old for every branch × month (rows and order)');

SELECT pg_temp.as_user('a2');
SELECT cmp_ok((SELECT count(*)::int FROM pg_temp.old_list()), '>', 20, 'admin: fixture yields rows');
SELECT results_eq(pg_temp.q('public.list_pending_missed_services'), pg_temp.q('pg_temp.old_list'),
  'admin: new == old for every branch × month (rows and order)');

SELECT pg_temp.as_user('a3');
SELECT cmp_ok((SELECT count(*)::int FROM pg_temp.old_list()), '>', 10, 'recorder (central): fixture yields rows');
SELECT results_eq(pg_temp.q('public.list_pending_missed_services'), pg_temp.q('pg_temp.old_list'),
  'recorder (central scope): new == old for every branch × month (rows and order)');

SELECT pg_temp.as_user('a4');
SELECT cmp_ok((SELECT count(*)::int FROM pg_temp.old_list()), '>', 3, 'recorder (province): fixture yields rows');
SELECT results_eq(pg_temp.q('public.list_pending_missed_services'), pg_temp.q('pg_temp.old_list'),
  'recorder (province scope): new == old for every branch × month (rows and order)');

-- =====================================================================
-- ค่าตายตัวของกรณีสำคัญ (เนื้อใหม่ · host)
-- =====================================================================
SELECT pg_temp.as_user('a1');
SELECT is(pg_temp.months('d1'),
  ARRAY[pg_temp.m(-10), pg_temp.m(-8), pg_temp.m(-5), pg_temp.m(-4), pg_temp.m(-3), pg_temp.m(-2), pg_temp.m(-1)],
  'd1: routine / make-up / waived months drop out · problem visit and make-up-only months stay');
SELECT is(pg_temp.months('d2'),
  ARRAY[pg_temp.m(-10), pg_temp.m(-9), pg_temp.m(-8), pg_temp.m(-5), pg_temp.m(-4), pg_temp.m(-3)],
  'd2: paused months (start month in, resume month out, open pause to now) drop out');
SELECT ok(pg_temp.m(-4) = ANY (pg_temp.months('d3')), 'd3: pause and resume in the same month = no paused month');
SELECT is(pg_temp.months('0a'), ARRAY[pg_temp.m(-6), pg_temp.m(-5), pg_temp.m(-4), pg_temp.m(-3)],
  '0a: contract paused via pause_contract (status paused) skips months from the pause');
SELECT ok(pg_temp.months('d4') = '{}'::date[] AND pg_temp.months('d5') = ARRAY[pg_temp.m(-1)],
  'linked Renew: old contract superseded · the Renew itself is tracked');
SELECT ok(cardinality(pg_temp.months('d6')) > 0, 'cancelled Renew does not supersede');
SELECT ok(pg_temp.months('d8') = '{}'::date[] AND cardinality(pg_temp.months('da')) > 0,
  'unlinked New after the end supersedes · New starting before the end does not');
SELECT ok(pg_temp.months('dc') = '{}'::date[], 'explicit end_date counts as the real end (New after it supersedes)');
SELECT ok(cardinality(pg_temp.months('de')) > 0, 'New starting on the end day itself does not supersede (must be after)');
SELECT ok(cardinality(pg_temp.months('e2')) > 0 AND cardinality(pg_temp.months('f2')) > 0,
  'closed and expired_pending_collection contracts are still listed');
SELECT ok(pg_temp.months('f1') = '{}'::date[] AND pg_temp.months('f3') = '{}'::date[],
  'cancelled contracts and contracts without stations are not listed');
SELECT is((pg_temp.months('f4'))[1], pg_temp.m(-30), '36-month contract: tracking starts at the station setup month');
SELECT is(pg_temp.months('f5'), ARRAY[pg_temp.m(-8), pg_temp.m(-7), pg_temp.m(-6), pg_temp.m(-5), pg_temp.m(-4)],
  'custom 5-month contract: months end at start + 5 − 1');
SELECT ok(NOT (pg_temp.m(-3) = ANY (pg_temp.months('e1'))) AND pg_temp.m(-4) = ANY (pg_temp.months('e1')),
  'province contract: routine month drops out, others stay');

-- ขอบเขต
SELECT pg_temp.as_user('a2');
SELECT ok(cardinality(pg_temp.months('e1')) > 0, 'admin (central scope) still sees province rows (no scope filter, as before)');
SELECT pg_temp.as_user('a4');
SELECT ok((SELECT bool_and(branch_id = (SELECT p FROM _b)) AND count(*) > 0 FROM public.list_pending_missed_services()),
  'recorder (province) sees province rows only');
SELECT is((SELECT count(*)::int FROM public.list_pending_missed_services((SELECT x FROM _b))), 0,
  'recorder (province) asking for a central branch gets nothing');

-- =====================================================================
-- ด่าน role: เท่าเดิม (42501 ทั้งเนื้อเดิมและเนื้อใหม่)
-- =====================================================================
SELECT pg_temp.as_user('a5');
SELECT throws_ok('SELECT * FROM public.list_pending_missed_services()', '42501', NULL, 'viewer: new refuses (42501)');
SELECT throws_ok('SELECT * FROM pg_temp.old_list()', '42501', NULL, 'viewer: old refused too (same behaviour)');
SELECT pg_temp.as_user('a6');
SELECT throws_ok('SELECT * FROM public.list_pending_missed_services()', '42501', NULL, 'no profile: new refuses (42501)');
SELECT throws_ok('SELECT * FROM pg_temp.old_list()', '42501', NULL, 'no profile: old refused too');
SELECT pg_temp.as_user('a7');
SELECT throws_ok('SELECT * FROM public.list_pending_missed_services()', '42501', NULL, 'deactivated: new refuses (42501)');
SELECT throws_ok('SELECT * FROM pg_temp.old_list()', '42501', NULL, 'deactivated: old refused too');
RESET ROLE;
SELECT pg_temp.no_user();
SELECT throws_ok('SELECT * FROM public.list_pending_missed_services()', '42501', NULL,
  'postgres without a JWT: new refuses (42501) — same as old (no role)');

SELECT * FROM finish();
ROLLBACK;
