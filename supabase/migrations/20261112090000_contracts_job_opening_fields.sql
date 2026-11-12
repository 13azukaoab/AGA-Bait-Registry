-- M9: ช่องเปิดงานใน contracts ให้ตรง mockup เปิดงาน FINAL (เจ้าของอนุมัติ 12 พ.ย. 2026)
--
-- Logic summary:
--   * คอลัมน์ใหม่ 6 ตัว (ไม่กระทบสูตร Tier / เดือนบริการ / snapshot):
--       is_urgent                boolean NOT NULL DEFAULT false  เบิกด่วน
--       renewed_from_contract_id uuid → contracts(id) ON DELETE SET NULL
--                                ผูกสัญญาเก่าตอน Renew · ห้ามชี้ตัวเอง
--       mail_received_date       date      วันที่รับ Mail
--       first_service_date       date      นัดบริการครั้งแรก (ว่าง = "รอนัดบริการ")
--       first_service_time       time      เวลาไทย ไม่ใช้ timestamptz · มีเวลาต้องมีวันที่
--       note                     text      หมายเหตุสัญญา
--   * ตำแหน่งผู้ขาย Sale / AM: ไม่เพิ่มคอลัมน์ ใช้ sale_name / am_name เดิม (แอปเลือกช่องเอง)
--   * Renew = ลูกค้าคนเดิม (กันนับลูกค้าซ้ำบน Dashboard — SPEC §14 ข้อ 4) บังคับด้วย trigger
--     `contracts_renewal_same_customer` ทั้ง 2 ทาง:
--       - สัญญาใหม่ผูกสัญญาเก่าที่ลูกค้าคนละคน → ปฏิเสธ
--       - เปลี่ยนลูกค้าของสัญญาเก่าที่มีสัญญาอื่นผูกอยู่ (หรือของสัญญาใหม่) จนไม่ตรงกัน → ปฏิเสธ
--     SECURITY DEFINER + search_path ตายตัว: ตรวจได้แม้ผู้ใช้มองไม่เห็นสัญญาเก่าตาม RLS
--     ข้อความ error เป็นข้อความกลางๆ ไม่บอก id / ลูกค้า / เลขสัญญาของสัญญาอื่น (P0001)
--     สัญญาเก่าที่ไม่มีอยู่จริง → ปล่อยให้ foreign key ปฏิเสธเอง (23503)
--     ไม่บังคับว่า sale_type = 'renew' ต้องมีค่า (ข้อมูลเก่า)
--   * สิทธิ์: RLS ของ contracts เป็นระดับแถว ครอบคอลัมน์ใหม่อยู่แล้ว · GRANT ของ contracts เป็น
--     ระดับตาราง (20261110100000) ครอบคอลัมน์ใหม่อัตโนมัติ ไม่มี GRANT รายคอลัมน์ที่ต้องเพิ่ม ·
--     anon ไม่มีสิทธิ์บนตาราง contracts (PDPA)
--   * audit: trigger audit_contracts เดิมเก็บทั้งแถว (to_jsonb) → แก้คอลัมน์ใหม่ลง audit_log เอง

-- =====================================================================
-- 1. คอลัมน์ + constraint
-- =====================================================================
ALTER TABLE public.contracts
  ADD COLUMN is_urgent                boolean NOT NULL DEFAULT false,
  ADD COLUMN renewed_from_contract_id uuid
    REFERENCES public.contracts (id) ON DELETE SET NULL,
  ADD COLUMN mail_received_date       date,
  ADD COLUMN first_service_date       date,
  ADD COLUMN first_service_time       time,
  ADD COLUMN note                     text;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_not_renewed_from_itself
    CHECK (renewed_from_contract_id IS NULL OR renewed_from_contract_id <> id),
  ADD CONSTRAINT contracts_first_service_time_needs_date
    CHECK (first_service_time IS NULL OR first_service_date IS NOT NULL);

CREATE INDEX contracts_renewed_from_contract_id_idx
  ON public.contracts (renewed_from_contract_id);

-- =====================================================================
-- 2. Renew = ลูกค้าคนเดิม
-- =====================================================================
CREATE FUNCTION public.contracts_renewal_same_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_customer uuid;
BEGIN
  -- สัญญานี้ผูกสัญญาเก่า → สัญญาเก่าต้องเป็นของลูกค้าคนเดียวกัน
  IF NEW.renewed_from_contract_id IS NOT NULL THEN
    SELECT c.customer_id INTO v_old_customer
      FROM public.contracts c
     WHERE c.id = NEW.renewed_from_contract_id;
    -- ไม่พบ = foreign key จะปฏิเสธเอง
    IF FOUND AND v_old_customer IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'a renewal must link to a contract of the same customer'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- เปลี่ยนลูกค้าของสัญญาที่ถูกสัญญาอื่นผูกไว้ → ต้องยังตรงกันทุกตัว
  IF TG_OP = 'UPDATE' AND NEW.customer_id IS DISTINCT FROM OLD.customer_id
     AND EXISTS (SELECT 1 FROM public.contracts r
                  WHERE r.renewed_from_contract_id = NEW.id
                    AND r.customer_id IS DISTINCT FROM NEW.customer_id) THEN
    RAISE EXCEPTION 'a renewal must link to a contract of the same customer'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.contracts_renewal_same_customer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contracts_renewal_same_customer() FROM anon;

CREATE TRIGGER contracts_renewal_same_customer
  BEFORE INSERT OR UPDATE OF renewed_from_contract_id, customer_id ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_renewal_same_customer();
