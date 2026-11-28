-- profiles.created_at — วันเปิดบัญชี (DECISIONS 2.114 · คอลัมน์ "วันเปิดบัญชี" หน้า /admin/users หลัง go-live)
--
-- Logic summary (สำหรับทีม):
--   1. คอลัมน์ใหม่ `profiles.created_at timestamptz NOT NULL DEFAULT now()`
--      * เพิ่มแบบ NULL ได้ก่อน → เติมค่าบัญชีเดิมจาก auth.users.created_at (จับคู่ user_id = id)
--        ไม่มีค่า (auth.users.created_at เป็น NULL) → now() ของตอนรัน migration
--      * แล้วค่อยตั้ง DEFAULT now() + NOT NULL
--      * การเติมค่าไม่ลง audit_log: trigger `audit_profiles_update` เก็บเฉพาะ 6 ช่อง (M21) ไม่รวม created_at
--        → อย่าเพิ่ม created_at เข้ารายการนั้น (ค่าแก้ไม่ได้อยู่แล้ว ไม่มีประวัติให้เก็บ)
--   2. ด่าน `profiles_created_at_guard` (BEFORE INSERT OR UPDATE) — แยกตัวใหม่ ไม่แทน profiles_guard /
--      profiles_owner_guard / audit_trigger
--      * เส้นทาง API (`is_api_session()` — anon / authenticated / service_role / authenticator /
--        supabase_auth_admin · รวม host และ server ที่ใช้ service key):
--          - INSERT: ไม่สนค่าที่ส่งมา บังคับ = now() (ส่งวันย้อนหลังมาไม่ได้)
--          - UPDATE ที่เปลี่ยน created_at → error PF001
--      * ไม่ใช่เส้นทาง API (ผู้ดูแลฐานข้อมูล / migration / role postgres) → ผ่าน (เช่นแก้ค่าที่เติมผิด)
--      * role ที่ไม่ใช่ host (admin / recorder / viewer / เจ้าตัว) แก้ profiles ตรงไม่ได้อยู่แล้ว
--        (RLS `profiles_host_all` · UPDATE ได้ 0 แถว ไม่ถึง trigger) — ด่านนี้กัน host + service_role
--      * RPC ที่แก้แถวตัวเอง (touch_last_login, onboarding) ไม่แตะ created_at → ไม่กระทบ
--   3. สิทธิ์อ่านเหมือนคอลัมน์อื่นของ profiles (ไม่มี column grant แยก): host อ่านทุกแถว ·
--      ผู้ใช้อื่นอ่านแถวตัวเอง · anon ไม่มีสิทธิ์

-- =====================================================================
-- 1. คอลัมน์ + เติมค่าบัญชีเดิม
-- =====================================================================
ALTER TABLE public.profiles
  ADD COLUMN created_at timestamptz;

UPDATE public.profiles p
   SET created_at = coalesce(u.created_at, now())
  FROM auth.users u
 WHERE u.id = p.user_id;

-- กันพลาด: แถวที่ไม่เจอ auth.users (ไม่ควรมี — FK cascade) ก็ยังได้ค่า
UPDATE public.profiles
   SET created_at = now()
 WHERE created_at IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

COMMENT ON COLUMN public.profiles.created_at IS
  'วันเปิดบัญชี · ระบบตั้งเองตอนสร้าง · เส้นทาง API แก้ไม่ได้ (PF001) · บัญชีเดิมเติมจาก auth.users.created_at (DECISIONS 2.114)';

-- =====================================================================
-- 2. ด่าน: created_at ระบบตั้งเองเท่านั้น
-- =====================================================================
CREATE FUNCTION public.profiles_created_at_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_api_session() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSIF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'profiles.created_at cannot be changed'
      USING ERRCODE = 'PF001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.profiles_created_at_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER profiles_created_at_guard
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_created_at_guard();
