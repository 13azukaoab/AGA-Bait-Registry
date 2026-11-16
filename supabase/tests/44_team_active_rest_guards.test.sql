-- M26/33 (20261115190000): เปิด/ปิดทีม + ปิดช่อง REST
--   * teams.is_active: host เท่านั้น (TM006) · ทีมระบบปิดไม่ได้ (TM002 + CHECK) · ลง audit_teams
--   * ทีมที่ปิด: เลือกให้งานใหม่ไม่ได้ (TM004) ทั้ง RPC และ REST · งานเก่าที่ผูกไว้แล้ว แก้/บันทึกซ้ำได้
--   * L2: REST ผูกทีมหัวหน้างานกับ contract_teams / visit_teams ไม่ได้ (TM005) · save_job_opening ก็ไม่ได้
--   * M26: INSERT สัญญาที่ผูกสัญญาเก่าผ่าน REST ไม่ได้ (AG015) · save_job_opening / service_role / link_renewal_contract ได้
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated + request.jwt.claim.sub · RESET ROLE เพื่อตรวจ
BEGIN;
SELECT plan(78);

-- =====================================================================
-- schema
-- =====================================================================
SELECT has_column('public', 'teams', 'is_active', 'teams.is_active exists');
SELECT col_not_null('public', 'teams', 'is_active', 'teams.is_active is NOT NULL');
SELECT col_default_is('public', 'teams', 'is_active', 'true', 'teams.is_active defaults to true');
SELECT ok((SELECT bool_and(is_active) FROM teams), 'all existing teams start active');
SELECT has_trigger('public', 'contract_teams', 'team_links_guard', 'contract_teams has the team link guard');
SELECT has_trigger('public', 'visit_teams', 'team_links_guard', 'visit_teams has the team link guard');
SELECT has_trigger('public', 'contracts', 'contracts_renewed_rpc_only', 'contracts has the M26 insert guard');
SELECT ok((SELECT array_agg(tgname ORDER BY tgname) FROM pg_trigger
            WHERE tgrelid = 'public.contracts'::regclass AND tgname IN
              ('contracts_renewal_same_customer', 'contracts_renewed_from_lock',
               'contracts_renewed_gap_guard', 'contracts_renewed_rpc_only'))
          = ARRAY['contracts_renewal_same_customer', 'contracts_renewed_from_lock',
                  'contracts_renewed_gap_guard', 'contracts_renewed_rpc_only']::name[],
  'the M26 guard sorts after the M9 / M23 / M28 triggers');
SELECT ok(NOT has_function_privilege('anon', 'public.set_team_active(uuid, boolean)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.set_team_active(uuid, boolean)', 'EXECUTE'),
  'set_team_active: authenticated only');
SELECT ok(NOT has_function_privilege('authenticated', 'public.team_links_guard()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.contracts_renewed_rpc_only()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.teams_active_guard()', 'EXECUTE'),
  'trigger functions are not callable by users');

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

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;
CREATE FUNCTION pg_temp.br() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION pg_temp.br() TO PUBLIC;
CREATE FUNCTION pg_temp.as_user(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', pg_temp.id(p)::text, true) $$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO PUBLIC;

INSERT INTO customers (id, branch_id, name) VALUES (pg_temp.id('c1'), pg_temp.br(), 'Team Active');
-- d1: สัญญาที่เตรียมสถานีแล้ว (บันทึกบริการได้) · d0: สัญญาเก่าสำหรับ Renew (จบ 31 ธ.ค. 2026)
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, stations_initialized_at) VALUES
  (pg_temp.id('d1'), pg_temp.id('c1'), 'TA-1', '2026-01-15', 1, 50000, now());
INSERT INTO contracts (id, customer_id, contract_no, start_date, end_date, term_years, value_total, sale_type) VALUES
  (pg_temp.id('d0'), pg_temp.id('c1'), 'TA-0', '2026-01-01', '2026-12-31', 1, 24000, 'new');
INSERT INTO stations (id, contract_id, type, station_no) VALUES (pg_temp.id('e1'), pg_temp.id('d1'), 'IG', 1);
-- d5: สัญญาที่หมดแล้ว (เก็บ IG ได้) + IG 2 จุด
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, stations_initialized_at) VALUES
  (pg_temp.id('d5'), pg_temp.id('c1'), 'TA-5', '2024-01-01', 1, 24000, now());
