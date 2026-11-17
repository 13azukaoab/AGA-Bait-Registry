-- M24 (20261115140000): ฐานข้อมูลของหน้า #todo
--   1. missed_service_notes + save_missed_service_note (RLS / สิทธิ์ / เดือนต้องตกจริงและรอตัดสิน / audit)
--   2. oldest_open_month() (floor = go_live_month() ของ app_settings — M25 · เดือนที่ข้าม · ปิดครบ → เดือนปัจจุบัน · ส่วนที่มองเห็น)
--   3. list_team_new_renew(p_month) (New/Renew · ทีมข้ามเขตนับตามสาขาลูกค้า · หลายทีม · ไม่มีทีม · ขอบเขต recorder)
-- วันที่ทั้งหมดอ้างจากเดือนปัจจุบัน (Asia/Bangkok) ผ่าน pg_temp.m(n) → เทสไม่พังเมื่อเวลาผ่านไป
--   n1 (สาขา X ส่วนกลาง) เริ่ม m(-6) ตั้งสถานี m(-6): m(-5) มี routine · m(-4) ชดเชยแล้ว · m(-1) ไม่ชดเชย
--      → รอตัดสิน = m(-6), m(-3), m(-2)
--   n2 ยกเลิก · n3 ต่อแล้ว (สัญญาใหม่ t3) · n4 ต่างจังหวัด · n5 ยังไม่ตั้งสถานี
--   t1..t7 = สัญญาสำหรับสรุป New/Renew ของเดือน m(-2)
BEGIN;
SELECT plan(90);

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

-- สาขา X / Y = ส่วนกลางคนละเขต (ทีมข้ามเขต) · P = ต่างจังหวัด
CREATE TEMP TABLE _b AS
SELECT (SELECT b.id FROM branches b JOIN zones z ON z.id = b.zone_id
          WHERE b.division = 'central' ORDER BY z.sort_order, b.name LIMIT 1) AS x,
       (SELECT b.id FROM branches b JOIN zones z ON z.id = b.zone_id
          WHERE b.division = 'central' ORDER BY z.sort_order DESC, b.name LIMIT 1) AS y,
       (SELECT b.id FROM branches b WHERE b.division = 'province' ORDER BY b.name LIMIT 1) AS p,
       (SELECT id FROM teams WHERE code = 'A') AS ta,
       (SELECT id FROM teams WHERE code = 'B') AS tb;
GRANT SELECT ON _b TO PUBLIC;

INSERT INTO customers (id, branch_id, name) VALUES
  (pg_temp.id('c1'), (SELECT x FROM _b), 'Central X'),
  (pg_temp.id('c2'), (SELECT y FROM _b), 'Central Y'),
  (pg_temp.id('c3'), (SELECT p FROM _b), 'Province');

INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at,
                       status, cancelled_at, renewed_from_contract_id) VALUES
  (pg_temp.id('d1'), pg_temp.id('c1'), 'N-1', pg_temp.m(-6), 12, 24000, pg_temp.m(-6), 'active', NULL, NULL),
  (pg_temp.id('d2'), pg_temp.id('c1'), 'N-2', pg_temp.m(-6), 12, 24000, pg_temp.m(-6), 'cancelled', pg_temp.m(-3), NULL),
  (pg_temp.id('d3'), pg_temp.id('c1'), 'N-3', pg_temp.m(-8), 12, 24000, pg_temp.m(-8), 'active', NULL, NULL),
  (pg_temp.id('d4'), pg_temp.id('c3'), 'N-4', pg_temp.m(-6), 12, 24000, pg_temp.m(-6), 'active', NULL, NULL),
  (pg_temp.id('d5'), pg_temp.id('c1'), 'N-5', pg_temp.m(-6), 12, 24000, NULL,           'active', NULL, NULL),
  -- สรุป New/Renew เดือน m(-2)
  (pg_temp.id('f1'), pg_temp.id('c1'), 'T-1', pg_temp.m(-2) + 2, 12, 24000, NULL, 'active', NULL, NULL),
  (pg_temp.id('f2'), pg_temp.id('c2'), 'T-2', pg_temp.m(-2) + 4, 12, 24000, NULL, 'active', NULL, NULL),
  (pg_temp.id('f3'), pg_temp.id('c1'), 'T-3', pg_temp.m(-2) + 9, 12, 24000, NULL, 'active', NULL, pg_temp.id('d3')),
  (pg_temp.id('f4'), pg_temp.id('c1'), 'T-4', pg_temp.m(-2) + 1, 12, 24000, NULL, 'cancelled', pg_temp.m(-2) + 5, NULL),
  (pg_temp.id('f5'), pg_temp.id('c3'), 'T-5', pg_temp.m(-2) + 3, 12, 24000, NULL, 'active', NULL, NULL),
  (pg_temp.id('f6'), pg_temp.id('c1'), 'T-6', pg_temp.m(-2) + 6, 12, 24000, NULL, 'active', NULL, NULL),
  (pg_temp.id('f7'), pg_temp.id('c1'), 'T-7', pg_temp.m(-1), 12, 24000, NULL, 'active', NULL, NULL);
