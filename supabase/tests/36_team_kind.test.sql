-- M22 (20261115110000): teams.kind / is_system · save_service_visit เช็กประเภททีม · delete_team · reorder_customer_types
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(68);

-- =====================================================================
-- โครงสร้าง + backfill
-- =====================================================================
SELECT has_column('public', 'teams', 'kind', 'teams.kind exists');
SELECT col_not_null('public', 'teams', 'kind', 'teams.kind is required');
SELECT col_hasnt_default('public', 'teams', 'kind', 'teams.kind has no default (a new team must pick a kind)');
SELECT has_column('public', 'teams', 'is_system', 'teams.is_system exists');
SELECT is((SELECT string_agg(code, ',' ORDER BY code) FROM teams WHERE kind = 'service'),
  'A,B,C,D,E,F,G,H,I,J,K,L,M,N,O', 'A-O are service teams');
SELECT is((SELECT kind FROM teams WHERE code = 'Z'), 'install', 'Z is an install team');
SELECT is((SELECT is_system FROM teams WHERE code = 'Z'), false, 'Z is a normal team (not a system team)');
SELECT is((SELECT name FROM teams WHERE code = 'Z'), 'ทีม Z (ติดตั้ง)', 'Z renamed to the FINAL mockup name');
SELECT is((SELECT kind FROM teams WHERE code = 'Sup'), 'supervisor', 'Sup is a supervisor team');
SELECT is((SELECT string_agg(code, ',') FROM teams WHERE is_system), 'Sup', 'Sup is the only system team');
SELECT throws_ok($$INSERT INTO teams (code, name, kind) VALUES ('Y', 'ทีม Y', 'lead')$$,
  '23514', NULL, 'an unknown kind is refused');
SELECT throws_ok($$INSERT INTO teams (code, name) VALUES ('Y', 'ทีม Y')$$,
  '23502', NULL, 'a team without a kind is refused');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.teams'::regclass), true, 'RLS still on teams');
SELECT has_trigger('public', 'teams', 'teams_system_guard', 'system team guard trigger exists');
SELECT is((SELECT count(*)::int FROM pg_constraint
            WHERE contype = 'f' AND confrelid = 'public.teams'::regclass AND confdeltype = 'c'), 0,
  'no foreign key to teams cascades on delete');
SELECT isnt_definer('public', 'delete_team', ARRAY['uuid'], 'delete_team is SECURITY INVOKER');
SELECT isnt_definer('public', 'reorder_customer_types', ARRAY['text[]'], 'reorder_customer_types is SECURITY INVOKER');
SELECT ok(NOT has_function_privilege('anon', 'public.delete_team(uuid)', 'EXECUTE'), 'anon cannot call delete_team');
SELECT ok(NOT has_function_privilege('anon', 'public.reorder_customer_types(text[])', 'EXECUTE'),
  'anon cannot call reorder_customer_types');
SELECT ok(NOT has_function_privilege('authenticated', 'public.teams_system_guard()', 'EXECUTE'),
  'nobody calls the guard trigger function directly');

-- =====================================================================
-- seed
-- =====================================================================
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
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, stations_initialized_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'TK-1', '2026-01-15', 1, 50000, now());
INSERT INTO stations (id, contract_id, type, station_no) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'IG', 1);

-- ทีมทดสอบ (เพิ่มเป็น postgres): Q หัวหน้างาน · U ผูกสัญญา · V ผูกผู้ใช้ · W ผูกการเข้า (ทีมที่ 2 ของการเข้า f2) · X ว่าง
INSERT INTO teams (id, code, name, kind) VALUES
  ('00000000-0000-0000-0000-0000000000b2', 'Q', 'ทีม Q', 'supervisor'),
  ('00000000-0000-0000-0000-0000000000b3', 'U', 'ทีม U', 'service'),
  ('00000000-0000-0000-0000-0000000000b4', 'V', 'ทีม V', 'service'),
  ('00000000-0000-0000-0000-0000000000b5', 'W', 'ทีม W', 'service'),
  ('00000000-0000-0000-0000-0000000000b6', 'X', 'ทีม X', 'install');
