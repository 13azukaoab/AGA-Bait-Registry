-- profiles.created_at (20261115380000 · DECISIONS 2.114): คอลัมน์ · เติมค่าเดิมจาก auth.users · ด่าน PF001
-- ผู้ใช้: a1 = PM (host) · a2 = แอดมิน (admin) · a3 = หัวหน้างาน (recorder) · a4 = viewer
--         a5 = บัญชีที่ผู้ดูแลฐานข้อมูลสร้างตรง (postgres) · a6 / a7 = บัญชีใหม่ที่สร้างผ่าน API
-- หมายเหตุ: admin / recorder / viewer แก้ profiles ตรงไม่ได้อยู่แล้ว (RLS profiles_host_all) → UPDATE ได้ 0 แถว
--          ไม่ error · ตรวจว่า "ค่าไม่เปลี่ยน" แทน · ด่าน PF001 กัน host + service_role (ผ่าน RLS ได้)
BEGIN;
SELECT plan(39);

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;

-- วันสร้างบัญชีฝั่ง GoTrue (a4 = NULL → ทดสอบค่าสำรอง now())
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at) VALUES
  (pg_temp.id('a1'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.local', '2026-01-05 09:00+07'),
  (pg_temp.id('a2'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2@test.local', '2026-02-10 10:30+07'),
  (pg_temp.id('a3'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a3@test.local', '2026-03-15 14:45+07'),
  (pg_temp.id('a4'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4@test.local', NULL),
  (pg_temp.id('a5'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a5@test.local', '2026-04-01 08:00+07'),
  (pg_temp.id('a6'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a6@test.local', '2026-05-01 08:00+07'),
  (pg_temp.id('a7'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a7@test.local', '2026-05-02 08:00+07');

INSERT INTO profiles (user_id, display_name, username, role, position_code) VALUES
  (pg_temp.id('a1'), 'PM',     'ag-00001', 'host',     'pm'),
  (pg_temp.id('a2'), 'Admin',  'ag-00002', 'admin',    'job_admin'),
  (pg_temp.id('a3'), 'Rec',    'ag-00003', 'recorder', 'supervisor'),
  (pg_temp.id('a4'), 'Viewer', 'ag-00004', 'viewer',   NULL);

-- =====================================================================
-- 1. โครงสร้างคอลัมน์ + ด่าน
-- =====================================================================
SELECT has_column('public', 'profiles', 'created_at', 'profiles.created_at exists');
SELECT col_type_is('public', 'profiles', 'created_at', 'timestamp with time zone', 'created_at is timestamptz');
SELECT col_not_null('public', 'profiles', 'created_at', 'created_at NOT NULL');
SELECT col_has_default('public', 'profiles', 'created_at', 'created_at has a default');
SELECT col_default_is('public', 'profiles', 'created_at', 'now()', 'created_at defaults to now()');
SELECT has_trigger('public', 'profiles', 'profiles_created_at_guard', 'guard trigger exists');
SELECT is((SELECT created_at FROM profiles WHERE user_id = pg_temp.id('a1')), now(),
  'row inserted without created_at gets now()');

-- =====================================================================
-- 2. เติมค่าบัญชีเดิม — เล่นซ้ำคำสั่งเดียวกับ migration บนแถวทดสอบ
--    (db reset รัน migration ตอนยังไม่มีแถว profiles จึงต้องจำลองในเทส)
-- =====================================================================
ALTER TABLE public.profiles ALTER COLUMN created_at DROP NOT NULL;
UPDATE public.profiles SET created_at = NULL
 WHERE user_id IN (pg_temp.id('a1'), pg_temp.id('a2'), pg_temp.id('a3'), pg_temp.id('a4'));
-- ↓ เหมือน migration ทุกตัวอักษร
UPDATE public.profiles p
   SET created_at = coalesce(u.created_at, now())
  FROM auth.users u
 WHERE u.id = p.user_id;
UPDATE public.profiles
   SET created_at = now()
 WHERE created_at IS NULL;
ALTER TABLE public.profiles ALTER COLUMN created_at SET NOT NULL;

SELECT results_eq(
  $$SELECT p.user_id, p.created_at FROM profiles p
     WHERE p.user_id IN (pg_temp.id('a1'), pg_temp.id('a2'), pg_temp.id('a3')) ORDER BY p.user_id$$,
  $$SELECT u.id, u.created_at FROM auth.users u
     WHERE u.id IN (pg_temp.id('a1'), pg_temp.id('a2'), pg_temp.id('a3')) ORDER BY u.id$$,
  'backfill: created_at = auth.users.created_at');
SELECT is((SELECT created_at FROM profiles WHERE user_id = pg_temp.id('a4')), now(),
  'backfill: auth.users.created_at NULL -> now()');
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE table_name = 'profiles' AND action = 'update'
              AND row_id IN (pg_temp.id('a1'), pg_temp.id('a2'), pg_temp.id('a3'), pg_temp.id('a4'))),
  0, 'backfill writes no audit rows (created_at not in audit_profiles_update list)');

-- ผู้ดูแลฐานข้อมูล (postgres) ตั้งค่าเองได้ ทั้งตอนสร้างและแก้
SELECT lives_ok($$INSERT INTO profiles (user_id, display_name, username, role, position_code, created_at)
                  VALUES (pg_temp.id('a5'), 'DBA', 'ag-00005', 'recorder', 'supervisor', '2025-12-31 12:00+07')$$,
  'postgres can insert with an explicit created_at');
SELECT is((SELECT created_at FROM profiles WHERE user_id = pg_temp.id('a5')), '2025-12-31 12:00+07'::timestamptz,
  'postgres explicit created_at is kept');
SELECT lives_ok($$UPDATE profiles SET created_at = '2025-12-30 12:00+07' WHERE user_id = pg_temp.id('a5')$$,
  'postgres can correct created_at');

-- =====================================================================
-- 3. host (เส้นทาง API) แก้ created_at ไม่ได้ · สร้างใหม่ = now() เสมอ
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

SELECT throws_ok($$UPDATE profiles SET created_at = '2000-01-01' WHERE user_id = pg_temp.id('a3')$$,
  'PF001', NULL, 'host cannot change another account''s created_at');
SELECT throws_ok($$UPDATE profiles SET created_at = '2000-01-01' WHERE user_id = pg_temp.id('a1')$$,
  'PF001', NULL, 'host cannot change own created_at');
SELECT throws_ok($$UPDATE profiles SET created_at = NULL WHERE user_id = pg_temp.id('a3')$$,
  'PF001', NULL, 'host cannot null created_at');
SELECT lives_ok($$UPDATE profiles SET display_name = 'Rec 2' WHERE user_id = pg_temp.id('a3')$$,
  'host can still edit other columns');
SELECT lives_ok($$UPDATE profiles SET created_at = created_at WHERE user_id = pg_temp.id('a3')$$,
  'host update that keeps created_at passes');
SELECT lives_ok($$INSERT INTO profiles (user_id, display_name, username, role, position_code, created_at)
                  VALUES (pg_temp.id('a6'), 'New', 'ag-00006', 'recorder', 'supervisor', '2001-01-01')$$,
  'host can create an account (createUser path)');
SELECT is((SELECT created_at FROM profiles WHERE user_id = pg_temp.id('a6')), now(),
  'host-supplied created_at is ignored on insert (= now())');
SELECT is((SELECT count(*)::int FROM profiles), 6, 'host still reads every profile');

-- =====================================================================
-- 4. service_role (server ที่ใช้ service key) ก็แก้ไม่ได้
-- =====================================================================
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE profiles SET created_at = '2000-01-01' WHERE user_id = pg_temp.id('a3')$$,
  'PF001', NULL, 'service_role cannot change created_at');
SELECT lives_ok($$INSERT INTO profiles (user_id, display_name, username, role, position_code, created_at)
                  VALUES (pg_temp.id('a7'), 'Svc', 'ag-00007', 'recorder', 'supervisor', '2001-01-01')$$,
  'service_role can create an account');
SELECT is((SELECT created_at FROM profiles WHERE user_id = pg_temp.id('a7')), now(),
  'service_role-supplied created_at is ignored on insert (= now())');

-- =====================================================================
-- 5. admin / recorder / viewer: RLS กันแก้ (0 แถว) · อ่านได้แค่แถวตัวเอง · RPC แถวตัวเองยังใช้ได้
-- =====================================================================
RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);  -- admin
SELECT lives_ok($$UPDATE profiles SET created_at = '2000-01-01'$$, 'admin UPDATE created_at is a silent no-op (RLS)');
SELECT is((SELECT count(*)::int FROM profiles), 1, 'admin reads only own profile');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);  -- recorder
SELECT lives_ok($$UPDATE profiles SET created_at = '2000-01-01' WHERE user_id = pg_temp.id('a3')$$,
  'recorder UPDATE own created_at is a silent no-op (RLS)');
SELECT lives_ok($$SELECT public.touch_last_login()$$, 'self RPC touch_last_login still works');
SELECT lives_ok($$SELECT public.complete_onboarding()$$, 'self RPC complete_onboarding still works');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);  -- viewer
SELECT lives_ok($$UPDATE profiles SET created_at = '2000-01-01'$$, 'viewer UPDATE created_at is a silent no-op (RLS)');
SELECT is((SELECT count(*)::int FROM profiles), 1, 'viewer reads only own profile (policy unchanged)');
SELECT is((SELECT created_at FROM profiles), now(), 'viewer reads own created_at');

RESET ROLE;
SELECT results_eq(
  $$SELECT p.user_id, p.created_at FROM profiles p
     WHERE p.user_id IN (pg_temp.id('a1'), pg_temp.id('a2'), pg_temp.id('a3')) ORDER BY p.user_id$$,
  $$SELECT u.id, u.created_at FROM auth.users u
     WHERE u.id IN (pg_temp.id('a1'), pg_temp.id('a2'), pg_temp.id('a3')) ORDER BY u.id$$,
  'created_at unchanged after every API attempt');
SELECT is((SELECT last_login IS NOT NULL FROM profiles WHERE user_id = pg_temp.id('a3')), true,
  'touch_last_login actually wrote last_login');

-- =====================================================================
-- 6. สิทธิ์ไม่เปลี่ยน
-- =====================================================================
SELECT ok(NOT has_table_privilege('anon', 'public.profiles', 'SELECT'), 'anon has no SELECT on profiles');
SELECT ok(NOT has_column_privilege('anon', 'public.profiles', 'created_at', 'SELECT'), 'anon cannot read created_at');
SELECT ok(has_column_privilege('authenticated', 'public.profiles', 'created_at', 'SELECT'),
  'authenticated may select created_at (RLS decides rows)');
SELECT ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT')
      AND has_table_privilege('authenticated', 'public.profiles', 'INSERT')
      AND has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
      AND has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  'authenticated table grants unchanged');
SELECT ok(NOT has_function_privilege('authenticated', 'public.profiles_created_at_guard()', 'EXECUTE'),
  'guard function not executable by authenticated');

SELECT * FROM finish();
ROLLBACK;