INSERT INTO contract_teams (contract_id, team_id) VALUES
  (pg_temp.id('f1'), (SELECT ta FROM _b)),
  (pg_temp.id('f2'), (SELECT ta FROM _b)),
  (pg_temp.id('f3'), (SELECT ta FROM _b)),
  (pg_temp.id('f3'), (SELECT tb FROM _b)),
  (pg_temp.id('f4'), (SELECT ta FROM _b)),
  (pg_temp.id('f5'), (SELECT ta FROM _b)),
  (pg_temp.id('f7'), (SELECT ta FROM _b));

-- n1: m(-5) routine (ไม่ตก) · m(-4) ชดเชยด้วยการเข้า m(-1) · m(-1) ไม่ชดเชย
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time) VALUES
  (pg_temp.id('e1'), pg_temp.id('d1'), pg_temp.m(-5) + 9, 'routine', '09:00', '10:00');
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time, makeup_for_month) VALUES
  (pg_temp.id('e2'), pg_temp.id('d1'), pg_temp.m(-1) + 2, 'routine', '09:00', '10:00', pg_temp.m(-4));
INSERT INTO missed_service_resolutions (contract_id, missed_month, kind, reason) VALUES
  (pg_temp.id('d1'), pg_temp.m(-1), 'waived', 'ลูกค้าปิดอาคาร');

-- payload ของ save_missed_service_note
CREATE FUNCTION pg_temp.sn(p_contract text, p_missed date, p_note text) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.save_missed_service_note(%L::jsonb)',
    jsonb_build_object('contract_id', pg_temp.id(p_contract), 'missed_month', p_missed, 'note', p_note))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.sn(text, date, text) TO PUBLIC;
CREATE FUNCTION pg_temp.note(p_contract text, p_missed date) RETURNS text LANGUAGE sql AS
  $$ SELECT note FROM missed_service_notes WHERE contract_id = pg_temp.id(p_contract) AND missed_month = p_missed $$;
GRANT EXECUTE ON FUNCTION pg_temp.note(text, date) TO PUBLIC;
CREATE FUNCTION pg_temp.as_user(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || p, true) $$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO PUBLIC;
-- เดือนที่บันทึกหมายเหตุได้จริง (ลองทุกเดือน m(-8)..m(0) ของสัญญา · ข้อผิดพลาด = บันทึกไม่ได้)
CREATE FUNCTION pg_temp.accepted(p_contract text) RETURNS date[] LANGUAGE plpgsql AS $$
DECLARE
  v_out date[] := '{}';
  v_m   date;
BEGIN
  FOR i IN -8..0 LOOP
    v_m := pg_temp.m(i);
    BEGIN
      PERFORM public.save_missed_service_note(jsonb_build_object(
        'contract_id', pg_temp.id(p_contract), 'missed_month', v_m, 'note', 'parity'));
      v_out := v_out || v_m;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.accepted(text) TO PUBLIC;
CREATE FUNCTION pg_temp.pending(p_contract text) RETURNS date[] LANGUAGE sql AS
  $$ SELECT coalesce(array_agg(missed_month ORDER BY missed_month), '{}')
       FROM public.list_pending_missed_services(NULL, NULL) WHERE contract_id = pg_temp.id(p_contract) $$;
