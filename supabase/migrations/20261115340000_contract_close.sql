-- =====================================================================
-- M44a ปิดสัญญา (DECISIONS 2.99 · SPEC §7.8 v1.9 · เจ้าของ 20 พ.ย. 2026) — ปุ่ม "ปิดสัญญา" หน้า /collection
--
-- ⚠ ไม่แตะ audit_trigger (audit_contracts เดิมบันทึกให้ · ผู้ปิด/หมายเหตุอยู่ในคอลัมน์ของ contracts)
--   ไม่แทนที่ฟังก์ชัน/trigger เดิมตัวใด · ไม่แตะ ig_collection_apply / collect_ig_stations / skip_ig_collection
--
-- สรุป logic (ทีมอ่านตรงนี้ก่อน):
--   1. "หมดอายุ" นิยามอย่างไร — ตรวจแล้ว **ไม่มีอะไรในฐานข้อมูลตั้งสถานะ expired_pending_collection ให้เอง**
--      (ไม่มี trigger / cron · มีแค่ตัวนำเข้าทะเบียน lib/import/registryImportPlan.ts ตั้งตอนนำเข้า)
--      → สัญญาที่เลยวันสิ้นสุดส่วนมากยังเป็น 'active' · จึงนิยาม "หมดอายุแล้ว" =
--        status = 'expired_pending_collection'  หรือ  (status = 'active' และ วันสิ้นสุดจริง < วันนี้ เวลาไทย)
--        วันสิ้นสุดจริง = contract_effective_end_date(start_date, end_date, term_months)
--        (end_date ถ้ามี · ไม่งั้น เริ่ม + N เดือน − 1 วัน) — นิยามเดียวกับ ig_collection_apply (CL001 ของ M19b)
--        และหน้า /todo `isContractEnded`
--   2. RPC `close_contract(p_contract_id, p_note DEFAULT NULL)` → (contract_id, status, closed_at, updated_at, ig_remaining)
--      SECURITY DEFINER · ตรวจสิทธิ์เองตามลำดับ role → ขอบเขต → ข้อมูล (แบบ ig_collection_apply / pause_contract)
--      * ใครปิดได้ (2.99): host ทุกสาขา · recorder เฉพาะ contract_in_scope (เกณฑ์เดียวกับ collect/skip ของ M19b)
--        · admin / viewer / anon / ไม่มีโปรไฟล์ → 42501 (admin ดูอย่างเดียว)
--      * ยังไม่หมดอายุ (active และวันสิ้นสุด ≥ วันนี้) → CL006 "ใช้ยกเลิกสัญญาแทน"
--      * ปิดไปแล้ว → CL007 · ยกเลิกแล้ว → CL008 · พักอยู่ → CL009 (DECISIONS 2.94 Q3: กด "กลับมาต่อ" ก่อนแล้วค่อยจบสัญญา)
--      * หมายเหตุไม่บังคับ (ตัดช่องว่าง · ว่าง = NULL) · เกิน 500 ตัว → CL010
--      * ปิดได้แม้ IG ยังเก็บไม่ครบ (§7.8) · ไม่แตะสถานี → IG ที่ค้างยังอยู่ในรายการรอเก็บ (v_contract_ig_collection
--        ไม่กรองสถานะ) และยังเก็บ/ไม่เก็บต่อได้ (ig_collection_apply ยอมสัญญาที่ไม่ใช่ active · วันแรก = วันจบ/ปิดที่เร็วสุด)
--        · คืน ig_remaining ให้หน้าจอแจ้ง "ยังค้างเก็บ N จุด"
--      * ตั้ง status = 'closed' · closed_at = now() · closed_by = ผู้กด · close_note
--      * ถือคิวเดียวกับการเก็บ IG ของสัญญานั้น (advisory lock 'public.ig_collection:') + FOR UPDATE แถวสัญญา
--      * ปิดแล้ว: AG007 เดิมล็อกการแก้ (เฉพาะ host แก้ได้) · ไม่มี RPC เปิดกลับ (นอกขอบเขต 2.99)
--   3. ด่าน REST `contracts_closed_status_guard` (BEFORE INSERT OR UPDATE · ไม่ระบุ OF คอลัมน์):
--      * คอลัมน์ใหม่ `closed_by` / `close_note` — ผู้ใช้ล็อกอินทุก role เขียนตรงไม่ได้ → CL011 (กันปลอมผู้ปิด)
--      * เจ้าของเลือก ข (20 พ.ย. 2026): **admin** เปลี่ยนสถานะ เข้า/ออก 'closed' หรือแก้ closed_at ผ่าน REST ไม่ได้ → CL012
--        (admin ดูอย่างเดียวเรื่องปิดสัญญา — 2.99) · **host ยังแก้ตรงได้** (ไว้แก้กรณีกดปิดผิด — ยังไม่มี RPC เปิดกลับ)
--        · recorder ไม่มีสิทธิ์ UPDATE contracts อยู่แล้ว (RLS)
--      * ชื่อ "contracts_closed_s…" เรียงหลัง contracts_closed_guard → admin แก้สัญญาที่ปิดแล้ว (รวมเปิดกลับ) ยังได้ AG007 เดิม
--        · CL012 จึงเกิดเมื่อ admin ปิดสัญญาที่ยังไม่ปิด / ตั้ง closed_at ของสัญญาที่ยังไม่ปิด
--   4. ยอดรายเดือน: ปิดหลังหมดอายุ = ไม่มีเดือนบริการหลังจากนี้ · lib/rules ไม่ดู closed · ไม่มี trigger snapshot (กฎ 7)
--   * error ใหม่ (ข้อความไทยทั้งใน MESSAGE และ HINT — แบบ CL001–CL005 ของ M19b):
--     CL006 ยังไม่หมดอายุ · CL007 ปิดแล้ว · CL008 ยกเลิกแล้ว · CL009 พักอยู่ · CL010 หมายเหตุยาวเกิน · CL011 แก้ช่องปิดตรงไม่ได้
--     · CL012 admin เปลี่ยนสถานะปิด / closed_at ผ่าน REST ไม่ได้
--     · (เดิม) 42501 ไม่มีสิทธิ์ · 22004 ไม่ส่ง contract_id · AG004 ไม่พบสัญญา
--   * เทส: supabase/tests/60_contract_close.test.sql
-- =====================================================================

