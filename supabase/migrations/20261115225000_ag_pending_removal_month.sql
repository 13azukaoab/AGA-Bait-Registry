-- =====================================================================
-- M35 ② — เดือนที่กล่องเข้าสถานะ "รอถอด" (stations.pending_removal_month) สำหรับหน้า /todo
--        (DECISIONS M35 · เจ้าของเลือกแบบ ก — ผ่านหมวด 2 · 17 พ.ย. 2026)
--
-- สรุป logic (ทีมอ่านตรงนี้ก่อน):
--   * คอลัมน์ใหม่ stations.pending_removal_month (date · วันที่ 1 ของเดือน · NULL = ไม่เคย/ไม่ได้รอถอด)
--   * ระบบตั้งเองด้วย trigger `stations_pending_removal_month` ทุกทางที่เปลี่ยนสถานะ (RPC, REST, migration):
--       - เข้า pending_removal ผ่านหน้าบันทึกบริการ (save_service_visit เปิด GUC aga.service_visit = id การเข้า)
--           → เดือนของ "วันที่เข้าบริการ" (visits.visit_date) ไม่ใช่วันที่กดบันทึก
--       - เข้า pending_removal ทางอื่น (host/admin แก้ตรง ฯลฯ) → เดือนปัจจุบันเวลาไทย
--       - กลับเป็น active → ล้างเป็น NULL
--       - ถอดแล้ว (removed) / สถานะปิดอื่น (eliminated / lost / withdrawn) → เก็บค่าเดิมไว้เป็นประวัติ
--       - ยกเลิกการถอด (removed → pending_removal ตอนลบการเข้า) และมีค่าเดิม → ใช้ค่าเดิม (ไม่เริ่มนับใหม่)
--       - สถานะไม่เปลี่ยน → ค่าเดิมเสมอ (ผู้ใช้ authenticated เขียนคอลัมน์นี้ตรงๆ ไม่ได้ — ระบบเขียนทับคืน)
--       - ผู้ใช้ระบบ (postgres / service_role / SECURITY DEFINER) ตั้งค่าเองได้ (นำเข้าข้อมูล / backfill)
--   * ไม่แทนที่ save_service_visit: GUC aga.service_visit (ตั้งเป็น visit id ก่อนขั้นอัปเดตสถานะ · ล้างตอนจบ)
--     มีอยู่แล้วตั้งแต่ M15 → trigger อ่าน visit_date เองได้ · ผู้ใช้ REST ตั้ง GUC เองไม่ได้ (PostgREST ไม่เปิด set_config)
--   * ข้อจำกัด: แก้ "วันที่เข้า" ของการเข้าเดิมทีหลัง โดยสถานะกล่องไม่เปลี่ยน → เดือนไม่ขยับตาม (ตั้งครั้งเดียวตอนเปลี่ยนสถานะ)
--   * อ่าน: ตาม RLS เดิมของ stations (host / admin / recorder · viewer / anon มองไม่เห็นตาราง — PDPA) · ไม่มี RPC ใหม่
--   * backfill (ข้อ 3): จาก audit_log แถวล่าสุดที่สถานะเปลี่ยนเข้า pending_removal (เดือนของ changed_at เวลาไทย)
--       ไม่พบ + ตอนนี้รอถอดอยู่ → เดือนของ updated_at · ไม่พบ + สถานะอื่น → NULL
--       UPDATE เฉพาะแถวที่ได้ค่า (ไม่แตะแถวอื่น) · ไม่แตะ updated_at (stations ไม่มี trigger ตั้ง updated_at สำหรับ postgres)
--       audit_stations ยังทำงานตามปกติ (CLAUDE ข้อ 7: ทุกการแก้ลง audit_log) → 1 แถว audit ต่อสถานีที่ backfill
--       changed_by = NULL (= migration) · old/new ต่างกันแค่ pending_removal_month — ไม่ได้ปิด trigger audit
--   * ไม่แตะ audit_trigger · RLS ของ stations คงเดิม · error ใหม่: ไม่มี
-- =====================================================================

-- =====================================================================
-- 1. คอลัมน์
-- =====================================================================
ALTER TABLE public.stations
  ADD COLUMN pending_removal_month date,
  ADD CONSTRAINT stations_pending_removal_month_first_day
    CHECK (pending_removal_month IS NULL OR pending_removal_month = date_trunc('month', pending_removal_month)::date);