GRANT EXECUTE ON FUNCTION pg_temp.pending(text) TO PUBLIC;
-- สรุปรายทีม: 'new|renew' ของ (ทีม, สาขา) · team NULL = ไม่มีทีม
CREATE FUNCTION pg_temp.tnr(p_team uuid, p_branch uuid, p_month date) RETURNS text LANGUAGE sql AS
  $$ SELECT new_count || '|' || renew_count FROM public.list_team_new_renew(p_month)
      WHERE team_id IS NOT DISTINCT FROM p_team AND branch_id = p_branch $$;
GRANT EXECUTE ON FUNCTION pg_temp.tnr(uuid, uuid, date) TO PUBLIC;

-- =====================================================================
-- โครงสร้าง + สิทธิ์ (PDPA)
-- =====================================================================
SELECT has_table('public', 'missed_service_notes', 'table missed_service_notes exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.missed_service_notes'::regclass), 'RLS is enabled');
SELECT ok(NOT has_table_privilege('anon', 'public.missed_service_notes', 'SELECT'), 'anon cannot read notes');
SELECT ok(NOT has_table_privilege('authenticated', 'public.missed_service_notes', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.missed_service_notes', 'UPDATE')
          AND NOT has_table_privilege('authenticated', 'public.missed_service_notes', 'DELETE'),
  'authenticated has no direct write privilege (RPC only)');
SELECT ok(NOT has_function_privilege('anon', 'public.save_missed_service_note(jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.oldest_open_month()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.list_team_new_renew(date)', 'EXECUTE'),
  'anon cannot execute the M24 functions');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.oldest_open_month()'::regprocedure), false,
  'oldest_open_month is SECURITY INVOKER');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.list_team_new_renew(date)'::regprocedure), false,
  'list_team_new_renew is SECURITY INVOKER');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                   WHERE t.tgrelid = 'public.missed_service_notes'::regclass AND p.proname = 'audit_trigger'),
  'notes table has an audit trigger on public.audit_trigger()');
SELECT isnt((SELECT x FROM _b), (SELECT y FROM _b), 'fixture: X and Y are different central branches');
SELECT isnt((SELECT zone_id FROM branches WHERE id = (SELECT x FROM _b)),
            (SELECT zone_id FROM branches WHERE id = (SELECT y FROM _b)), 'fixture: X and Y are in different zones');

-- ---------- anon ----------
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.missed_service_notes$$, '42501', NULL, 'anon select notes is refused');
SELECT throws_ok(pg_temp.sn('d1', pg_temp.m(-6), 'x'), '42501', NULL, 'anon cannot save a note');
SELECT throws_ok($$SELECT * FROM public.oldest_open_month()$$, '42501', NULL, 'anon cannot read oldest open month');
SELECT throws_ok($$SELECT * FROM public.list_team_new_renew(NULL)$$, '42501', NULL, 'anon cannot read team summary');
RESET ROLE;

-- =====================================================================
-- 1. หมายเหตุ: host
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is(pg_temp.pending('d1'), ARRAY[pg_temp.m(-6), pg_temp.m(-3), pg_temp.m(-2)],
  'fixture: n1 pending months = m(-6), m(-3), m(-2)');
SELECT lives_ok(pg_temp.sn('d1', pg_temp.m(-6), '  ลูกค้าปิดอาคาร  '), 'host saves a note on a pending month');
SELECT is(pg_temp.note('d1', pg_temp.m(-6)), 'ลูกค้าปิดอาคาร', 'note is trimmed');
SELECT is((SELECT recorded_by FROM missed_service_notes WHERE contract_id = pg_temp.id('d1') AND missed_month = pg_temp.m(-6)),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'recorded_by = host');
SELECT throws_ok($$INSERT INTO missed_service_notes (contract_id, missed_month, note)
                   VALUES (pg_temp.id('d1'), pg_temp.m(-3), 'x')$$, '42501', NULL, 'direct INSERT is refused');
