-- =====================================================================
-- M41 (DECISIONS 2.86 ก · ตาม 2.84 ข้อ 1): ระบุสัญญาที่มาจากการนำเข้าทะเบียน → ไม่ขึ้นรายการ "Renew ไม่ผูกสัญญาเก่า" (M28b)
--
-- ⚠ ไม่แตะ audit_trigger · ไม่แตะ save_job_opening · ไม่เปลี่ยน RLS ของตารางใด
--
-- สรุป logic (ทีมอ่านตรงนี้ก่อน):
--   1. คอลัมน์ใหม่ `contracts.import_batch text NULL`
--      * NULL = สัญญาที่เปิดในแอป (หน้าเปิดงาน) · มีค่า = นำเข้าจากทะเบียนเดิม (ตัวนำเข้าใส่ 'registry-OCT26')
--      * CHECK `contracts_import_batch_format`: 1–64 ตัว · ใช้ได้เฉพาะ A–Z a–z 0–9 . _ - (ไม่มีช่องว่าง / ไม่ว่าง)
--   2. ใครตั้ง/แก้ได้: เฉพาะ service_role (ตัวนำเข้า ผ่าน PostgREST) / postgres (migration · ผู้ดูแลฐานข้อมูล)
--      * trigger `contracts_zz_import_batch_guard` (BEFORE INSERT OR UPDATE):
--          current_user = 'authenticated' + INSERT ใส่ค่า (ไม่ NULL) หรือ UPDATE เปลี่ยนค่า (รวมล้างเป็น NULL) → AG020
--      * ทำไมไม่ใช้สิทธิ์รายคอลัมน์ (REVOKE UPDATE (import_batch)): Supabase ให้ authenticated มีสิทธิ์ INSERT/UPDATE
--        ระดับตาราง — REVOKE รายคอลัมน์ไม่มีผลเมื่อยังมีสิทธิ์ระดับตาราง จึงใช้ trigger (แพทเทิร์นเดียวกับ AG009/AG015/AG019)
--      * ชื่อขึ้นต้น `contracts_zz_` → BEFORE trigger (Postgres เรียงตามชื่อ) ทำงานหลังสุด
--        → error เดิม (P0001 / AG007 / AG009 / AG010–AG013 / AG015 / AG019) ยังชนะก่อนเหมือนเดิม เทสเก่าไม่ต้องแก้
--      * function SECURITY DEFINER ของแอป (save_job_opening, link_renewal_contract, close_unlinked_renewal ฯลฯ)
--        รันเป็น postgres จึงไม่ติดด่าน — แต่ไม่มีตัวไหนอ้างคอลัมน์นี้เลย (INSERT ระบุคอลัมน์ · ค่าเริ่มต้น NULL)
--        ⚠ function SECURITY DEFINER ในอนาคตที่เขียน contracts ห้ามรับค่า import_batch จากผู้ใช้
--   3. `list_unlinked_renewals` (M28b) — เนื้อล่าสุด 20261115230000 · เพิ่มเงื่อนไขเดียว `AND c.import_batch IS NULL`
--      signature / คอลัมน์ผลลัพธ์เดิม → CREATE OR REPLACE (สิทธิ์เดิมคงอยู่ · ใส่ REVOKE/GRANT ซ้ำเพื่อความชัด)
--   4. ทางอื่นที่เกี่ยวกับ "Renew ไม่ผูก" — คงเดิม (ตัดสินแล้ว):
--      * `link_renewal_contract` — ผูกสัญญานำเข้ากับสัญญาเก่าตัวจริงภายหลัง = ข้อมูลดีขึ้น ไม่มีเหตุให้ห้าม
--      * `close_unlinked_renewal` — ปิดรายการของสัญญานำเข้าไม่มีผลเสีย (ปกติไม่เห็นในรายการอยู่แล้ว)
--      * todo_support นับ New/Renew ด้วย `renewed_from_contract_id IS NULL` = กฎแยกประเภท (2.38 ค) ไม่ใช่รายการตรวจ
--      * ไม่มี view / ฟังก์ชันนับ badge อื่นในฐานข้อมูล · ป้าย "⚠ ยังไม่ผูก" ฝั่งหน้าจอคำนวณเองจาก REST → งาน FE แยก
--   * error ใหม่: AG020 แก้ช่อง import_batch ไม่ได้ (ข้อความไทยใน HINT)
-- =====================================================================

