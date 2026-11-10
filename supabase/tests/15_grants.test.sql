-- GRANT ของ role API (anon / authenticated / service_role) — คู่กับ
-- migrations/20261110100000_grants_for_api_roles.sql
--
-- ทำไมต้องมีเทสชุดนี้: เทส RLS ชุดเดิม (08_rls.test.sql) รันด้วย role ที่มีสิทธิ์เต็ม
-- จึงจับไม่ได้ว่าตารางไม่ได้ GRANT ให้ role ของ API เลย — ตอนขึ้น cloud จริง
-- PostgREST เลยตอบ "permission denied for table ..." ทุกตาราง
BEGIN;
SELECT plan(11);

-- ตารางที่มีข้อมูลส่วนบุคคล + ตารางระบบ (anon ห้ามแตะ — PDPA, CLAUDE.md ข้อ 2)
CREATE TEMP VIEW protected_tables AS
SELECT unnest(ARRAY[
  'customers', 'contracts', 'contract_teams', 'stations', 'visits',
  'station_checks', 'profiles', 'audit_log', 'month_closures'
]) AS tbl;

-- ตารางทั้งหมดที่ authenticated/service_role ต้องเข้าถึงได้ (ยกเว้น audit_log ที่อ่านอย่างเดียว)
CREATE TEMP VIEW writable_tables AS
SELECT unnest(ARRAY[
  'zones', 'branches', 'teams', 'customer_types', 'tier_rules', 'positions',
  'profiles', 'customers', 'contracts', 'contract_teams', 'stations',
  'visits', 'station_checks', 'month_closures', 'monthly_branch_snapshots'
]) AS tbl;

-- ---------- anon ----------
SELECT is(
  (SELECT count(*) FROM protected_tables
     WHERE has_table_privilege('anon', 'public.' || tbl, 'SELECT'))::int,
  0,
  'anon ไม่มีสิทธิ์ SELECT ตารางข้อมูลส่วนบุคคล/ตารางระบบเลยสักตาราง');

SELECT is(
  (SELECT count(*) FROM unnest(ARRAY[
     'zones', 'branches', 'teams', 'customer_types', 'tier_rules', 'positions'
   ]) AS t(tbl)
     WHERE has_table_privilege('anon', 'public.' || tbl, 'SELECT'))::int,
  0,
  'anon ไม่มีสิทธิ์ SELECT ตารางอ้างอิง (ไม่มี policy ให้ anon อยู่แล้ว)');

SELECT ok(
  has_table_privilege('anon', 'public.monthly_branch_snapshots', 'SELECT'),
  'anon อ่าน monthly_branch_snapshots ได้ (ข้อมูล Dashboard สาธารณะ)');

SELECT ok(
  has_table_privilege('anon', 'public.v_branch_summary', 'SELECT'),
  'anon อ่าน v_branch_summary ได้');

SELECT ok(
  NOT has_table_privilege('anon', 'public.monthly_branch_snapshots', 'INSERT'),
  'anon เขียน monthly_branch_snapshots ไม่ได้');

-- ---------- authenticated ----------
SELECT is(
  (SELECT count(*) FROM writable_tables
     WHERE has_table_privilege('authenticated', 'public.' || tbl, 'SELECT')
       AND has_table_privilege('authenticated', 'public.' || tbl, 'INSERT')
       AND has_table_privilege('authenticated', 'public.' || tbl, 'UPDATE')
       AND has_table_privilege('authenticated', 'public.' || tbl, 'DELETE'))::int,
  15,
  'authenticated มีสิทธิ์ครบ 4 action ทั้ง 15 ตาราง (RLS เป็นตัวคุมจริง)');

SELECT ok(
  has_table_privilege('authenticated', 'public.audit_log', 'SELECT'),
  'authenticated อ่าน audit_log ได้ (RLS จำกัดให้เฉพาะ host)');

SELECT is(
  (SELECT count(*) FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS a(act)
     WHERE has_table_privilege('authenticated', 'public.audit_log', act))::int,
  0,
  'authenticated แก้/ลบ audit_log ไม่ได้ (เขียนผ่าน trigger SECURITY DEFINER เท่านั้น)');

-- ---------- service_role ----------
SELECT is(
  (SELECT count(*) FROM writable_tables
     WHERE has_table_privilege('service_role', 'public.' || tbl, 'SELECT')
       AND has_table_privilege('service_role', 'public.' || tbl, 'INSERT')
       AND has_table_privilege('service_role', 'public.' || tbl, 'UPDATE')
       AND has_table_privilege('service_role', 'public.' || tbl, 'DELETE'))::int,
  15,
  'service_role มีสิทธิ์ครบ 4 action ทั้ง 15 ตาราง (งานเบื้องหลัง/cron)');

SELECT ok(
  has_table_privilege('service_role', 'public.audit_log', 'INSERT'),
  'service_role เขียน audit_log ได้');

SELECT ok(
  has_table_privilege('service_role', 'public.v_branch_summary', 'SELECT'),
  'service_role อ่าน v_branch_summary ได้ (ใช้ส่ง Dashboard)');

SELECT * FROM finish();
ROLLBACK;