INSERT INTO contract_teams (contract_id, team_id) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b3');
UPDATE profiles SET team_id = '00000000-0000-0000-0000-0000000000b4'
 WHERE user_id = '00000000-0000-0000-0000-0000000000a2';

CREATE TEMP TABLE _t AS
  SELECT (SELECT id FROM teams WHERE code = 'Z') AS z, (SELECT id FROM teams WHERE code = 'Sup') AS sup,
         '00000000-0000-0000-0000-0000000000b1'::uuid AS p, '00000000-0000-0000-0000-0000000000b2'::uuid AS q;
GRANT SELECT ON _t TO PUBLIC;

CREATE FUNCTION pg_temp.payload(p_visit uuid, p_date date, p_teams uuid[])
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('visit_id', p_visit, 'contract_id', '00000000-0000-0000-0000-0000000000d1',
                            'visit_date', p_date, 'visit_type', 'routine', 'start_time', '09:00',
                            'end_time', '10:30', 'team_ids', to_jsonb(p_teams))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.payload(uuid, date, uuid[]) TO PUBLIC;

-- =====================================================================
-- RLS ของ teams คงเดิม: host เพิ่ม/แก้ได้ · admin/recorder ไม่ได้
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$INSERT INTO teams (id, code, name, kind)
                  VALUES ('00000000-0000-0000-0000-0000000000b1', 'P', 'ทีม P', 'service')$$,
  'host adds a new service team P from settings');
SELECT throws_ok($$INSERT INTO teams (code, name, kind, is_system) VALUES ('S2', 'ทีม S2', 'supervisor', true)$$,
  'TM002', NULL, 'host cannot create a system team through the API');
SELECT throws_ok($$UPDATE teams SET is_system = true WHERE code = 'X'$$,
  'TM002', NULL, 'host cannot turn a normal team into a system team');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$INSERT INTO teams (code, name, kind) VALUES ('R', 'ทีม R', 'service')$$,
  '42501', NULL, 'admin cannot add teams (RLS)');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
UPDATE teams SET kind = 'supervisor' WHERE code = 'A';
RESET ROLE;
SELECT is((SELECT kind FROM teams WHERE code = 'A'), 'service', 'recorder cannot change a team kind (RLS: 0 rows)');

-- =====================================================================
-- บันทึกบริการ: เช็กจากประเภททีม
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f1', '2026-01-20',
                    ARRAY[(SELECT p FROM _t)]))$$,
  'a new service team P (not A-O) can record a service visit');
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2', '2026-02-20',
                    ARRAY[(SELECT z FROM _t)]))$$,
  'install team Z can still record a service visit (as before)');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f3', '2026-03-20',
                     ARRAY[(SELECT sup FROM _t)]))$$,
  'SV006', NULL, 'system supervisor team Sup is still refused (SV006)');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f3', '2026-03-20',
                     ARRAY[(SELECT q FROM _t)]))$$,
  'SV006', NULL, 'any supervisor-kind team is refused like Sup (SV006)');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f3', '2026-03-20',
                     ARRAY[(SELECT p FROM _t), (SELECT q FROM _t)]))$$,
  'SV006', NULL, 'one supervisor team in the list is enough to refuse (SV006)');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f3', '2026-03-20',
                     ARRAY['00000000-0000-0000-0000-00000000dead'::uuid]))$$,
  'SV006', NULL, 'an unknown team id is refused (SV006)');
RESET ROLE;
SELECT is((SELECT array_agg(t.code) FROM visit_teams vt JOIN teams t ON t.id = vt.team_id
            WHERE vt.visit_id = '00000000-0000-0000-0000-0000000000f1'), ARRAY['P'], 'team P saved on the visit');

-- M25: P มีงานผูกแล้ว → เปลี่ยนเป็นหัวหน้างานไม่ได้ (TM003) · ทดสอบ "เช็กตามประเภทปัจจุบัน" ด้วยทีม X (ยังว่าง) แทน
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$UPDATE teams SET kind = 'supervisor' WHERE code = 'P'$$,
  'TM003', NULL, 'M25: a team with linked work cannot become a supervisor team (TM003)');
UPDATE teams SET kind = 'supervisor' WHERE code = 'X';
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f3', '2026-03-20',
                     ARRAY['00000000-0000-0000-0000-0000000000b6'::uuid]))$$,
  'SV006', NULL, 'the check follows the current kind, not the code (X now supervisor → SV006)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