SELECT throws_ok($$UPDATE missed_service_notes SET note = 'x'$$, '42501', NULL, 'direct UPDATE is refused');
SELECT throws_ok($$DELETE FROM missed_service_notes$$, '42501', NULL, 'direct DELETE is refused');

-- ไม่ใช่เดือนที่ตกและรอตัดสิน → ปฏิเสธ (รหัสเดียวกับ M18)
SELECT throws_ok(pg_temp.sn('d1', pg_temp.m(-5), 'x'), 'MS002', NULL, 'month with a routine visit (not missed) is refused');
SELECT throws_ok(pg_temp.sn('d1', pg_temp.m(-4), 'x'), 'MS005', NULL, 'month already made up is refused');
SELECT throws_ok(pg_temp.sn('d1', pg_temp.m(-1), 'x'), 'MS010', NULL, 'month already waived is refused');
SELECT throws_ok(pg_temp.sn('d1', pg_temp.m(0), 'x'), 'MS001', NULL, 'current month (not over yet) is refused');
SELECT throws_ok(pg_temp.sn('d1', pg_temp.m(-7), 'x'), 'MS001', NULL, 'month before the contract start is refused');
SELECT throws_ok(pg_temp.sn('d1', pg_temp.m(-3) + 4, 'x'), 'MS001', NULL, 'missed_month must be the 1st day');
SELECT throws_ok(pg_temp.sn('d2', pg_temp.m(-5), 'x'), 'MS009', NULL, 'cancelled contract is refused');
SELECT throws_ok(pg_temp.sn('d3', pg_temp.m(-5), 'x'), 'MS011', NULL, 'renewed contract (void months, 2.47) is refused');
SELECT throws_ok(pg_temp.sn('d5', pg_temp.m(-5), 'x'), 'MS001', NULL, 'contract without stations (not tracked, 2.46) is refused');
SELECT throws_ok(pg_temp.sn('99', pg_temp.m(-5), 'x'), 'AG004', NULL, 'unknown contract');
SELECT throws_ok(format('SELECT public.save_missed_service_note(%L::jsonb)',
                        jsonb_build_object('contract_id', pg_temp.id('d1'))), '22004', NULL, 'missed_month is required');
SELECT throws_ok(pg_temp.sn('d1', pg_temp.m(-3), repeat('ก', 201)), '22001', NULL, 'note longer than 200 is refused');
SELECT lives_ok(pg_temp.sn('d1', pg_temp.m(-3), repeat('ก', 200)), 'note of exactly 200 characters is accepted');
SELECT is((SELECT count(*)::int FROM missed_service_notes WHERE contract_id IN (pg_temp.id('d2'), pg_temp.id('d3'), pg_temp.id('d5'))),
  0, 'no note was stored for refused contracts');

-- parity: บันทึกได้ ⇔ อยู่ในรายการรอตัดสิน (list_pending_missed_services)
SELECT is(pg_temp.accepted('d1'), pg_temp.pending('d1'), 'n1: note accepted exactly on list_pending months');
SELECT is(pg_temp.accepted('d4'), pg_temp.pending('d4'), 'n4 (province): note accepted exactly on list_pending months');
SELECT is(pg_temp.accepted('d3'), '{}'::date[], 'n3 (renewed): no month accepts a note');

-- ลบ = ส่งข้อความว่าง
SELECT is((SELECT (public.save_missed_service_note(jsonb_build_object(
             'contract_id', pg_temp.id('d1'), 'missed_month', pg_temp.m(-2), 'note', '   ')) ->> 'deleted')),
  'true', 'blank note deletes the existing note');
SELECT is(pg_temp.note('d1', pg_temp.m(-2)), NULL, 'note is gone');
SELECT is((SELECT (public.save_missed_service_note(jsonb_build_object(
             'contract_id', pg_temp.id('d1'), 'missed_month', pg_temp.m(-2), 'note', NULL)) ->> 'deleted')),
  'false', 'null note with no row → deleted false');
SELECT throws_ok(format('SELECT public.save_missed_service_note(%L::jsonb)',
                        jsonb_build_object('contract_id', pg_temp.id('d1'), 'missed_month', pg_temp.m(-6))),
  '22004', NULL, 'missing note key is refused (no silent delete)');