INSERT INTO stations (id, contract_id, type, station_no) VALUES
  (pg_temp.id('e5'), pg_temp.id('d5'), 'IG', 1), (pg_temp.id('e6'), pg_temp.id('d5'), 'IG', 2);

-- ทีมทดสอบ: T1/T2/T3 ทีมบริการ · Q1 หัวหน้างาน
INSERT INTO teams (id, code, name, kind) VALUES
  (pg_temp.id('b1'), 'T1', 'ทีม T1', 'service'),
  (pg_temp.id('b2'), 'T2', 'ทีม T2', 'service'),
  (pg_temp.id('b3'), 'T3', 'ทีม T3', 'install'),
  (pg_temp.id('b9'), 'Q1', 'ทีม Q1', 'supervisor');

CREATE FUNCTION pg_temp.visit(p_visit text, p_date date, p_teams text[]) RETURNS text
LANGUAGE sql AS $$
  SELECT format('SELECT public.save_service_visit(%L::jsonb)',
    jsonb_build_object('visit_id', pg_temp.id(p_visit), 'contract_id', pg_temp.id('d1'),
                       'visit_date', p_date, 'visit_type', 'routine', 'start_time', '09:00', 'end_time', '10:30',
                       'team_ids', (SELECT jsonb_agg(pg_temp.id(t)) FROM unnest(p_teams) t)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.visit(text, date, text[]) TO PUBLIC;

CREATE TEMP TABLE _r (tag text PRIMARY KEY, contract_id uuid, updated_at timestamptz);
GRANT ALL ON _r TO PUBLIC;
-- เปิดงานใหม่ (p_tag) หรือแก้ (p_edit = tag เดิม) ผ่าน save_job_opening ของลูกค้า c1
CREATE FUNCTION pg_temp.job(p_tag text, p_teams text[], p_edit boolean DEFAULT false,
                            p_sale text DEFAULT 'new', p_from text DEFAULT NULL,
                            p_start date DEFAULT '2026-03-01', p_reason text DEFAULT NULL) RETURNS text
LANGUAGE sql AS $$
  SELECT format($f$
    WITH r AS (SELECT contract_id, updated_at FROM public.save_job_opening(
      p_branch_id := pg_temp.br(), p_customer_name := 'Team Active', p_customer_type := NULL,
      p_contract_no := %L, p_start_date := %L, p_end_date := NULL, p_term_years := 1, p_value_total := 24000,
      p_sale_type := %L, p_team_ids := %L::uuid[], p_customer_id := pg_temp.id('c1'),
      p_contract_id := %L, p_expected_updated_at := %L, p_renewed_from_contract_id := %L,
      p_renew_unlinked_reason := %L))
    INSERT INTO _r SELECT %L, contract_id, updated_at FROM r
      ON CONFLICT (tag) DO UPDATE SET updated_at = EXCLUDED.updated_at
  $f$, 'J-' || p_tag, p_start, p_sale,
       (SELECT array_agg(pg_temp.id(t)) FROM unnest(p_teams) t),
       CASE WHEN p_edit THEN (SELECT contract_id FROM _r WHERE tag = p_tag) END,
       CASE WHEN p_edit THEN (SELECT updated_at FROM _r WHERE tag = p_tag) END,
       CASE WHEN p_from IS NOT NULL THEN pg_temp.id(p_from) END,
       p_reason, p_tag)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.job(text, text[], boolean, text, text, date, text) TO PUBLIC;
CREATE FUNCTION pg_temp.rid(p_tag text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT contract_id FROM _r WHERE tag = p_tag $$;
GRANT EXECUTE ON FUNCTION pg_temp.rid(text) TO PUBLIC;
CREATE FUNCTION pg_temp.vteams(p_visit text) RETURNS text[] LANGUAGE sql AS
  $$ SELECT array_agg(t.code ORDER BY t.code) FROM visit_teams vt JOIN teams t ON t.id = vt.team_id
      WHERE vt.visit_id = pg_temp.id(p_visit) $$;
CREATE FUNCTION pg_temp.cteams(p_contract uuid) RETURNS text[] LANGUAGE sql AS
  $$ SELECT array_agg(t.code ORDER BY t.code) FROM contract_teams ct JOIN teams t ON t.id = ct.team_id
      WHERE ct.contract_id = p_contract $$;

-- =====================================================================
-- 1. งานที่สร้างตอนทีม T1 ยังเปิดอยู่
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a3');
SELECT lives_ok(pg_temp.visit('f1', '2026-01-20', ARRAY['b1', 'b2']), 'recorder saves visit f1 with T1 + T2 (both active)');
SELECT pg_temp.as_user('a2');
SELECT lives_ok(pg_temp.job('j1', ARRAY['b1', 'b2']), 'admin opens job J1 with T1 + T2 (both active)');
RESET ROLE;
SELECT is(pg_temp.vteams('f1'), ARRAY['T1', 'T2'], 'f1 is linked to T1 + T2');
SELECT is(pg_temp.cteams(pg_temp.rid('j1')), ARRAY['T1', 'T2'], 'J1 is linked to T1 + T2');

-- =====================================================================
-- 2. เปิด/ปิดทีม: host เท่านั้น · ทีมระบบปิดไม่ได้ · audit
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT throws_ok($$SELECT * FROM public.set_team_active(pg_temp.id('b1'), false)$$,
  'TM006', 'เปิด/ปิดทีมได้เฉพาะผู้ดูแลระบบ (host)', 'admin cannot toggle a team via the RPC (TM006, Thai message)');
UPDATE teams SET is_active = false WHERE id = pg_temp.id('b1');
SELECT pg_temp.as_user('a3');
SELECT throws_ok($$SELECT * FROM public.set_team_active(pg_temp.id('b1'), false)$$,
  'TM006', NULL, 'recorder cannot toggle a team via the RPC (TM006)');
UPDATE teams SET is_active = false WHERE id = pg_temp.id('b1');
RESET ROLE;
SELECT ok((SELECT is_active FROM teams WHERE id = pg_temp.id('b1')), 'admin / recorder REST PATCH changes nothing (RLS: 0 rows)');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is((SELECT is_active FROM public.set_team_active(pg_temp.id('b1'), false)), false, 'host deactivates T1 via the RPC');
SELECT lives_ok($$UPDATE teams SET is_active = false WHERE id = pg_temp.id('b3')$$, 'host deactivates T3 via REST');
SELECT is((SELECT is_active FROM public.set_team_active(pg_temp.id('b3'), false)), false, 'deactivating an inactive team again is a no-op');
SELECT throws_ok($$SELECT * FROM public.set_team_active((SELECT id FROM teams WHERE code = 'Sup'), false)$$,
  'TM002', NULL, 'the system team Sup cannot be deactivated via the RPC (TM002)');
SELECT throws_ok($$UPDATE teams SET is_active = false WHERE code = 'Sup'$$,
  'TM002', NULL, 'the system team Sup cannot be deactivated via REST (TM002)');
SELECT is((SELECT is_active FROM public.set_team_active((SELECT id FROM teams WHERE code = 'Sup'), true)), true,
  'activating Sup (already active) is fine');
SELECT throws_ok($$SELECT * FROM public.set_team_active('00000000-0000-0000-0000-00000000dead', false)$$,
  'AG004', NULL, 'unknown team → AG004');
SELECT throws_ok($$SELECT * FROM public.set_team_active(NULL, false)$$, '22004', NULL, 'missing team id → 22004');
SELECT lives_ok($$INSERT INTO teams (id, code, name, kind, is_active)
                  VALUES (pg_temp.id('b4'), 'T4', 'ทีม T4', 'service', false)$$,
  'host can create a team that starts inactive');
SELECT lives_ok($$UPDATE teams SET name = 'ทีม T1 (พัก)' WHERE id = pg_temp.id('b1')$$, 'host can still rename an inactive team');
RESET ROLE;
SELECT throws_ok($$UPDATE teams SET is_active = false WHERE code = 'Sup'$$,
  '23514', NULL, 'CHECK teams_system_always_active stops postgres too');
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE table_name = 'teams' AND action = 'update' AND row_id = pg_temp.id('b1')
              AND old_data ->> 'is_active' = 'true' AND new_data ->> 'is_active' = 'false'
              AND changed_by = pg_temp.id('a1')), 1,
  'deactivating T1 is audited with old/new value and the host');

-- =====================================================================
-- 3. การเข้าบริการ: งานเก่าแก้ได้ · ทีมที่ปิดเพิ่มเข้างานไม่ได้ (TM004)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a3');
-- HQ ข้อ 1 + 2: ทีมปิดหลังผูกงาน → แก้การเข้าเดิมโดยส่งรายการทีมเดิมครบชุดซ้ำ ผ่าน
SELECT lives_ok(pg_temp.visit('f1', '2026-01-20', ARRAY['b1', 'b2']),
  'visit f1 (T1 deactivated after linking) can be edited when the same full team list is re-sent');
SELECT lives_ok(pg_temp.visit('f1', '2026-01-20', ARRAY['b2', 'b1']),
  'the same team set in another order is not "adding" either');
SELECT lives_ok(pg_temp.visit('f1', '2026-01-20', ARRAY['b1']), 'removing T2 while keeping inactive T1 works');
SELECT lives_ok(pg_temp.visit('f1', '2026-01-20', ARRAY['b1', 'b2']), 'adding back active T2 next to inactive T1 works');
SELECT throws_ok(pg_temp.visit('f1', '2026-01-20', ARRAY['b1', 'b2', 'b3']),
  'TM004', 'ทีม T3 ปิดใช้งานอยู่ เลือกให้งานใหม่ไม่ได้', 'adding inactive T3 to an old visit is refused (TM004)');
SELECT throws_ok(pg_temp.visit('f2', '2026-02-20', ARRAY['b1']),
  'TM004', NULL, 'a new visit with inactive T1 is refused (TM004)');
SELECT throws_ok(pg_temp.visit('f2', '2026-02-20', ARRAY['b2', 'b1']),
  'TM004', NULL, 'one inactive team in a new visit is enough to refuse');
SELECT throws_ok(pg_temp.visit('f2', '2026-02-20', ARRAY['b9']),
  'SV006', NULL, 'a supervisor team in save_service_visit is still SV006 (M22)');
SELECT lives_ok(pg_temp.visit('f3', '2026-03-20', ARRAY['b2']), 'a new visit with active T2 works');
RESET ROLE;
SELECT is(pg_temp.vteams('f1'), ARRAY['T1', 'T2'], 'f1 keeps inactive T1 + active T2');
SELECT ok(NOT EXISTS (SELECT 1 FROM visits WHERE id = pg_temp.id('f2')), 'refused visit f2 was not saved');

-- เก็บ IG หลังหมดสัญญา (ig_collection_apply · ผลตรวจ Opus) — ทีมที่ปิดเก็บใหม่ไม่ได้
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a3');
SELECT throws_ok($$SELECT public.collect_ig_stations(pg_temp.id('d5'), 1, (now() AT TIME ZONE 'Asia/Bangkok')::date, pg_temp.id('b1'), NULL)$$,
  'TM004', NULL, 'IG collection with inactive T1 is refused (TM004)');
SELECT lives_ok($$SELECT public.collect_ig_stations(pg_temp.id('d5'), 1, (now() AT TIME ZONE 'Asia/Bangkok')::date, pg_temp.id('b2'), NULL)$$,
  'IG collection with active T2 works');
RESET ROLE;

-- REST ตรงที่ visit_teams
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a3');
SELECT throws_ok($$INSERT INTO visit_teams (visit_id, team_id) VALUES (pg_temp.id('f3'), pg_temp.id('b1'))$$,
  'TM004', NULL, 'REST: recorder cannot link inactive T1 to a visit (TM004)');
SELECT throws_ok($$INSERT INTO visit_teams (visit_id, team_id) VALUES (pg_temp.id('f3'), pg_temp.id('b9'))$$,
  'TM005', 'ทีม Q1 เป็นทีมหัวหน้างาน ผูกกับสัญญาหรือการเข้าบริการไม่ได้', 'REST: recorder cannot link a supervisor team to a visit (TM005)');
SELECT throws_ok($$INSERT INTO visit_teams (visit_id, team_id) VALUES (pg_temp.id('f3'), (SELECT id FROM teams WHERE code = 'Sup'))$$,
  'TM005', NULL, 'REST: the system supervisor team Sup is refused too (TM005)');
SELECT lives_ok($$INSERT INTO visit_teams (visit_id, team_id) VALUES (pg_temp.id('f1'), pg_temp.id('b1')) ON CONFLICT DO NOTHING$$,
  'REST: re-sending an existing link to inactive T1 is not a new link');
SELECT pg_temp.as_user('a1');
SELECT throws_ok($$INSERT INTO visit_teams (visit_id, team_id) VALUES (pg_temp.id('f3'), pg_temp.id('b1'))$$,
  'TM004', NULL, 'REST: host cannot link inactive T1 as a new link either');
RESET ROLE;
SELECT lives_ok($$INSERT INTO visit_teams (visit_id, team_id) VALUES (pg_temp.id('f3'), pg_temp.id('b3'))$$,
  'postgres / import can still link an inactive team');
DELETE FROM visit_teams WHERE visit_id = pg_temp.id('f3') AND team_id = pg_temp.id('b3');

-- =====================================================================
-- 4. เปิดงาน (save_job_opening) + REST contract_teams
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT lives_ok(pg_temp.job('j1', ARRAY['b1', 'b2'], true),
  'job J1 (T1 deactivated after linking) can be edited when the same full team list is re-sent');
SELECT lives_ok(pg_temp.job('j1', ARRAY['b2', 'b1'], true), 'the same team set in another order is not "adding"');
SELECT lives_ok(pg_temp.job('j1', ARRAY['b1'], true), 'removing T2 while keeping inactive T1 works');
SELECT lives_ok(pg_temp.job('j1', ARRAY['b1', 'b2'], true), 'adding back active T2 next to inactive T1 works');
SELECT throws_ok(pg_temp.job('j1', ARRAY['b1', 'b2', 'b3'], true),
  'TM004', 'ทีม T3 ปิดใช้งานอยู่ เลือกให้งานใหม่ไม่ได้', 'adding inactive T3 to an old job is refused (TM004)');
SELECT throws_ok(pg_temp.job('j2', ARRAY['b1']), 'TM004', NULL, 'a new job with inactive T1 is refused (TM004)');
SELECT throws_ok(pg_temp.job('j2', ARRAY['b9']), 'TM005', NULL, 'a new job with a supervisor team is refused (TM005 · L2)');
SELECT throws_ok(pg_temp.job('j1', ARRAY['b1', 'b2', 'b9'], true), 'TM005', NULL, 'adding a supervisor team on edit is refused (TM005)');
SELECT lives_ok(pg_temp.job('j3', ARRAY['b2']), 'a new job with active T2 works');
RESET ROLE;
SELECT is(pg_temp.cteams(pg_temp.rid('j1')), ARRAY['T1', 'T2'], 'J1 keeps inactive T1 + active T2');
SELECT ok(NOT EXISTS (SELECT 1 FROM contracts WHERE contract_no = 'J-j2'), 'refused job J2 was not saved');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT throws_ok($$INSERT INTO contract_teams (contract_id, team_id) VALUES (pg_temp.id('d1'), pg_temp.id('b1'))$$,
  'TM004', NULL, 'REST: admin cannot link inactive T1 to a contract (TM004)');
SELECT throws_ok($$INSERT INTO contract_teams (contract_id, team_id) VALUES (pg_temp.id('d1'), pg_temp.id('b9'))$$,
  'TM005', NULL, 'REST: admin cannot link a supervisor team to a contract (TM005)');
SELECT lives_ok($$INSERT INTO contract_teams (contract_id, team_id) VALUES (pg_temp.id('d1'), pg_temp.id('b2'))$$,
  'REST: admin links active T2 to a contract');
SELECT throws_ok($$UPDATE contract_teams SET team_id = pg_temp.id('b1') WHERE contract_id = pg_temp.id('d1')$$,
  'TM004', NULL, 'REST: admin cannot re-point a link to inactive T1 (TM004)');
SELECT throws_ok($$UPDATE contract_teams SET team_id = pg_temp.id('b9') WHERE contract_id = pg_temp.id('d1')$$,
  'TM005', NULL, 'REST: admin cannot re-point a link to a supervisor team (TM005)');
SELECT lives_ok($$INSERT INTO contract_teams (contract_id, team_id) VALUES (pg_temp.rid('j1'), pg_temp.id('b1')) ON CONFLICT DO NOTHING$$,
  'REST: re-sending an existing contract link to inactive T1 is not a new link');
RESET ROLE;

-- =====================================================================
-- 5. M26: INSERT สัญญาที่ผูกสัญญาเก่า — ผ่าน save_job_opening เท่านั้น
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT lives_ok(pg_temp.job('r1', ARRAY['b2'], false, 'renew', 'd0', '2027-01-01'), 'save_job_opening Renew (linked to d0) still works');
SELECT is((SELECT renewed_from_contract_id FROM contracts WHERE id = pg_temp.rid('r1')), pg_temp.id('d0'), 'and it is linked to d0');
SELECT is(current_setting('aga.job_opening', true), '', 'the job-opening GUC is cleared after the RPC');
-- ข้อมูลผ่านกฎอื่นทุกข้อ (ลูกค้าเดียวกัน · renew · อยู่ในช่วง 2 เดือน) → ติด AG015 เท่านั้น
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total, sale_type, renewed_from_contract_id)
                   VALUES (pg_temp.id('c1'), 'REST-R', '2027-01-15', 1, 24000, 'renew', pg_temp.id('d0'))$$,
  'AG015', 'a renewal contract can only be created through save_job_opening',
  'REST: admin cannot insert a Renew linked to an old contract (AG015)');