UPDATE teams SET kind = 'install' WHERE code = 'X';
UPDATE teams SET kind = 'install' WHERE code = 'P';
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f1', '2026-01-20',
                    ARRAY[(SELECT p FROM _t)]))$$,
  'P as an install team records again');
RESET ROLE;

-- ทีม W เป็นทีมที่ 2 ของการเข้า f2 (คู่กับ Z)
INSERT INTO visit_teams (visit_id, team_id)
VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b5');

-- =====================================================================
-- ลบทีม
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT public.delete_team('00000000-0000-0000-0000-0000000000b6')$$,
  '42501', NULL, 'recorder cannot delete teams');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$SELECT public.delete_team('00000000-0000-0000-0000-0000000000b6')$$,
  '42501', NULL, 'admin cannot delete teams');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$SELECT public.delete_team('00000000-0000-0000-0000-0000000000b1')$$,
  'TM001', 'ลบทีม P ไม่ได้ เพราะยังมีงานผูกอยู่ (สัญญา 0 · การเข้าบริการ 1 · ผู้ใช้ 0)',
  'a team used in a visit cannot be deleted — Thai message with counts (TM001)');
SELECT throws_ok($$SELECT public.delete_team('00000000-0000-0000-0000-0000000000b3')$$,
  'TM001', 'ลบทีม U ไม่ได้ เพราะยังมีงานผูกอยู่ (สัญญา 1 · การเข้าบริการ 0 · ผู้ใช้ 0)',
  'a team linked to a contract cannot be deleted (TM001)');
SELECT throws_ok($$SELECT public.delete_team('00000000-0000-0000-0000-0000000000b4')$$,
  'TM001', 'ลบทีม V ไม่ได้ เพราะยังมีงานผูกอยู่ (สัญญา 0 · การเข้าบริการ 0 · ผู้ใช้ 1)',
  'a team set on a user profile cannot be deleted (TM001)');
SELECT throws_ok($$SELECT public.delete_team('00000000-0000-0000-0000-0000000000b5')$$,
  'TM001', 'ลบทีม W ไม่ได้ เพราะยังมีงานผูกอยู่ (สัญญา 0 · การเข้าบริการ 1 · ผู้ใช้ 0)',
  'a team that joined a visit with another team cannot be deleted (TM001)');
SELECT throws_ok($$SELECT public.delete_team((SELECT sup FROM _t))$$,
  'TM002', 'ทีม Sup เป็นทีมระบบ ลบไม่ได้', 'the system team Sup cannot be deleted (TM002)');
SELECT throws_ok($$SELECT public.delete_team('00000000-0000-0000-0000-00000000dead')$$,
  'AG004', NULL, 'an unknown team id is reported, not silently ignored (AG004)');
SELECT throws_ok($$SELECT public.delete_team(NULL)$$, '22004', NULL, 'a NULL team id is refused');

-- ลบตรงผ่าน REST: FK ยังกัน (ไม่มี cascade) · ทีมระบบโดนด่าน
SELECT throws_ok($$DELETE FROM teams WHERE id = '00000000-0000-0000-0000-0000000000b3'$$,
  '23503', NULL, 'a direct delete of a linked team is still blocked by the foreign key');
SELECT throws_ok($$DELETE FROM teams WHERE code = 'Sup'$$,
  'TM002', NULL, 'a direct delete of the system team is blocked');
SELECT throws_ok($$UPDATE teams SET kind = 'service' WHERE code = 'Sup'$$,
  'TM002', NULL, 'the system team kind cannot change');
SELECT throws_ok($$UPDATE teams SET code = 'SUP2' WHERE code = 'Sup'$$,
  'TM002', NULL, 'the system team code cannot change');
SELECT throws_ok($$UPDATE teams SET id = gen_random_uuid() WHERE code = 'Sup'$$,
  'TM002', NULL, 'the system team id cannot change');
SELECT lives_ok($$UPDATE teams SET name = 'หัวหน้างาน (Supervisor)' WHERE code = 'Sup'$$,
  'the system team can be renamed');