SELECT is(pg_temp.note('d1', pg_temp.m(-6)), 'parity', 'note kept after a payload without the note key');
SELECT is((SELECT (public.save_missed_service_note(jsonb_build_object(
             'contract_id', pg_temp.id('d1'), 'missed_month', pg_temp.m(-2), 'note', E'\t\r\n\u00a0\u200b ')) ->> 'deleted')),
  'false', 'tab / CR / newline / NBSP / zero-width only note counts as blank (no row stored)');

-- =====================================================================
-- 1b. หมายเหตุ: recorder ในขอบเขต / นอกขอบเขต · admin · viewer
-- =====================================================================
SELECT pg_temp.as_user('a3');
SELECT lives_ok(pg_temp.sn('d1', pg_temp.m(-3), 'ติดต่อไม่ได้'), 'in-scope recorder updates a note');
SELECT is(pg_temp.note('d1', pg_temp.m(-3)), 'ติดต่อไม่ได้', 'note updated');
SELECT is((SELECT recorded_by FROM missed_service_notes WHERE contract_id = pg_temp.id('d1') AND missed_month = pg_temp.m(-3)),
  '00000000-0000-0000-0000-0000000000a3'::uuid, 'recorded_by = last writer (recorder)');
SELECT is((SELECT count(*)::int FROM missed_service_notes WHERE contract_id = pg_temp.id('d1')), 2,
  'in-scope recorder reads the central notes');
SELECT is((SELECT count(*)::int FROM missed_service_notes WHERE contract_id = pg_temp.id('d4')), 0,
  'central recorder cannot read province notes');
SELECT throws_ok(pg_temp.sn('d4', pg_temp.m(-5), 'x'), '42501', NULL, 'central recorder cannot write a province note');

SELECT pg_temp.as_user('a5');
SELECT throws_ok(pg_temp.sn('d1', pg_temp.m(-2), 'x'), '42501', NULL, 'out-of-scope recorder cannot write');
SELECT throws_ok(pg_temp.sn('d1', pg_temp.m(-3), ''), '42501', NULL, 'out-of-scope recorder cannot delete');
SELECT is((SELECT count(*)::int FROM missed_service_notes WHERE contract_id = pg_temp.id('d1')), 0,
  'out-of-scope recorder reads no central notes');
SELECT is((SELECT count(*)::int FROM missed_service_notes WHERE contract_id = pg_temp.id('d4')) > 0, true,
  'province recorder reads province notes');

SELECT pg_temp.as_user('a2');
SELECT throws_ok(pg_temp.sn('d1', pg_temp.m(-2), 'x'), '42501', NULL, 'admin cannot write (read only)');
SELECT is((SELECT count(*)::int FROM missed_service_notes WHERE contract_id IN (pg_temp.id('d1'), pg_temp.id('d4'))) > 3, true,
  'admin reads notes of all branches');

SELECT pg_temp.as_user('a4');
SELECT throws_ok(pg_temp.sn('d1', pg_temp.m(-2), 'x'), '42501', NULL, 'viewer cannot write');
SELECT is((SELECT count(*)::int FROM missed_service_notes), 0, 'viewer reads no notes (PDPA)');
RESET ROLE;

-- audit (trigger เดิม · ไม่แทนที่ audit_trigger)
SELECT is((SELECT array_agg(DISTINCT action::text ORDER BY action::text) FROM audit_log WHERE table_name = 'missed_service_notes'),
  ARRAY['delete', 'insert', 'update'], 'note insert / update / delete are audited');
SELECT is((SELECT changed_by FROM audit_log WHERE table_name = 'missed_service_notes' AND action = 'update'
             AND new_data ->> 'note' = 'ติดต่อไม่ได้'),
  '00000000-0000-0000-0000-0000000000a3'::uuid, 'audit keeps the real author');

