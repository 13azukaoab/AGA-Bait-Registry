-- M3: เลิกเก็บ audit ของ INSERT ใน visits / station_checks (DECISIONS 4.3, SPEC §6 audit_log, §8.2)
--
-- Logic summary:
--   * การกรอกผลบริการครั้งแรกเกิดทุกวันจำนวนมาก ถ้าลง audit_log ทุกแถว หน้าประวัติ
--     จะเต็มไปด้วยรายการ "กรอกปกติ" — เจ้าของตัดสินให้เก็บเฉพาะการแก้ (UPDATE) และ
--     การลบ (DELETE) ส่วน "ใครกรอกเมื่อไหร่" อ่านจาก created_by / created_at ของแถวเอง
--   * ปัญหาที่ต้องแก้ไปพร้อมกัน:
--       - visits.created_by ไม่มีค่า default → ถ้าแอปลืมส่ง จะไม่รู้ว่าใครกรอก
--       - station_checks ไม่มี created_by / created_at เลย
--     → เพิ่มคอลัมน์ให้ station_checks และใส่ trigger `stamp_created_by` ทั้ง 2 ตาราง:
--         INSERT : created_by = auth.uid() (ถ้ามีผู้ใช้ล็อกอิน) · created_at = now()
--                  ผู้ใช้ปลอมชื่อคนกรอกไม่ได้ · ถ้าไม่มีผู้ใช้ (service_role / นำเข้าข้อมูลเดิม)
--                  ใช้ค่าที่ส่งมา เพื่อให้นำเข้าข้อมูลย้อนหลังได้
--         UPDATE : ถ้ามีผู้ใช้ล็อกอิน คงค่า created_by / created_at เดิมไว้เสมอ
--   * trigger audit ของ 2 ตารางนี้สร้างใหม่เป็น AFTER UPDATE OR DELETE เท่านั้น
--     (ตารางอื่นยังเก็บ INSERT เหมือนเดิม)

-- ---------------------------------------------------------------------
-- 1. station_checks: เพิ่มคอลัมน์ผู้กรอก / เวลา
-- ---------------------------------------------------------------------
ALTER TABLE public.station_checks
  ADD COLUMN created_by uuid REFERENCES auth.users (id),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.visits         ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.station_checks ALTER COLUMN created_by SET DEFAULT auth.uid();

-- ---------------------------------------------------------------------
-- 2. trigger กันปลอม / กันแก้ผู้กรอก
-- ---------------------------------------------------------------------
CREATE FUNCTION public.stamp_created_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    -- service_role / งานนำเข้า: ใช้ค่าที่ส่งมา (เติม created_at ถ้าไม่มี)
    IF TG_OP = 'INSERT' AND NEW.created_at IS NULL THEN
      NEW.created_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_created_by() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stamp_created_by() FROM anon;
GRANT EXECUTE ON FUNCTION public.stamp_created_by() TO authenticated, service_role;

CREATE TRIGGER stamp_created_by
  BEFORE INSERT OR UPDATE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.stamp_created_by();
CREATE TRIGGER stamp_created_by
  BEFORE INSERT OR UPDATE ON public.station_checks
  FOR EACH ROW EXECUTE FUNCTION public.stamp_created_by();

-- ---------------------------------------------------------------------
-- 3. audit: เก็บเฉพาะ UPDATE / DELETE
-- ---------------------------------------------------------------------
DROP TRIGGER audit_visits ON public.visits;
DROP TRIGGER audit_station_checks ON public.station_checks;

CREATE TRIGGER audit_visits
  AFTER UPDATE OR DELETE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_station_checks
  AFTER UPDATE OR DELETE ON public.station_checks
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