SELECT lives_ok($$SELECT public.delete_team('00000000-0000-0000-0000-0000000000b6')$$, 'host deletes an unused team');
-- Z เป็นทีมปกติ: ผูกการเข้า f2 อยู่ → โดน TM001 (กติกางานผูก) ไม่ใช่ TM002 (ทีมระบบ)
SELECT throws_ok($$SELECT public.delete_team((SELECT z FROM _t))$$,
  'TM001', NULL, 'Z follows the normal rule (linked work → TM001), not a system-team block');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM teams WHERE id = '00000000-0000-0000-0000-0000000000b6'), 0, 'team X is gone');
SELECT is((SELECT count(*)::int FROM teams WHERE id IN ('00000000-0000-0000-0000-0000000000b1',
             '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b4',
             '00000000-0000-0000-0000-0000000000b5')), 4, 'linked teams are all still there');
SELECT is((SELECT count(*)::int FROM contract_teams WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'), 1,
  'the contract link is untouched');
SELECT is((SELECT name FROM teams WHERE code = 'Sup'), 'หัวหน้างาน (Supervisor)', 'Sup renamed');

-- =====================================================================
-- จัดเรียงประเภทลูกค้า
-- =====================================================================
CREATE TEMP TABLE _ct AS SELECT array_agg(code ORDER BY sort_order) AS codes FROM customer_types;
GRANT SELECT ON _ct TO PUBLIC;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT public.reorder_customer_types((SELECT codes FROM _ct))$$,
  '42501', NULL, 'recorder cannot reorder customer types');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$SELECT public.reorder_customer_types((SELECT codes FROM _ct))$$,
  '42501', NULL, 'admin cannot reorder customer types (settings are host-only, same as RLS)');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
-- สลับ 2 ตัวแรก (ค่าชนกันทันทีถ้าทำ UPDATE ทีละแถวตรงๆ)
SELECT lives_ok($$SELECT public.reorder_customer_types(
                    ARRAY[(SELECT codes[2] FROM _ct), (SELECT codes[1] FROM _ct)] || (SELECT codes[3:] FROM _ct))$$,
  'host swaps two neighbouring types in one call');
RESET ROLE;
SELECT is((SELECT array_agg(code ORDER BY sort_order) FROM customer_types),
  (SELECT ARRAY[codes[2], codes[1]] || codes[3:] FROM _ct), 'the first two types are swapped');
SELECT is((SELECT array_agg(sort_order ORDER BY sort_order) FROM customer_types),
  (SELECT array_agg(n) FROM generate_series(1, (SELECT cardinality(codes) FROM _ct)) n),
  'sort_order is 1..n after the swap (no negative leftovers)');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$SELECT public.reorder_customer_types(
                    (SELECT array_agg(c ORDER BY o DESC) FROM unnest((SELECT codes FROM _ct)) WITH ORDINALITY AS x(c, o)))$$,
  'host reverses the whole list in one call');
SELECT throws_ok($$SELECT public.reorder_customer_types((SELECT codes[2:] FROM _ct))$$,
  'CT001', NULL, 'a list with a missing type is refused (CT001)');
SELECT throws_ok($$SELECT public.reorder_customer_types((SELECT codes[1:1] || codes[2:] || codes[1:1] FROM _ct))$$,
  'CT001', NULL, 'a list with a duplicate is refused (CT001)');
SELECT throws_ok($$SELECT public.reorder_customer_types((SELECT ARRAY['no_such_type'] || codes[2:] FROM _ct))$$,
  'CT001', NULL, 'a list with an unknown code is refused (CT001)');
SELECT throws_ok($$SELECT public.reorder_customer_types((SELECT ARRAY[NULL::text] || codes[2:] FROM _ct))$$,
  'CT001', NULL, 'a list with a NULL code is refused (CT001)');
SELECT throws_ok($$SELECT public.reorder_customer_types(ARRAY[]::text[])$$,
  '22004', NULL, 'an empty list is refused');
RESET ROLE;
SELECT is((SELECT array_agg(code ORDER BY sort_order) FROM customer_types),
  (SELECT array_agg(c ORDER BY o DESC) FROM unnest((SELECT codes FROM _ct)) WITH ORDINALITY AS x(c, o)),
  'the whole list is reversed and the refused calls changed nothing');

SELECT * FROM finish();
ROLLBACK;