-- หมายเหตุคงอยู่เมื่อเรื่องถูกตัดสินภายหลัง แต่แก้ข้อความไม่ได้แล้ว
INSERT INTO missed_service_resolutions (contract_id, missed_month, kind, reason) VALUES
  (pg_temp.id('d1'), pg_temp.m(-3), 'waived', 'ปิดเรื่อง');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is(pg_temp.note('d1', pg_temp.m(-3)), 'ติดต่อไม่ได้', 'note survives a later decision');
SELECT throws_ok(pg_temp.sn('d1', pg_temp.m(-3), 'ใหม่'), 'MS010', NULL, 'note of a decided month cannot be edited');
SELECT lives_ok(pg_temp.sn('d1', pg_temp.m(-3), ''), 'note of a decided month can still be cleared');
RESET ROLE;

-- =====================================================================
-- 2. oldest_open_month
-- =====================================================================
-- M25: floor = go_live_month() (app_settings) แทนการเดาจากแถว legacy · ตั้งค่าเป็น postgres แบบอิงเดือนปัจจุบัน
UPDATE app_settings SET go_live_month = pg_temp.m(0);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is((SELECT array_agg(scope::text || '|' || oldest_open_month || '|' || is_behind ORDER BY scope) FROM public.oldest_open_month()),
  ARRAY['central|' || pg_temp.m(0) || '|false', 'province|' || pg_temp.m(0) || '|false'],
  'go-live = this month, no closure → current month for both scopes, not behind');
RESET ROLE;

-- ปิดส่วนกลาง m(-3) + m(-1) (ข้าม m(-2)) · go-live m(-3)
INSERT INTO month_closures (month_key, scope) VALUES
  (to_char(pg_temp.m(-3), 'YYYY-MM'), 'central'),
  (to_char(pg_temp.m(-1), 'YYYY-MM'), 'central');
UPDATE app_settings SET go_live_month = pg_temp.m(-3);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is((SELECT oldest_open_month FROM public.oldest_open_month() WHERE scope = 'central'), pg_temp.m(-2),
  'a skipped month between closures is the oldest open month');
SELECT is((SELECT is_behind FROM public.oldest_open_month() WHERE scope = 'central'), true, 'central is behind');
SELECT is((SELECT oldest_open_month FROM public.oldest_open_month() WHERE scope = 'province'), pg_temp.m(-3),
  'province with no closure → go-live month is the oldest open month');
RESET ROLE;

-- แถว legacy ไม่มีผลแล้ว (M25) · go-live m(-4) → นับจาก m(-4)
INSERT INTO monthly_branch_snapshots (month_key, branch_id, source) VALUES
  (upper(to_char(pg_temp.m(-6), 'MON.YY')), (SELECT x FROM _b), 'legacy'),
  (upper(to_char(pg_temp.m(-5), 'MON.YY')), (SELECT x FROM _b), 'legacy');
UPDATE app_settings SET go_live_month = pg_temp.m(-4);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is((SELECT oldest_open_month FROM public.oldest_open_month() WHERE scope = 'central'), pg_temp.m(-4),
  'go-live month (from app_settings) is open → oldest open');
SELECT is((SELECT oldest_open_month FROM public.oldest_open_month() WHERE scope = 'province'), pg_temp.m(-4),
  'province counts from go-live too');
RESET ROLE;

-- ปิดส่วนกลางครบ m(-4)..m(-1) → เดือนปัจจุบัน · เดือนก่อน go-live ไม่นับว่าค้าง
INSERT INTO month_closures (month_key, scope) VALUES
  (to_char(pg_temp.m(-4), 'YYYY-MM'), 'central'),
  (to_char(pg_temp.m(-2), 'YYYY-MM'), 'central');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is((SELECT oldest_open_month || '|' || is_behind FROM public.oldest_open_month() WHERE scope = 'central'),
  pg_temp.m(0) || '|false', 'all months since go-live closed → current month, not behind (legacy months ignored)');

SELECT pg_temp.as_user('a3');
SELECT is((SELECT array_agg(scope::text) FROM public.oldest_open_month()), ARRAY['central'],
  'central recorder sees the central scope only');
SELECT is((SELECT oldest_open_month FROM public.oldest_open_month()), pg_temp.m(0),
  'central recorder reads its own closures (all closed → current month)');