SELECT lives_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total, sale_type)
                  VALUES (pg_temp.id('c1'), 'REST-N', '2027-01-15', 1, 24000, 'new')$$,
  'REST: an insert without renewed_from is not affected');
SELECT pg_temp.as_user('a1');
-- ช่องเดิม (2.48 ①): ลบสัญญา Renew (ยังไม่มี visit) แล้วสร้างใหม่ชี้ลิงก์เดิม/ใหม่ ผ่าน REST
SELECT lives_ok($$DELETE FROM contracts WHERE id = pg_temp.rid('r1')$$, 'host deletes Renew r1 (no visits)');
SELECT throws_ok($$INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, sale_type, renewed_from_contract_id)
                   VALUES (pg_temp.rid('r1'), pg_temp.id('c1'), 'J-r1', '2027-01-01', 1, 24000, 'renew', pg_temp.id('d0'))$$,
  'AG015', NULL, 'REST: DELETE + INSERT to re-create a linked Renew is refused, even for host (AG015)');
-- ปลอม GUC ให้ id อื่น → ไม่ตรงกับ NEW.id → ยังติด
SELECT set_config('aga.job_opening', pg_temp.id('99')::text, true);
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total, sale_type, renewed_from_contract_id)
                   VALUES (pg_temp.id('c1'), 'REST-G', '2027-01-15', 1, 24000, 'renew', pg_temp.id('d0'))$$,
  'AG015', NULL, 'a GUC value for another row does not open the insert');
