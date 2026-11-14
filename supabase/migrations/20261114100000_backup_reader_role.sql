-- role `backup_reader` — บัญชีอ่านอย่างเดียวสำหรับงานสำรองข้อมูลอัตโนมัติ (DECISIONS 2.33,
-- docs/plans/2026-11-14-backup-and-usage-monitoring.md)
--
-- Logic summary:
--   * งานสำรองกลางคืน (GitHub Actions ใน repo ส่วนตัว AGA-Bait-Registry-backup) ต่อ DB
--     ด้วย role นี้ แทนการใช้รหัส `postgres` ตัวหลัก → ถ้ารหัสสำรองหลุด ก็แก้/ลบข้อมูลไม่ได้
--   * สร้างแบบ NOLOGIN และ **ไม่มีรหัสในไฟล์** — เจ้าของตั้งรหัสเองใน Supabase SQL Editor:
--       ALTER ROLE backup_reader LOGIN PASSWORD '<รหัสที่เจ้าของตั้งเอง>';
--     (ถ้าจะหยุดสำรอง/รหัสหลุด: ALTER ROLE backup_reader NOLOGIN; หรือเปลี่ยนรหัส)
--   * สิทธิ์ที่ให้ (ตรวจด้วยการรัน pg_dump จริงบน Supabase local แล้ว — ไม่ได้เดา):
--       1. pg_read_all_data  อ่านทุกตารางทุก schema ได้อย่างเดียว (public + auth + storage)
--          รวมตาราง/sequence ที่สร้างใหม่ในอนาคตอัตโนมัติ — ไม่ต้องมี default privileges
--          ทำไมไม่ GRANT SELECT รายตาราง: schema `auth` เป็นของ supabase_admin และ
--          `postgres` ไม่มีสิทธิ์ให้ USAGE ต่อ → ให้ backup_reader อ่าน auth.users ไม่ได้
--          (ได้ WARNING "no privileges were granted for auth") — pg_read_all_data เป็นทางเดียว
--          ที่ postgres ให้ต่อได้ (มี ADMIN OPTION) และ Supabase ใช้ role ตัวนี้กับ
--          supabase_read_only_user อยู่แล้ว
--       2. BYPASSRLS  จำเป็น — ทุกตารางเปิด RLS, pg_dump จะ error/ได้ 0 แถวถ้าไม่ข้าม RLS
--          (postgres บน Supabase มี BYPASSRLS จึงตั้งให้ role ใหม่ได้) · BYPASSRLS ไม่ให้สิทธิ์เขียน
--       3. อ่าน storage.objects ได้ (ใช้วัดพื้นที่ไฟล์ + รายการไฟล์สำรอง) — มากับ pg_read_all_data
--   * สิ่งที่ role นี้ทำไม่ได้: INSERT/UPDATE/DELETE/TRUNCATE, สร้างอะไร, เรียก RPC ที่เขียนข้อมูล
--     (function ใน public ถูกถอด EXECUTE จาก PUBLIC/anon ไปแล้ว — 20261111090500)
--   * ชั้นป้องกันเพิ่ม: default_transaction_read_only = on (ทุก session ที่ล็อกอินด้วย role นี้
--     เริ่มเป็น read-only) · CONNECTION LIMIT 3 · statement_timeout 15 นาที
--   * ⚠ ตรวจจริงในเครื่อง (14 พ.ย. 2026): role นี้อ่าน pg_authid (hash SCRAM ของทุก role รวม postgres) ได้ด้วย
--     เพราะ pg_read_all_data ถอดสิทธิ์รายตารางไม่ได้ → ตั้งรหัส postgres ให้ยาวสุ่ม · vault.decrypted_secrets ว่างตอนนี้
--     (ถ้าอนาคตเก็บ secret ใน Vault ต้องทบทวนเรื่องนี้)
--   * default_transaction_read_only ไม่ใช่กำแพงจริง (session สั่ง SET กลับได้) — กำแพงจริงคือ
--     ไม่มีสิทธิ์เขียนตาราง + ไม่มี EXECUTE บน function ที่เขียนข้อมูล (เทส 33 ตรวจ SECURITY DEFINER ทุกตัว)
--   * ความเสี่ยงที่ยอมรับ: role นี้อ่านข้อมูลลูกค้า + hash รหัสผ่านของ auth.users ได้ทั้งหมด
--     → รหัสผ่านต้องอยู่ใน GitHub Secrets ของ repo ส่วนตัวเท่านั้น และไฟล์สำรองต้องเข้ารหัสก่อนออกจากเครื่องรัน
--   * idempotent: รันซ้ำได้ ไม่ทำให้รหัส/สถานะ LOGIN ที่เจ้าของตั้งไว้หาย

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backup_reader') THEN
    CREATE ROLE backup_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
  END IF;
END
$$;

ALTER ROLE backup_reader CONNECTION LIMIT 3;
ALTER ROLE backup_reader SET default_transaction_read_only = on;
ALTER ROLE backup_reader SET statement_timeout = '15min';

GRANT pg_read_all_data TO backup_reader;

COMMENT ON ROLE backup_reader IS
  'อ่านอย่างเดียว สำหรับงานสำรองข้อมูลอัตโนมัติ (DECISIONS 2.33) — เจ้าของตั้งรหัสเองด้วย ALTER ROLE ... LOGIN PASSWORD';
