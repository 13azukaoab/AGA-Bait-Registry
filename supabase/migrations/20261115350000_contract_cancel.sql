-- =====================================================================
-- M44 ยกเลิกสัญญา + เปิดกลับ (DECISIONS 2.97 · เจ้าของ 20 พ.ย. 2026)
--
-- ⚠ ไม่แตะ audit_trigger (ใช้ audit_contracts เดิม — เหตุผล/ผู้กดอยู่ในคอลัมน์ของ contracts จึงลง audit_log เอง)
--   ไม่แทนที่ฟังก์ชัน/trigger เดิมตัวใด · ไม่แตะ contracts_closed_guard (AG007) · ไม่แตะ lib/rules
--
-- สรุป logic (ทีมอ่านตรงนี้ก่อน):
--   1. คอลัมน์ใหม่บน contracts (ลง audit_log ผ่าน audit_contracts เดิม):
--        cancel_reason_code ('entry_error' ลงข้อมูลผิด | 'customer_cancelled' ลูกค้ายกเลิกจริง | 'other' อื่นๆ)
--        cancel_reason (≤ 500) · cancelled_by (ไม่ใส่ FK — แบบ unlinked_closed_by)
--        reopened_at / reopened_by / reopen_reason (≤ 500) = การเปิดกลับครั้งล่าสุด (ประวัติเต็มอยู่ใน audit_log)
--      * CHECK: ช่องยกเลิกมีค่าได้เฉพาะตอน status = 'cancelled' · สัญญายกเลิกเดิม (ก่อน M44) ไม่มีเหตุผลได้
--        · ช่องเปิดกลับ at/by/reason มาครบชุด
--   2. RPC (SECURITY DEFINER · ตรวจสิทธิ์เองตามลำดับ role → ขอบเขต → ข้อมูล แบบ pause_contract):
--      `cancel_contract(p_contract_id, p_reason_code, p_reason)` → (contract_id, status, cancelled_at, updated_at)
--        * host ทุกสาขา · admin เฉพาะ contract_in_scope · recorder / viewer / anon → 42501
--        * มีผลวันที่กด: cancelled_at = now() (ไม่รับวันย้อนหลัง — ลูกค้าแจ้งช้าให้เขียนวันจริงในเหตุผล)
--        * ยกเลิกได้เฉพาะ active / paused ที่ยังไม่เลยวันสิ้นสุด (contract_effective_end_date ≥ วันนี้ ไทย)
--          (ระบบไม่เปลี่ยนเป็น expired เอง สัญญาเลยวันสิ้นสุดหลายรายยังเป็น active → ต้องเช็กวันที่ด้วย)
--        * สัญญาที่ถูก Renew ต่อแล้ว (มีสัญญาใหม่ที่ไม่ยกเลิกผูกอยู่) ยกเลิกไม่ได้ → ให้ยกเลิกสัญญาใหม่แทน
--        * ยกเลิกตัว Renew ได้: สัญญาเก่ากลับเป็น "ยังไม่ต่อ" เอง (contract_is_renewed / lib/rules ไม่นับ Renew ที่ยกเลิก)
--        * ยกเลิกระหว่างพัก: trigger M29 `contracts_pause_close_on_cancel` ปิดช่วงพัก end_kind = 'cancelled' ให้เอง
--        * สถานี: ไม่แตะ — IG ที่ยังไม่เก็บขึ้น "รอเก็บสถานี" เอง (v_contract_ig_collection ไม่กรองสถานะ ·
--          หน้า /todo นับสัญญาไม่ active = จบ · ig_collection_apply ใช้ cancelled_at เป็นวันแรกที่เก็บได้)
--          IC / กล่อง AG ไม่อยู่ในรายการเก็บอยู่แล้ว (§7.8) · เปิดกลับแล้วสถานีอยู่ครบเหมือนเดิม
--        * ยอดรายเดือน: lib/rules (snapshot / missedService) ตัดตั้งแต่เดือนของ cancelled_at อยู่แล้ว ·
--          ไม่มี trigger คำนวณ snapshot ใหม่ → เดือนที่ปิดแล้วคงค่าเดิมจนสั่งคำนวณใหม่ (กฎ 7)
--      `reopen_contract(p_contract_id, p_reason)` → (contract_id, status, updated_at)
--        * host ทุกสาขา · admin เฉพาะ contract_in_scope · อื่นๆ 42501 · ต้องมีเหตุผล
--        * ยกเลิกในเดือนที่ปิดแล้วก็เปิดกลับได้ ทั้ง host และ admin (เจ้าของ 20 พ.ย. 2026) · snapshot เดือนที่ปิดคงเดิม
--        * มี IG ที่เก็บแล้ว / กด "ไม่เก็บ" แล้ว → เปิดกลับไม่ได้ (สถานีออกจากพื้นที่แล้ว ให้ host แก้สถานีก่อน)
--        * ตัว Renew ที่สัญญาเก่ามี Renew ตัวอื่น (ไม่ยกเลิก) แล้ว → เปิดกลับไม่ได้ (กัน 1 สัญญาเก่ามี 2 Renew)
--        * กฎ Renew ของ M28 ตรวจซ้ำในตัว RPC (trigger contracts_renewed_gap_guard ข้ามเมื่อรันเป็นเจ้าของ):
--          Renew ผูกสัญญาเก่าที่เริ่มเกิน 2 เดือนหลังสัญญาเก่าจบ → AG010 · Renew ไม่ผูก: ไม่มีเหตุผล → AG012 ·
--          เลยวันที่เปิด Renew ไม่ผูกได้ (allow_unlinked_renew_until) → AG013 — รหัสเดียวกับที่ REST เคยได้ตอน host un-cancel
--        * สถานะที่ได้: ยกเลิกระหว่างพัก (ช่วงพักล่าสุด end_kind = 'cancelled') → 'paused'
--          (trigger M29 `contracts_pause_status_guard` เปิดช่วงพักเดิมคืนให้) · อื่นๆ → 'active'
--        * ล้าง cancelled_at + ช่องยกเลิก · บันทึก reopened_at/by/reason
--        * ผลตามมา: เดือนช่วงที่ยกเลิกไม่มี routine → ขึ้นตกบริการตามปกติ (ตัดสินชดเชย/ไม่ชดเชย)
--      * ถือคิวเดียวกับ save_service_visit / pause_contract (advisory lock ต่อสัญญา) + FOR UPDATE แถวสัญญา
--      * ทำไมไม่ต้องใช้ GUC: RPC รันเป็นเจ้าของ (SECURITY DEFINER) → ด่านที่เช็ก current_user = 'authenticated'
--        (AG007 / AG009 / AG019 / AG020 / CC009) ไม่ทำงานใน RPC · ผู้ใช้ยิง REST ตรงยังโดนครบ
--   3. ด่าน REST `contracts_status_cancel_guard` (BEFORE INSERT OR UPDATE · ไม่ระบุ OF คอลัมน์ — แบบ M23):
--      ผู้ใช้ล็อกอินทุก role (รวม host) เปลี่ยนสถานะ เข้า/ออก 'cancelled' · แก้ cancelled_at · แก้ช่องยกเลิก/เปิดกลับ
--      ตรงไม่ได้ → CC009 (ต้องใช้ RPC — บังคับเหตุผล + ไม่ย้อนวัน)
--      * ชื่อ "contracts_s…" → BEFORE trigger เรียงหลัง contracts_closed_guard (AG007 ชนะก่อน · admin แก้สัญญายกเลิก
--        ผ่าน REST ยังได้ AG007) และหลัง contracts_pause_status_guard (CP008) · ก่อน contracts_zz_import_batch_guard
--      * host ยังแก้ช่องอื่นของสัญญาที่ยกเลิกแล้วได้ตามเดิม (AG007 อนุญาต host)
--      * สถานะออกจาก cancelled (ทางระบบ เช่น postgres) → ล้างช่องยกเลิกให้เอง (กัน CHECK ล้ม)
--   * error ใหม่ (ข้อความไทยใน HINT ให้หน้าจอแสดงได้ตรง):
--     CC001 เหตุผลว่าง/ยาวเกิน · CC002 ประเภทเหตุผลไม่ถูกต้อง · CC003 ยกเลิกไปแล้ว · CC004 สัญญาจบแล้ว (ปิด/หมดอายุ)
--     · CC005 สัญญาต่อแล้ว ให้ยกเลิกสัญญาใหม่ · CC006 สัญญาไม่ได้ยกเลิก (เปิดกลับ)
--     · CC007 มี IG เก็บแล้ว เปิดกลับไม่ได้ · CC008 สัญญาเก่ามี Renew ตัวอื่นแล้ว · CC009 แก้ตรงไม่ได้ ต้องใช้ปุ่ม
--     · (เดิม) 42501 ไม่มีสิทธิ์ · 22004 ไม่ส่ง contract_id · AG004 ไม่พบสัญญา
--     · (เดิม · ตอนเปิดกลับ Renew) AG010 เกินช่วง 2 เดือน · AG012 Renew ไม่ผูกไม่มีเหตุผล · AG013 เลยวันกำหนด Renew ไม่ผูก
--   * เทส: supabase/tests/61_contract_cancel.test.sql
-- =====================================================================