-- =====================================================================
-- 1. คอลัมน์
-- =====================================================================
ALTER TABLE public.contracts
  ADD COLUMN closed_by  uuid,
  ADD COLUMN close_note text;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_close_note_length CHECK (close_note IS NULL OR char_length(close_note) <= 500);

COMMENT ON COLUMN public.contracts.closed_by IS
  'M44a: auth.users.id ของผู้กดปิดสัญญา (close_contract) · ไม่ใส่ FK — ประวัติเต็มใน audit_log · REST เขียนตรงไม่ได้ (CL011)';
COMMENT ON COLUMN public.contracts.close_note IS
  'M44a: หมายเหตุตอนปิดสัญญา (≤ 500 · ไม่บังคับ) · REST เขียนตรงไม่ได้ (CL011)';

-- =====================================================================
-- 2. ด่าน REST: closed_by / close_note ตั้งได้จาก close_contract เท่านั้น · admin ปิดสัญญาผ่าน REST ไม่ได้
-- =====================================================================
CREATE FUNCTION public.contracts_closed_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND ((TG_OP = 'INSERT' AND (NEW.closed_by IS NOT NULL OR NEW.close_note IS NOT NULL))
          OR (TG_OP = 'UPDATE' AND (NEW.closed_by IS DISTINCT FROM OLD.closed_by
                                    OR NEW.close_note IS DISTINCT FROM OLD.close_note))) THEN
    RAISE EXCEPTION 'ผู้ปิดสัญญา / หมายเหตุการปิด แก้ตรงไม่ได้ — ใช้ปุ่ม "ปิดสัญญา"'
      USING ERRCODE = 'CL011',
            HINT = 'ผู้ปิดสัญญา / หมายเหตุการปิด แก้ตรงไม่ได้ — ใช้ปุ่ม "ปิดสัญญา"';
  END IF;
  -- เจ้าของเลือก ข: เฉพาะ admin (host แก้ตรงได้ · recorder ไม่มีสิทธิ์ UPDATE)
  IF current_user = 'authenticated' AND public.current_app_role() = 'admin'
     AND ((TG_OP = 'INSERT' AND (NEW.status = 'closed' OR NEW.closed_at IS NOT NULL))
          OR (TG_OP = 'UPDATE' AND ((NEW.status = 'closed') IS DISTINCT FROM (OLD.status = 'closed')
                                    OR NEW.closed_at IS DISTINCT FROM OLD.closed_at))) THEN
    RAISE EXCEPTION 'แอดมินปิดสัญญา / แก้วันปิดสัญญาไม่ได้ — ปิดสัญญาได้เฉพาะหัวหน้างานหรือผู้ดูแลระบบ'
      USING ERRCODE = 'CL012',
            HINT = 'แอดมินปิดสัญญา / แก้วันปิดสัญญาไม่ได้ — ปิดสัญญาได้เฉพาะหัวหน้างานหรือผู้ดูแลระบบ';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.contracts_closed_status_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER contracts_closed_status_guard
  BEFORE INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_closed_status_guard();