COMMENT ON COLUMN public.stations.pending_removal_month IS
  'M35: เดือนที่กล่องเข้าสถานะรอถอด (วันที่ 1) · ผ่านบันทึกบริการ = เดือนของวันเข้า · ทางอื่น = เดือนปัจจุบัน (ไทย) · active = NULL · ถอดแล้ว = เก็บไว้ · ระบบตั้งเอง (trigger stations_pending_removal_month)';

-- =====================================================================
-- 2. trigger
-- =====================================================================
CREATE FUNCTION public.stations_pending_removal_month()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_visit  text := coalesce(current_setting('aga.service_visit', true), '');
  v_month  date;
BEGIN
  -- ผู้ใช้ระบบ (ไม่ใช่ authenticated) ส่งค่ามาเอง → เชื่อค่านั้น (นำเข้า / backfill)
  IF current_user <> 'authenticated'
     AND ((TG_OP = 'INSERT' AND NEW.pending_removal_month IS NOT NULL)
          OR (TG_OP = 'UPDATE' AND NEW.pending_removal_month IS DISTINCT FROM OLD.pending_removal_month)) THEN
    RETURN NEW;
  END IF;

  -- สถานะไม่เปลี่ยน → ค่าเดิม (กันผู้ใช้เขียนคอลัมน์นี้ตรง)
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    NEW.pending_removal_month := OLD.pending_removal_month;
    RETURN NEW;
  END IF;

  IF NEW.status = 'pending_removal' THEN
    IF TG_OP = 'UPDATE' AND OLD.status <> 'active' AND OLD.pending_removal_month IS NOT NULL THEN
      -- ยกเลิกการถอด (removed → pending_removal) → เดือนเดิม
      NEW.pending_removal_month := OLD.pending_removal_month;
    ELSE
      IF v_visit ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT date_trunc('month', vi.visit_date)::date INTO v_month
          FROM visits vi WHERE vi.id = v_visit::uuid;
      END IF;
      NEW.pending_removal_month := coalesce(v_month, date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date);
    END IF;
  ELSIF NEW.status = 'active' THEN
    NEW.pending_removal_month := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.pending_removal_month := OLD.pending_removal_month;     -- ถอดแล้ว / สถานะปิดอื่น: เก็บเป็นประวัติ
  ELSE
    NEW.pending_removal_month := NULL;                          -- INSERT สถานะอื่นโดยผู้ใช้: ไม่มีประวัติ
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stations_pending_removal_month() FROM PUBLIC, anon, authenticated;

-- ทุก UPDATE (ไม่ใช่เฉพาะ OF status) เพื่อเขียนทับคืนเมื่อผู้ใช้แก้คอลัมน์นี้ตรง
CREATE TRIGGER stations_pending_removal_month
  BEFORE INSERT OR UPDATE ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.stations_pending_removal_month();

-- =====================================================================
-- 3. backfill (postgres · trigger ข้อ 2 เชื่อค่าที่ระบบส่ง · audit_stations ทำงานปกติ)
-- =====================================================================
WITH last_pending AS (
  SELECT DISTINCT ON (a.row_id)
         a.row_id AS station_id,
         date_trunc('month', (a.changed_at AT TIME ZONE 'Asia/Bangkok'))::date AS m
    FROM public.audit_log a
   WHERE a.table_name = 'stations'
     AND a.new_data ->> 'status' = 'pending_removal'
     AND coalesce(a.old_data ->> 'status', '') <> 'pending_removal'
   ORDER BY a.row_id, a.changed_at DESC
), src AS (
  SELECT s.id,
         coalesce(lp.m,
                  CASE WHEN s.status = 'pending_removal'
                       THEN date_trunc('month', (s.updated_at AT TIME ZONE 'Asia/Bangkok'))::date END) AS m
    FROM public.stations s
    LEFT JOIN last_pending lp ON lp.station_id = s.id
   WHERE s.status <> 'active'
)
UPDATE public.stations s
   SET pending_removal_month = src.m
  FROM src
 WHERE s.id = src.id AND src.m IS NOT NULL;