-- =====================================================================
-- 1. คอลัมน์ + CHECK
-- =====================================================================
ALTER TABLE public.contracts
  ADD COLUMN cancel_reason_code text,
  ADD COLUMN cancel_reason      text,
  ADD COLUMN cancelled_by       uuid,
  ADD COLUMN reopened_at        timestamptz,
  ADD COLUMN reopened_by        uuid,
  ADD COLUMN reopen_reason      text;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_cancel_reason_code_check
    CHECK (cancel_reason_code IS NULL OR cancel_reason_code IN ('entry_error', 'customer_cancelled', 'other')),
  ADD CONSTRAINT contracts_cancel_fields_only_when_cancelled
    CHECK (status = 'cancelled'
           OR (cancel_reason_code IS NULL AND cancel_reason IS NULL AND cancelled_by IS NULL)),
  ADD CONSTRAINT contracts_cancel_reason_length
    CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 500),
  ADD CONSTRAINT contracts_reopen_fields_check
    CHECK ((reopened_at IS NULL AND reopened_by IS NULL AND reopen_reason IS NULL)
           OR (reopened_at IS NOT NULL AND reopened_by IS NOT NULL AND reopen_reason IS NOT NULL
               AND char_length(reopen_reason) <= 500));

COMMENT ON COLUMN public.contracts.cancel_reason_code IS
  'M44: ประเภทเหตุผลยกเลิก entry_error (ลงข้อมูลผิด) | customer_cancelled (ลูกค้ายกเลิกจริง) | other · ตั้งผ่าน cancel_contract() เท่านั้น · สัญญายกเลิกก่อน M44 = NULL';