SELECT pg_temp.as_user('a5');
SELECT is((SELECT array_agg(scope::text || '|' || oldest_open_month) FROM public.oldest_open_month()),
  ARRAY['province|' || pg_temp.m(-4)], 'province recorder sees the province scope only');
SELECT pg_temp.as_user('a2');
SELECT is((SELECT array_agg(scope::text) FROM public.oldest_open_month()), ARRAY['central'],
  'admin sees the scopes of its division');
SELECT pg_temp.as_user('a4');
SELECT throws_ok($$SELECT * FROM public.oldest_open_month()$$, '42501', NULL, 'viewer cannot read oldest open month');
RESET ROLE;

-- =====================================================================
-- 3. list_team_new_renew
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is(pg_temp.tnr((SELECT ta FROM _b), (SELECT x FROM _b), pg_temp.m(-2)), '1|1',
  'team A at branch X: 1 new + 1 renew (cancelled excluded)');
SELECT is(pg_temp.tnr((SELECT ta FROM _b), (SELECT y FROM _b), pg_temp.m(-2)), '1|0',
  'cross-zone: team A customer in branch Y counts under branch Y');
SELECT is(pg_temp.tnr((SELECT tb FROM _b), (SELECT x FROM _b), pg_temp.m(-2)), '0|1',
  'contract with two teams counts under each team');
SELECT is(pg_temp.tnr(NULL, (SELECT x FROM _b), pg_temp.m(-2)), '1|0', 'contract without a team → team_id NULL row');
SELECT is(pg_temp.tnr((SELECT ta FROM _b), (SELECT p FROM _b), pg_temp.m(-2)), '1|0', 'host sees province branches');
SELECT is((SELECT count(*)::int FROM public.list_team_new_renew(pg_temp.m(-2) + 17)), 5,
  'any day of the month selects the month · 5 (team, branch) rows');
SELECT is((SELECT new_contract_ids || renew_contract_ids FROM public.list_team_new_renew(pg_temp.m(-2))
            WHERE team_id = (SELECT ta FROM _b) AND branch_id = (SELECT x FROM _b)),
  ARRAY[pg_temp.id('f1'), pg_temp.id('f3')], 'contract ids are returned (new, then renew)');
SELECT is((SELECT renew_contract_ids FROM public.list_team_new_renew(pg_temp.m(-2))
            WHERE team_id = (SELECT ta FROM _b) AND branch_id = (SELECT y FROM _b)),
  '{}'::uuid[], 'empty group → empty array, not NULL');
SELECT is((SELECT sum(new_count + renew_count)::int FROM public.list_team_new_renew(pg_temp.m(-1))), 1,
  'another month counts only its own contracts');
SELECT is((SELECT sum(new_count + renew_count)::int || '|' ||
                  (SELECT count(DISTINCT x)::int
                     FROM public.list_team_new_renew(pg_temp.m(-2)) r2,
                          unnest(r2.new_contract_ids || r2.renew_contract_ids) x)
             FROM public.list_team_new_renew(pg_temp.m(-2))),
  '6|5', 'row sum double-counts multi-team contracts (6); distinct contract ids give the month total (5)');

SELECT pg_temp.as_user('a3');
SELECT is((SELECT count(*)::int FROM public.list_team_new_renew(pg_temp.m(-2))
            WHERE branch_id = (SELECT p FROM _b)), 0, 'central recorder does not see province branches');
SELECT is((SELECT count(*)::int FROM public.list_team_new_renew(pg_temp.m(-2))), 4, 'central recorder sees 4 rows');
SELECT is(pg_temp.tnr((SELECT ta FROM _b), (SELECT y FROM _b), pg_temp.m(-2)), '1|0',
  'central recorder sees the cross-zone split');

SELECT pg_temp.as_user('a2');
SELECT is((SELECT count(*)::int FROM public.list_team_new_renew(pg_temp.m(-2))), 5, 'admin sees all branches');
SELECT pg_temp.as_user('a4');
SELECT throws_ok($$SELECT * FROM public.list_team_new_renew(NULL)$$, '42501', NULL, 'viewer cannot read team summary');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