-- =====================================================================
-- 3. close_contract
-- =====================================================================
CREATE FUNCTION public.close_contract(p_contract_id uuid, p_note text DEFAULT NULL)
RETURNS TABLE (contract_id uuid, status public.contract_status, closed_at timestamptz, updated_at timestamptz,
               ig_remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_today  date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_note   text := nullif(btrim(p_note, E' \t\r\n ​'), '');
  v_ct     record;
  v_id     uuid;
  v_status public.contract_status;
  v_cat    timestamptz;
  v_upd    timestamptz;
  v_rem    integer;
BEGIN
  -- ตำแหน่งก่อน (คนไม่มีสิทธิ์ไม่ได้ถือ lock / ไม่ได้ลองว่ามีสัญญาจริงไหม)
  IF NOT coalesce(is_host() OR current_app_role() = 'recorder', false) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ปิดสัญญา' USING ERRCODE = '42501';
  END IF;
  IF p_contract_id IS NULL THEN
    RAISE EXCEPTION 'contract_id is required' USING ERRCODE = '22004';
  END IF;
  IF NOT coalesce(is_host() OR contract_in_scope(p_contract_id), false) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ปิดสัญญานี้' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'หมายเหตุยาวเกิน 500 ตัวอักษร'
      USING ERRCODE = 'CL010', HINT = 'หมายเหตุยาวเกิน 500 ตัวอักษร';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.ig_collection:' || p_contract_id::text, 0));
  SELECT c.id, c.status, c.start_date, c.end_date, c.term_months INTO v_ct
    FROM contracts c WHERE c.id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบสัญญา' USING ERRCODE = 'AG004';
  END IF;
  IF v_ct.status = 'closed' THEN
    RAISE EXCEPTION 'สัญญานี้ปิดไปแล้ว' USING ERRCODE = 'CL007', HINT = 'สัญญานี้ปิดไปแล้ว';
  END IF;
  IF v_ct.status = 'cancelled' THEN
    RAISE EXCEPTION 'สัญญานี้ยกเลิกแล้ว ปิดสัญญาไม่ได้'
      USING ERRCODE = 'CL008', HINT = 'สัญญานี้ยกเลิกแล้ว ปิดสัญญาไม่ได้';
  END IF;
  IF v_ct.status = 'paused' THEN
    RAISE EXCEPTION 'สัญญานี้พักอยู่ — กด "กลับมาต่อ" ก่อนแล้วค่อยปิดสัญญา'
      USING ERRCODE = 'CL009', HINT = 'สัญญานี้พักอยู่ — กด "กลับมาต่อ" ก่อนแล้วค่อยปิดสัญญา';
  END IF;
  IF v_ct.status = 'active'
     AND contract_effective_end_date(v_ct.start_date, v_ct.end_date, v_ct.term_months) >= v_today THEN
    RAISE EXCEPTION 'สัญญายังไม่หมดอายุ ปิดไม่ได้ — ถ้าลูกค้าเลิกก่อนกำหนด ให้ใช้ "ยกเลิกสัญญา"'
      USING ERRCODE = 'CL006', HINT = 'สัญญายังไม่หมดอายุ ปิดไม่ได้ — ถ้าลูกค้าเลิกก่อนกำหนด ให้ใช้ "ยกเลิกสัญญา"';
  END IF;

  UPDATE contracts c
     SET status     = 'closed',
         closed_at  = now(),
         closed_by  = auth.uid(),
         close_note = v_note
   WHERE c.id = p_contract_id
  RETURNING c.id, c.status, c.closed_at, c.updated_at INTO v_id, v_status, v_cat, v_upd;

  SELECT coalesce((SELECT v.remaining FROM v_contract_ig_collection v WHERE v.contract_id = p_contract_id), 0)
    INTO v_rem;

  RETURN QUERY SELECT v_id, v_status, v_cat, v_upd, v_rem;
END;
$$;

COMMENT ON FUNCTION public.close_contract(uuid, text) IS
  'M44a (DECISIONS 2.99): close an expired contract (host / recorder in scope) even with IG still to collect. Errors CL006–CL010, AG004, 22004, 42501.';

REVOKE ALL ON FUNCTION public.close_contract(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_contract(uuid, text) TO authenticated;