COMMENT ON COLUMN public.contracts.cancel_reason IS
  'M44: เหตุผลที่ยกเลิก (≤ 500) · ตั้งผ่าน cancel_contract() เท่านั้น · ล้างเมื่อเปิดกลับ (ค่าเดิมอยู่ใน audit_log)';
COMMENT ON COLUMN public.contracts.cancelled_by IS
  'M44: auth.users.id ของผู้กดยกเลิก (ไม่ใส่ FK — ประวัติเต็มใน audit_log)';
COMMENT ON COLUMN public.contracts.reopened_at IS
  'M44: เวลาเปิดกลับครั้งล่าสุด (reopen_contract) · ครั้งก่อนๆ ดูใน audit_log';
COMMENT ON COLUMN public.contracts.reopened_by IS
  'M44: auth.users.id ของผู้เปิดกลับครั้งล่าสุด (ไม่ใส่ FK)';
COMMENT ON COLUMN public.contracts.reopen_reason IS
  'M44: เหตุผลเปิดกลับครั้งล่าสุด (≤ 500)';

-- =====================================================================
-- 2. ด่าน REST: เข้า/ออกสถานะยกเลิก + ช่องยกเลิก/เปิดกลับ ต้องผ่าน RPC (ทุก role ที่ล็อกอิน)
-- =====================================================================
CREATE FUNCTION public.contracts_status_cancel_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_touch boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_touch := NEW.status = 'cancelled' OR NEW.cancelled_at IS NOT NULL
               OR NEW.cancel_reason_code IS NOT NULL OR NEW.cancel_reason IS NOT NULL OR NEW.cancelled_by IS NOT NULL
               OR NEW.reopened_at IS NOT NULL OR NEW.reopened_by IS NOT NULL OR NEW.reopen_reason IS NOT NULL;
  ELSE
    v_touch := (NEW.status = 'cancelled') IS DISTINCT FROM (OLD.status = 'cancelled')
               OR NEW.cancelled_at       IS DISTINCT FROM OLD.cancelled_at
               OR NEW.cancel_reason_code IS DISTINCT FROM OLD.cancel_reason_code
               OR NEW.cancel_reason      IS DISTINCT FROM OLD.cancel_reason
               OR NEW.cancelled_by       IS DISTINCT FROM OLD.cancelled_by
               OR NEW.reopened_at        IS DISTINCT FROM OLD.reopened_at
               OR NEW.reopened_by        IS DISTINCT FROM OLD.reopened_by
               OR NEW.reopen_reason      IS DISTINCT FROM OLD.reopen_reason;
  END IF;

  IF v_touch AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'cancelling / reopening a contract is done through cancel_contract / reopen_contract only'
      USING ERRCODE = 'CC009',
            HINT = 'ยกเลิกสัญญา / เปิดสัญญากลับ ต้องกดจากปุ่มในหน้ารายละเอียดลูกค้าเท่านั้น (แก้สถานะหรือวันยกเลิกตรงไม่ได้)';
  END IF;

  -- ทางระบบ (postgres / service_role) ย้ายออกจาก cancelled → ล้างช่องยกเลิก (กัน CHECK ล้ม)
  IF TG_OP = 'UPDATE' AND OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    NEW.cancel_reason_code := NULL;
    NEW.cancel_reason      := NULL;
    NEW.cancelled_by       := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.contracts_status_cancel_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER contracts_status_cancel_guard
  BEFORE INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_status_cancel_guard();