SELECT set_config('aga.job_opening', '', true);
-- M23 / M28 ยังทำงาน
SELECT lives_ok(pg_temp.job('u1', ARRAY['b2'], false, 'renew', NULL, '2027-02-01', 'สัญญาเก่าไม่อยู่ในระบบ'),
  'save_job_opening unlinked Renew (with reason) still works');
SELECT lives_ok($$SELECT * FROM public.link_renewal_contract(pg_temp.rid('u1'), pg_temp.id('d0'))$$,
  'M28 link_renewal_contract (UPDATE) still works after M26');
SELECT throws_ok($$UPDATE contracts SET renewed_from_contract_id = NULL WHERE id = pg_temp.rid('u1')$$,
  'AG009', NULL, 'M23 AG009 still locks the link after creation');
RESET ROLE;
SELECT is((SELECT renewed_from_contract_id FROM contracts WHERE id = pg_temp.rid('u1')), pg_temp.id('d0'), 'u1 is now linked to d0');

SET LOCAL ROLE service_role;
SELECT lives_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total, sale_type, renewed_from_contract_id)
                  VALUES (pg_temp.id('c1'), 'LEGACY-1', '2027-01-10', 1, 24000, 'renew', pg_temp.id('d0'))$$,
  'service_role (legacy import) can still insert a linked Renew');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