-- =====================================================================
-- 1. คอลัมน์ + CHECK
-- =====================================================================
ALTER TABLE public.contracts
  ADD COLUMN import_batch text;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_import_batch_format
    CHECK (import_batch IS NULL
           OR (char_length(import_batch) BETWEEN 1 AND 64
               AND import_batch ~ '^[A-Za-z0-9._-]+$'));

COMMENT ON COLUMN public.contracts.import_batch IS
  'M41 (DECISIONS 2.86): รหัสชุดนำเข้าจากทะเบียนเดิม (เช่น registry-OCT26) · NULL = เปิดในแอป · ตั้ง/แก้ได้เฉพาะ service_role/postgres (AG020) · มีค่า = ไม่ขึ้น list_unlinked_renewals';

-- =====================================================================
-- 2. trigger กันผู้ใช้ล็อกอินตั้ง/แก้ import_batch (REST)
-- =====================================================================
CREATE FUNCTION public.contracts_import_batch_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND ((TG_OP = 'INSERT' AND NEW.import_batch IS NOT NULL)
          OR (TG_OP = 'UPDATE' AND NEW.import_batch IS DISTINCT FROM OLD.import_batch)) THEN
    RAISE EXCEPTION 'import_batch can only be set by the registry importer'
      USING ERRCODE = 'AG020',
            HINT = 'ช่อง "ชุดนำเข้า" ตั้งได้เฉพาะตอนนำเข้าทะเบียนเดิมโดยระบบ แก้จากหน้าจอไม่ได้';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.contracts_import_batch_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER contracts_zz_import_batch_guard
  BEFORE INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_import_batch_guard();

-- =====================================================================
-- 3. list_unlinked_renewals — เนื้อเดิม 20261115230000 (M30b) · แก้จุดเดียวป้าย "M41"
-- =====================================================================
CREATE OR REPLACE FUNCTION public.list_unlinked_renewals(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  contract_id           uuid,
  contract_no           text,
  customer_id           uuid,
  customer_name         text,
  branch_id             uuid,
  start_date            date,
  end_date              date,
  status                public.contract_status,
  renew_unlinked_reason text,
  created_at            timestamptz,
  updated_at            timestamptz,
  term_months           integer                      -- M30
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role text := current_app_role();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin') THEN
    RAISE EXCEPTION 'not allowed to read unlinked renewals' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.contract_no, cu.id, cu.name, cu.branch_id, c.start_date, c.end_date,   -- M30b: ตัดคอลัมน์ปี
         c.status, c.renew_unlinked_reason, c.created_at, c.updated_at, c.term_months::int
    FROM contracts c
    JOIN customers cu ON cu.id = c.customer_id
   WHERE c.sale_type = 'renew' AND c.renewed_from_contract_id IS NULL
     AND c.unlinked_closed_at IS NULL                                    -- M28b: ปิดรายการแล้วไม่ต้องตรวจอีก
     AND c.import_batch IS NULL                                          -- M41: สัญญานำเข้าทะเบียนเดิมไม่ต้องตรวจ (2.84/2.86)
     AND (p_branch_id IS NULL OR cu.branch_id = p_branch_id)
     AND (v_role = 'host' OR branch_in_scope(cu.branch_id))
   ORDER BY c.created_at, c.id;
END;
$$;
REVOKE ALL ON FUNCTION public.list_unlinked_renewals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_unlinked_renewals(uuid) TO authenticated;