-- =====================================================================
-- 3. cancel_contract
-- =====================================================================
CREATE FUNCTION public.cancel_contract(p_contract_id uuid, p_reason_code text, p_reason text)
RETURNS TABLE (contract_id uuid, status public.contract_status, cancelled_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_today  date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_reason text := nullif(btrim(p_reason, E' \t\r\n ​'), '');
  v_ct     record;
  v_id     uuid;
  v_status public.contract_status;
  v_cat    timestamptz;
  v_upd    timestamptz;
BEGIN
  -- ตำแหน่งก่อน (คนไม่มีสิทธิ์ไม่ได้ถือ lock / ไม่ได้ลองว่ามีสัญญาจริงไหม)
  IF NOT coalesce(is_host() OR current_app_role() = 'admin', false) THEN
    RAISE EXCEPTION 'not allowed to cancel contracts' USING ERRCODE = '42501';
  END IF;
  IF p_contract_id IS NULL THEN
    RAISE EXCEPTION 'contract_id is required' USING ERRCODE = '22004';
  END IF;
  IF NOT coalesce(is_host() OR contract_in_scope(p_contract_id), false) THEN
    RAISE EXCEPTION 'not allowed to cancel this contract' USING ERRCODE = '42501';
  END IF;
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('entry_error', 'customer_cancelled', 'other') THEN
    RAISE EXCEPTION 'invalid cancel reason code'
      USING ERRCODE = 'CC002', HINT = 'กรุณาเลือกประเภทเหตุผล (ลงข้อมูลผิด / ลูกค้ายกเลิก / อื่นๆ)';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'a cancel reason is required (max 500 characters)'
      USING ERRCODE = 'CC001', HINT = 'กรุณาพิมพ์เหตุผลที่ยกเลิกสัญญา (ไม่เกิน 500 ตัวอักษร)';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.save_service_visit:' || p_contract_id::text, 0));
  SELECT c.id, c.status, c.start_date, c.end_date, c.term_months INTO v_ct
    FROM contracts c WHERE c.id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;
  IF v_ct.status = 'cancelled' THEN
    RAISE EXCEPTION 'the contract is already cancelled'
      USING ERRCODE = 'CC003', HINT = 'สัญญานี้ยกเลิกไปแล้ว';
  END IF;
  IF v_ct.status NOT IN ('active', 'paused')
     OR contract_effective_end_date(v_ct.start_date, v_ct.end_date, v_ct.term_months) < v_today THEN
    RAISE EXCEPTION 'an ended contract cannot be cancelled'
      USING ERRCODE = 'CC004',
            HINT = 'สัญญานี้จบแล้ว (ปิดสัญญา / หมดอายุ) ยกเลิกไม่ได้ — ใช้ "ปิดสัญญา" แทน';
  END IF;
  IF EXISTS (SELECT 1 FROM contracts n
              WHERE n.renewed_from_contract_id = p_contract_id
                AND n.status <> 'cancelled' AND n.cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'a renewed contract cannot be cancelled'
      USING ERRCODE = 'CC005',
            HINT = 'สัญญานี้ต่อสัญญา (Renew) ไปแล้ว — ถ้าจะยกเลิก ให้ยกเลิกสัญญาใหม่แทน';
  END IF;

  UPDATE contracts c
     SET status             = 'cancelled',
         cancelled_at       = now(),
         cancel_reason_code = p_reason_code,
         cancel_reason      = v_reason,
         cancelled_by       = auth.uid()
   WHERE c.id = p_contract_id
  RETURNING c.id, c.status, c.cancelled_at, c.updated_at INTO v_id, v_status, v_cat, v_upd;

  RETURN QUERY SELECT v_id, v_status, v_cat, v_upd;
END;
$$;

COMMENT ON FUNCTION public.cancel_contract(uuid, text, text) IS
  'M44: cancel a contract effective now (host / admin in scope). Errors CC001–CC005, AG004, 22004, 42501.';

REVOKE ALL ON FUNCTION public.cancel_contract(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_contract(uuid, text, text) TO authenticated;

-- =====================================================================
-- 4. reopen_contract
-- =====================================================================
CREATE FUNCTION public.reopen_contract(p_contract_id uuid, p_reason text)
RETURNS TABLE (contract_id uuid, status public.contract_status, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_reason text := nullif(btrim(p_reason, E' \t\r\n ​'), '');
  v_ct     record;
  v_target public.contract_status;
  v_last   text;
  v_id     uuid;
  v_status public.contract_status;
  v_upd    timestamptz;
BEGIN
  IF NOT coalesce(is_host() OR current_app_role() = 'admin', false) THEN
    RAISE EXCEPTION 'not allowed to reopen contracts' USING ERRCODE = '42501';
  END IF;
  IF p_contract_id IS NULL THEN
    RAISE EXCEPTION 'contract_id is required' USING ERRCODE = '22004';
  END IF;
  IF NOT coalesce(is_host() OR contract_in_scope(p_contract_id), false) THEN
    RAISE EXCEPTION 'not allowed to reopen this contract' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'a reopen reason is required (max 500 characters)'
      USING ERRCODE = 'CC001', HINT = 'กรุณาพิมพ์เหตุผลที่เปิดสัญญากลับ (ไม่เกิน 500 ตัวอักษร)';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.save_service_visit:' || p_contract_id::text, 0));
  SELECT c.id, c.status, c.cancelled_at, c.renewed_from_contract_id, c.sale_type, c.start_date,
         c.renew_unlinked_reason INTO v_ct
    FROM contracts c WHERE c.id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;
  IF v_ct.status <> 'cancelled' THEN
    RAISE EXCEPTION 'the contract is not cancelled'
      USING ERRCODE = 'CC006', HINT = 'สัญญานี้ไม่ได้ยกเลิกอยู่ — เปิดกลับไม่ได้';
  END IF;
  -- เจ้าของ 20 พ.ย. 2026 (ง ข้อ 3 = ข): เปิดกลับได้แม้ยกเลิกก่อนเดือนที่ปิดแล้ว ทั้ง host และ admin
  --   (snapshot ของเดือนที่ปิดคงค่าเดิมจนสั่งคำนวณใหม่ — กฎ 7)
  IF EXISTS (SELECT 1 FROM stations s
              WHERE s.contract_id = p_contract_id AND s.type = 'IG'
                AND (s.collected_at IS NOT NULL OR s.not_collected_on IS NOT NULL)) THEN
    RAISE EXCEPTION 'IG stations of this contract were already collected'
      USING ERRCODE = 'CC007',
            HINT = 'สัญญานี้มีสถานี IG ที่บันทึกเก็บคืน / ไม่เก็บ ไปแล้ว — เปิดกลับไม่ได้ ให้ผู้ดูแลระบบ (host) แก้สถานีก่อน';
  END IF;
  IF v_ct.renewed_from_contract_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM contracts n
                  WHERE n.renewed_from_contract_id = v_ct.renewed_from_contract_id
                    AND n.id <> p_contract_id
                    AND n.status <> 'cancelled' AND n.cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'the old contract already has another renewal'
      USING ERRCODE = 'CC008',
            HINT = 'สัญญาเก่าของสัญญานี้มีสัญญาต่อ (Renew) ตัวอื่นแล้ว — เปิดกลับไม่ได้';
  END IF;

  -- กฎ Renew ของ M28 (contracts_renewed_gap_guard ข้ามเมื่อไม่ใช่ authenticated → RPC นี้ตรวจเอง
  --   ด้วยตัวช่วยเดียวกัน + รหัส error เดียวกัน · เปิดกลับ = นับเหมือนเพิ่งสร้าง Renew)
  IF v_ct.renewed_from_contract_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('public.contracts.renewal:' || v_ct.renewed_from_contract_id::text, 0));
    IF EXISTS (SELECT 1 FROM contracts o
                WHERE o.id = v_ct.renewed_from_contract_id
                  AND NOT renewal_gap_ok(o.start_date, o.end_date, o.term_months, v_ct.start_date)) THEN
      RAISE EXCEPTION 'a renewal must start within 2 months after the old contract ends; open it as New'
        USING ERRCODE = 'AG010',
              DETAIL = (SELECT to_char(renewal_latest_start_month(o.start_date, o.end_date, o.term_months), 'YYYY-MM')
                          FROM contracts o WHERE o.id = v_ct.renewed_from_contract_id),
              HINT = 'สัญญาต่อ (Renew) นี้เริ่มเกิน 2 เดือนหลังสัญญาเก่าจบแล้ว — เปิดกลับไม่ได้ (เปิดงานเป็นลูกค้าใหม่ New แทน)';
    END IF;
  ELSIF v_ct.sale_type = 'renew' THEN
    IF coalesce(btrim(v_ct.renew_unlinked_reason), '') = '' THEN
      RAISE EXCEPTION 'a renewal without a link to the old contract needs a reason'
        USING ERRCODE = 'AG012',
              HINT = 'Renew ที่ไม่ผูกสัญญาเก่า ต้องระบุเหตุผล (เช่น สัญญาเก่าไม่อยู่ในระบบ)';
    END IF;
    IF NOT unlinked_renew_open() THEN
      RAISE EXCEPTION 'renewals without a link to the old contract are no longer allowed'
        USING ERRCODE = 'AG013', DETAIL = to_char(allow_unlinked_renew_until(), 'YYYY-MM-DD'),
              HINT = 'เลยช่วงที่เปิด Renew แบบไม่ผูกสัญญาเก่าได้แล้ว — เปิดกลับไม่ได้ (ผูกสัญญาเก่า หรือเปิดเป็นลูกค้าใหม่ New)';
    END IF;
  END IF;

  -- ยกเลิกระหว่างพัก → กลับเป็น "พัก" (trigger contracts_pause_status_guard เปิดช่วงพักเดิมคืน · ไม่งั้น CP008)
  SELECT p.end_kind INTO v_last
    FROM contract_pauses p WHERE p.contract_id = p_contract_id
   ORDER BY p.paused_from DESC, p.created_at DESC LIMIT 1;
  v_target := CASE WHEN v_last = 'cancelled' THEN 'paused'::public.contract_status
                   ELSE 'active'::public.contract_status END;

  UPDATE contracts c
     SET status             = v_target,
         cancelled_at       = NULL,
         cancel_reason_code = NULL,
         cancel_reason      = NULL,
         cancelled_by       = NULL,
         reopened_at        = now(),
         reopened_by        = auth.uid(),
         reopen_reason      = v_reason
   WHERE c.id = p_contract_id
  RETURNING c.id, c.status, c.updated_at INTO v_id, v_status, v_upd;

  RETURN QUERY SELECT v_id, v_status, v_upd;
END;
$$;

COMMENT ON FUNCTION public.reopen_contract(uuid, text) IS
  'M44: reopen a cancelled contract (host / admin in scope). Status → active, or paused if it was cancelled while paused. Errors CC001, CC006–CC008, AG010, AG012, AG013, AG004, 22004, 42501.';

REVOKE ALL ON FUNCTION public.reopen_contract(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_contract(uuid, text) TO authenticated;
