-- M5: สถานะสอนใช้งานครั้งแรก (onboarding) ใน profiles (DECISIONS 8.6, SPEC §6 profiles)
--
-- Logic summary:
--   * 2 ช่องใหม่: onboarding_completed_at (ดูจนจบ) · onboarding_skipped_at (กดข้าม)
--     ทั้งคู่ NULL = ยังไม่เคยเห็น → แอปแสดงบทสอนตอน login ครั้งแรก
--   * ผู้ใช้ทั่วไปเขียน profiles ไม่ได้ (policy profiles_host_all ให้เฉพาะ host) จึงให้ตั้งค่า
--     ผ่าน function SECURITY DEFINER **ที่ไม่รับ parameter** — แพทเทิร์นเดียวกับ
--     touch_last_login (20261110120000):
--       - อ้างได้แต่ auth.uid() ของผู้เรียก → ตั้งค่าของคนอื่นไม่ได้
--       - แก้ได้แค่ช่องของตัวเอง ไม่แตะ role / is_active / division_scope / position_code
--       - เงื่อนไข AND is_active → บัญชีที่ถูกปิดเรียกแล้วไม่มีผล
--       - ไม่ล็อกอิน (auth.uid() = NULL) → ไม่มีแถวตรงเงื่อนไข → ไม่มีผล
--   * ดูจนจบแล้ว = ล้างค่า "ข้าม" ทิ้ง (สถานะสุดท้ายชัดเจน) · กดข้ามไม่ลบค่า "ดูจบ" ที่มีอยู่
--   * host เปิดบทสอนให้ใครดูใหม่ได้ด้วยการตั้งทั้ง 2 ช่องเป็น NULL (policy เดิมของ host)

ALTER TABLE public.profiles
  ADD COLUMN onboarding_completed_at timestamptz,
  ADD COLUMN onboarding_skipped_at   timestamptz;

CREATE FUNCTION public.complete_onboarding()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles
     SET onboarding_completed_at = now(),
         onboarding_skipped_at   = NULL
   WHERE user_id = auth.uid()
     AND is_active;
$$;

CREATE FUNCTION public.skip_onboarding()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles
     SET onboarding_skipped_at = now()
   WHERE user_id = auth.uid()
     AND is_active;
$$;

-- สิทธิ์: ผู้ล็อกอินเท่านั้น · REVOKE จาก anon ตรงตัว (default privileges ของ Supabase
-- ให้ EXECUTE กับ anon โดยตรง ไม่ได้ผ่าน PUBLIC — ดู 20261110120000)
REVOKE ALL ON FUNCTION public.complete_onboarding() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.skip_onboarding()     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_onboarding() FROM anon;
REVOKE ALL ON FUNCTION public.skip_onboarding()     FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.skip_onboarding()     TO authenticated, service_role;
