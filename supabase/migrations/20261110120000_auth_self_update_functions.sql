-- ฟังก์ชันให้ผู้ใช้อัปเดต 2 ช่องของ "แถวตัวเอง" ในตาราง profiles ได้ (SPEC §5.1, §6)
-- เจ้าของอนุมัติ 10 พ.ย. 2026 (เลือกทางนี้แทนการใช้ service key ฝั่ง server)
--
-- Logic summary (เหตุผลที่ต้องมีไฟล์นี้):
--   * policy `profiles_select_own` (20261104100318) ให้ผู้ใช้ "อ่าน" แถวตัวเองได้
--     แต่ `profiles_host_all` ให้ "เขียน" ได้เฉพาะ host → ผู้ใช้ทั่วไปอัปเดต
--     `last_login` และ `must_change_password` ของตัวเองไม่ได้ ทั้งที่ขั้นตอน login
--     (SPEC §8 หน้า 1) ต้องเขียน 2 ช่องนี้
--   * ทางแก้: function `SECURITY DEFINER` 2 ตัวที่ **ไม่รับ parameter ใดๆ** จึงอ้างได้แต่
--     `auth.uid()` ของผู้เรียกเท่านั้น — ส่ง user_id ของคนอื่นเข้ามาไม่ได้
--   * แต่ละตัวแก้ได้ช่องเดียวตามชื่อ ไม่แตะ `role`, `is_active`, `division_scope`,
--     `position_code` → ยกระดับสิทธิ์ตัวเองผ่านทางนี้ไม่ได้
--   * เงื่อนไข `AND is_active` ทำให้บัญชีที่ถูกปิด (แต่ JWT ยังไม่หมดอายุ) เรียกแล้วไม่มีผล
--     สอดคล้องกับ helper `current_app_role()` / `is_host()` ที่มองข้ามบัญชีปิดอยู่แล้ว
--   * ไม่มีผู้ใช้ล็อกอิน (`auth.uid()` = NULL) → `user_id = NULL` เป็นเท็จทุกแถว → ไม่มีผล
--   * ตาราง `profiles` ไม่มี trigger ลง `audit_log` (ดู 20261104095756) การบันทึกเวลาเข้าใช้
--     จึงไม่ทำให้ประวัติรุงรัง · trigger `profiles_guard` ยังทำงานตามปกติ
--     (ไม่เข้าเงื่อนไขกัน host คนสุดท้าย เพราะไม่ได้แก้ role/is_active)
--   * ไม่มีตารางใหม่ในไฟล์นี้ แต่ตาม CLAUDE.md ยังต้องให้สิทธิ์ของตัวเองมาในไฟล์เดียวกัน
--     → REVOKE จาก PUBLIC แล้ว GRANT EXECUTE ให้ `authenticated` / `service_role`

-- ---------------------------------------------------------------------
-- 1. บันทึกเวลาเข้าใช้ล่าสุด — เรียกหลัง sign in สำเร็จ
-- ---------------------------------------------------------------------
CREATE FUNCTION public.touch_last_login()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles
     SET last_login = now()
   WHERE user_id = auth.uid()
     AND is_active;
$$;

-- ---------------------------------------------------------------------
-- 2. ปิดธง "ต้องเปลี่ยนรหัสผ่าน" — เรียกหลังผู้ใช้เปลี่ยนรหัสผ่านสำเร็จ
--    (ตั้งค่าเป็น true ได้เฉพาะ host ตอนสร้าง/รีเซ็ตบัญชี — ไม่มี function ให้ผู้ใช้ตั้งเอง)
-- ---------------------------------------------------------------------
CREATE FUNCTION public.complete_password_change()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles
     SET must_change_password = false
   WHERE user_id = auth.uid()
     AND is_active;
$$;

-- ---------------------------------------------------------------------
-- 3. สิทธิ์เรียกใช้ — ผู้ที่ล็อกอินแล้วเท่านั้น (anon เรียกไม่ได้)
--
--    ⚠ ทำไมต้อง REVOKE จาก `anon` ตรงๆ ไม่ใช่แค่ REVOKE FROM PUBLIC:
--      Supabase ตั้ง ALTER DEFAULT PRIVILEGES ของ role `postgres` ให้ EXECUTE บน
--      function ใหม่กับ anon/authenticated/service_role ไว้ — สิทธิ์นั้นเป็น grant
--      "ตรงตัวถึง anon" ไม่ใช่ผ่าน PUBLIC ฉะนั้น REVOKE FROM PUBLIC อย่างเดียวไม่พอ
--      (ตรวจพบตอนรัน `supabase test db` 10 พ.ย. 2026)
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.touch_last_login()          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_password_change()  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.touch_last_login()          FROM anon;
REVOKE ALL ON FUNCTION public.complete_password_change()  FROM anon;
GRANT EXECUTE ON FUNCTION public.touch_last_login()         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_password_change() TO authenticated, service_role;
