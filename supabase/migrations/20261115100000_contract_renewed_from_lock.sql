-- M23 (DECISIONS 2.48 ① / แถว M23): ล็อกช่อง contracts.renewed_from_contract_id หลังสร้างสัญญา
--
-- ปัญหา: admin ใช้ PATCH ผ่าน REST แก้ช่อง "ต่อมาจากสัญญาไหน" ของสัญญาที่มีอยู่แล้วได้ → ทำให้เรื่องตกบริการ (M18)
--        ของสัญญาอื่นของลูกค้าเดียวกันถูกนับเป็น "ต่อแล้ว/โมฆะ" หรือถูกล็อกผิดๆ
--
-- กติกา (ตัดสินแล้ว):
--   * ช่องนี้กำหนดได้ "ตอนสร้างสัญญา" เท่านั้น (INSERT — save_job_opening โหมดเปิดงานใหม่ ส่ง p_renewed_from_contract_id)
--   * หลังสร้างแล้ว แก้ค่าไม่ได้ ทุกบทบาทที่ล็อกอิน (authenticated: host / admin / recorder) · ทั้งผ่าน REST ตรงๆ และผ่าน RPC
--
-- รหัส error: AG009 (ข้อความภาษาไทยให้หน้าจอแสดงได้เลย) — ต่อจาก AG001–AG008 ของ save_job_opening
--
-- ทำไมไม่ต้องแก้ save_job_opening:
--   * โหมดเปิดงานใหม่ = INSERT → trigger นี้ไม่ทำงาน (BEFORE UPDATE เท่านั้น)
--   * โหมดแก้ไขของ save_job_opening เขียน renewed_from_contract_id = p_renewed_from_contract_id ทุกครั้ง
--     - ส่งค่าเดิมกลับมา = ค่าไม่เปลี่ยน → ผ่าน (แก้ช่องอื่นของสัญญาที่ต่อแล้วได้ตามปกติ)
--     - ส่งค่าอื่น/ล้างเป็น NULL = ค่าเปลี่ยน → AG009
--   * ⚠️ หน้าจอแก้ไขเปิดงาน (FE) ต้องทำช่องนี้เป็น "อ่านอย่างเดียว" และส่งค่าเดิมของสัญญากลับมาเสมอ
--
-- ข้อยกเว้นที่ตั้งใจให้ผ่าน:
--   * current_user <> 'authenticated' (postgres / service_role / migration / pg_restore) — แนวเดียวกับ contracts_closed_guard
--   * ON DELETE SET NULL ของ FK (ลบสัญญาเก่าที่มีสัญญา Renew ผูกอยู่) — Postgres รัน action นี้ด้วยสิทธิ์เจ้าของตาราง
--     (current_user = postgres) จึงผ่านอัตโนมัติ · ไม่ต้องมีข้อยกเว้นเพิ่มใน trigger
--
-- trigger ที่อยู่บน contracts อยู่แล้ว (ไม่แตะ ไม่แทนที่):
--   contracts_cancelled_at_sync (M18) · contracts_closed_guard (M12) · contracts_renew_contract_lock (M15)
--   contracts_renewal_same_customer (M9) · ชื่อ trigger นี้ contracts_renewed_from_lock
--   (BEFORE UPDATE ทำงานเรียงตามตัวอักษร → ต่อท้ายสุด ไม่ขัดกับตัวอื่น)

CREATE FUNCTION public.contracts_renewed_from_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND NEW.renewed_from_contract_id IS DISTINCT FROM OLD.renewed_from_contract_id THEN
    RAISE EXCEPTION 'renewed_from_contract_id cannot be changed after the contract is created'
      USING ERRCODE = 'AG009',
            HINT = 'ช่อง "ต่อมาจากสัญญาไหน" กำหนดได้ตอนเปิดงานต่อสัญญาเท่านั้น แก้หลังสร้างไม่ได้ (ถ้าผูกผิด ให้แจ้งผู้ดูแลระบบ)';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.contracts_renewed_from_lock() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER contracts_renewed_from_lock
  BEFORE UPDATE OF renewed_from_contract_id ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_renewed_from_lock();
