-- M28b (DECISIONS M28b · เจ้าของสั่งหลัง mockup f467c3f "เชื่อมสัญญาเก่า"): ตรวจ Renew ที่ไม่ผูกสัญญาเก่า — admin เชื่อมได้ + "ปิดรายการ"
--
-- ⚠ ไม่แตะ save_job_opening (M30 เป็นเจ้าของ) · ไม่แทนที่ audit_trigger
--
-- Logic summary:
--   1. `link_renewal_contract` เปิดให้ **admin** (เฉพาะสาขาในขอบเขต `contract_in_scope` เหมือน RLS contracts_admin_update)
--      นอกเหนือจาก host · role อื่น / anon → 42501 · admin นอกขอบเขต → 42501
--      * เช็กขอบเขตตรงๆ ก่อน (ไม่พึ่ง FOR UPDATE + RLS ที่คืน 0 แถวเงียบๆ) · สัญญาที่ไม่มีจริง ก็ 42501 เหมือนกัน (ไม่เปิดเผยว่ามี/ไม่มี)
--      * ที่เหลือเหมือนเดิม: ลูกค้าเดียวกัน (M9 P0001) · กฎ 2 เดือน (AG010) · เฉพาะ Renew ที่ยังไม่ผูก (AG014) · ลง audit_log
--      * `contracts_renewed_from_lock` (AG009) — GUC `aga.renewal_link` ผ่านได้เมื่อเป็น host หรือ admin ในขอบเขต (เดิม host อย่างเดียว)
--        admin ที่ยิง REST ตรงยังโดน AG009 (GUC ตั้งได้จาก RPC เท่านั้น) · สัญญาปิด/ยกเลิก admin ยังแก้ไม่ได้ (AG007 จาก contracts_closed_guard)
--   2. ปิดรายการ "ไม่มีสัญญาเก่าในระบบ" — เก็บเป็น **คอลัมน์บน contracts** (ไม่แยกตาราง)
--        unlinked_closed_at / unlinked_closed_by / unlinked_closed_note
--      เหตุผลที่เลือก: (ก) `audit_contracts` ลง audit_log ให้อัตโนมัติ ไม่ต้องผูก trigger ตารางใหม่ (ข) RLS เดิมของ contracts
--      (host ทั้งหมด · admin ตามสาขา · recorder/viewer ไม่มีสิทธิ์เขียน) ใช้ต่อได้เลย ไม่ต้องออกแบบ policy ใหม่
--      (ค) แถวที่ปิด "เป็นของสัญญานั้น" 1:1 — ลบสัญญา = ข้อมูลหายตามกัน ไม่มีแถวกำพร้า
--      * CHECK: ฟิลด์ปิดต้องครบชุด (at + by) และใช้ได้เฉพาะ sale_type = 'renew' + ไม่ผูกสัญญาเก่า
--      * trigger `contracts_unlinked_close_guard`: ผู้ใช้ล็อกอินแก้ 3 ช่องนี้ตรงๆ (REST) ไม่ได้ → AG019
--        ผ่านได้เฉพาะ 2 ทาง: `close_unlinked_renewal` (GUC aga.renewal_close = id) และ `link_renewal_contract` (aga.renewal_link = id · ล้างเป็น NULL)
--        postgres / service_role / migration ผ่าน (แบบ M12/M23/M28)
--      * สัญญาที่ไม่ใช่ "Renew ไม่ผูก" อีกต่อไป (เช่น แก้เป็น New ผ่าน save_job_opening) → trigger ล้างสถานะปิดให้เอง (กัน CHECK ล้ม)
--   3. `close_unlinked_renewal(p_contract_id, p_note)` — host หรือ admin ในขอบเขต · เฉพาะ Renew ไม่ผูกที่ยังไม่ปิด
--        ไม่ใช่ Renew ไม่ผูก → AG014 · ปิดไปแล้ว → AG018 · ไม่ตรวจกฎ 2 เดือน (ไม่มีสัญญาเก่าให้เทียบ)
--   4. ปิดแล้วผูกได้ภายหลังไหม? **ได้** (ค่าเริ่มต้นตาม brief): ถ้าเจอสัญญาเก่าทีหลัง host/admin เรียก link_renewal_contract ได้
--      กฎ 2 เดือนยังตรวจ · การผูกล้างสถานะปิดทั้งชุด (at/by/note) ในคำสั่งเดียวกัน · ประวัติการปิดยังอยู่ใน audit_log
--   5. `list_unlinked_renewals` ไม่คืนแถวที่ปิดแล้ว (signature + คอลัมน์ผลลัพธ์เหมือนเดิมของ M30 — ไม่ต้องแก้ฝั่ง FE)
--   * error ใหม่ (ข้อความไทยอยู่ใน HINT): AG018 รายการนี้ปิดไปแล้ว · AG019 แก้ช่องปิดรายการตรงไม่ได้ ต้องใช้ RPC

-- =====================================================================
-- 1. คอลัมน์ + CHECK
-- =====================================================================
ALTER TABLE public.contracts
  ADD COLUMN unlinked_closed_at   timestamptz,
  ADD COLUMN unlinked_closed_by   uuid,
  ADD COLUMN unlinked_closed_note text;

COMMENT ON COLUMN public.contracts.unlinked_closed_at IS
  'M28b: เวลาที่ host/admin ปิดรายการ "ไม่มีสัญญาเก่าในระบบ" (Renew ไม่ผูกถาวร) · ผูกสัญญาเก่าภายหลัง = ล้างเป็น NULL';
COMMENT ON COLUMN public.contracts.unlinked_closed_by IS
  'M28b: auth.users.id ของผู้ปิดรายการ (ไม่ใส่ FK — กันผู้ใช้ถูกลบแล้วสถานะปิดหาย · ประวัติเต็มใน audit_log)';
COMMENT ON COLUMN public.contracts.unlinked_closed_note IS
  'M28b: หมายเหตุตอนปิดรายการ (ไม่บังคับ)';

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_unlinked_closed_check
    CHECK ((unlinked_closed_at IS NULL AND unlinked_closed_by IS NULL AND unlinked_closed_note IS NULL)
           OR (unlinked_closed_at IS NOT NULL AND unlinked_closed_by IS NOT NULL
               AND sale_type = 'renew' AND renewed_from_contract_id IS NULL));

-- =====================================================================
-- 2. trigger กันแก้ช่องปิดรายการตรง (REST) · ล้างสถานะเองเมื่อไม่ใช่ Renew ไม่ผูกแล้ว
--    ชื่อ contracts_unlinked_close_guard ('u' > 'r') เรียงหลัง trigger AG009/AG010/AG015 → error เดิมของ trigger เหล่านั้นชนะก่อน
-- =====================================================================
CREATE FUNCTION public.contracts_unlinked_close_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed boolean;
  v_guc     text := coalesce(current_setting('aga.renewal_close', true), '');
  v_link    text := coalesce(current_setting('aga.renewal_link', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_changed := NEW.unlinked_closed_at IS NOT NULL OR NEW.unlinked_closed_by IS NOT NULL
                 OR NEW.unlinked_closed_note IS NOT NULL;
  ELSE
    v_changed := NEW.unlinked_closed_at   IS DISTINCT FROM OLD.unlinked_closed_at
                 OR NEW.unlinked_closed_by   IS DISTINCT FROM OLD.unlinked_closed_by
                 OR NEW.unlinked_closed_note IS DISTINCT FROM OLD.unlinked_closed_note;
  END IF;

  IF v_changed AND current_user = 'authenticated' THEN
    IF TG_OP = 'UPDATE'
       AND (
         -- ทาง 1: close_unlinked_renewal — เปิดจากยังไม่ปิด → ปิด โดยผู้เรียกเอง
         (v_guc = NEW.id::text
          AND OLD.unlinked_closed_at IS NULL
          AND NEW.unlinked_closed_at IS NOT NULL
          AND NEW.unlinked_closed_by IS NOT DISTINCT FROM auth.uid())
         -- ทาง 2: link_renewal_contract — ล้างสถานะปิดทั้งชุด
         OR (v_link = NEW.id::text
             AND NEW.unlinked_closed_at IS NULL AND NEW.unlinked_closed_by IS NULL
             AND NEW.unlinked_closed_note IS NULL)
       ) THEN
      NULL;  -- อนุญาต
    ELSE
      RAISE EXCEPTION 'the closed state of an unlinked renewal can only be changed through the review functions'
        USING ERRCODE = 'AG019',
              HINT = 'ปิดรายการ / ผูกสัญญาเก่า ต้องทำผ่านหน้าตรวจ Renew ที่ไม่ผูกสัญญาเก่าเท่านั้น (แก้ช่องนี้ตรงไม่ได้)';
    END IF;
  END IF;

  -- ไม่ใช่ Renew ไม่ผูกแล้ว (เช่น เปลี่ยนเป็น New) → ล้างสถานะปิด (ไม่ให้ CHECK ล้ม)
  --   ผลตรวจ Opus: admin ห้ามใช้ช่องนี้เปิดรายการที่ปิดแล้วกลับ (แก้ sale_type เป็น New แล้วแก้กลับ) → ผู้ใช้ล็อกอินที่ไม่ใช่ host ได้ AG019
  --   (การผูกผ่าน link_renewal_contract ล้างสถานะเองในคำสั่ง UPDATE แล้ว จึงไม่ติดเงื่อนไขนี้)
  IF NOT (NEW.sale_type = 'renew' AND NEW.renewed_from_contract_id IS NULL) THEN
    IF TG_OP = 'UPDATE' AND current_user = 'authenticated' AND NOT public.is_host()
       AND OLD.unlinked_closed_at IS NOT NULL AND NEW.unlinked_closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'a closed unlinked renewal cannot be turned into another type by this role'
        USING ERRCODE = 'AG019',
              HINT = 'รายการที่ปิดแล้วเปลี่ยนประเภทไม่ได้ (เฉพาะ host) — ถ้าจะผูกสัญญาเก่า ให้ใช้ปุ่มผูกสัญญาเก่า';
    END IF;
    NEW.unlinked_closed_at := NULL;
    NEW.unlinked_closed_by := NULL;
    NEW.unlinked_closed_note := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.contracts_unlinked_close_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER contracts_unlinked_close_guard
  BEFORE INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_unlinked_close_guard();

-- =====================================================================
-- 3. AG009 (M23/M28) — GUC aga.renewal_link ผ่านได้เมื่อเป็น host หรือ admin ในขอบเขตของสัญญา
--    เนื้อเดิม 20261115180000 · แก้จุดเดียว: เงื่อนไข role ป้าย "M28b"
-- =====================================================================
CREATE OR REPLACE FUNCTION public.contracts_renewed_from_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND NEW.renewed_from_contract_id IS DISTINCT FROM OLD.renewed_from_contract_id
     AND NOT (OLD.renewed_from_contract_id IS NULL                                     -- M28: ผูกย้อนหลังผ่าน RPC
              AND NEW.renewed_from_contract_id IS NOT NULL
              AND (public.is_host()                                                    -- M28b: host หรือ admin ในขอบเขต
                   OR (public.current_app_role() = 'admin' AND public.contract_in_scope(NEW.id)))
              AND coalesce(current_setting('aga.renewal_link', true), '') = NEW.id::text) THEN
    RAISE EXCEPTION 'renewed_from_contract_id cannot be changed after the contract is created'
      USING ERRCODE = 'AG009',
            HINT = 'ช่อง "ต่อมาจากสัญญาไหน" กำหนดได้ตอนเปิดงานต่อสัญญาเท่านั้น แก้หลังสร้างไม่ได้ (ถ้าผูกผิด ให้แจ้งผู้ดูแลระบบ)';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.contracts_renewed_from_lock() FROM PUBLIC, anon, authenticated;

-- =====================================================================
-- 4. link_renewal_contract — เนื้อเดิม 20261115180000 (M28) · แก้ป้าย "M28b":
--    host หรือ admin ในขอบเขต · ล้างสถานะปิดรายการพร้อมกัน
--    signature + RETURNS เดิม → CREATE OR REPLACE (คง GRANT เดิม)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.link_renewal_contract(p_contract_id uuid, p_renewed_from_contract_id uuid)
RETURNS TABLE (contract_id uuid, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_sale public.sale_type;
  v_link uuid;
  v_id   uuid;
  v_upd  timestamptz;
BEGIN
  -- M28b: host ทุกสาขา · admin เฉพาะสาขาในขอบเขต (contract_in_scope = ตัวเดียวกับ RLS contracts_admin_update)
  IF NOT (is_host() OR (current_app_role() = 'admin' AND p_contract_id IS NOT NULL AND contract_in_scope(p_contract_id))) THEN
    RAISE EXCEPTION 'only host or an admin in scope can link a renewal afterwards' USING ERRCODE = '42501';
  END IF;
  IF p_contract_id IS NULL OR p_renewed_from_contract_id IS NULL THEN
    RAISE EXCEPTION 'contract and old contract are required' USING ERRCODE = '22004';
  END IF;

  SELECT c.sale_type, c.renewed_from_contract_id INTO v_sale, v_link
    FROM contracts c WHERE c.id = p_contract_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;
  IF v_sale IS DISTINCT FROM 'renew' OR v_link IS NOT NULL THEN
    RAISE EXCEPTION 'only an unlinked renewal can be linked afterwards'
      USING ERRCODE = 'AG014',
            HINT = 'ผูกสัญญาเก่าย้อนหลังได้เฉพาะสัญญา Renew ที่ยังไม่ผูก';
  END IF;

  PERFORM set_config('aga.renewal_link', p_contract_id::text, true);
  UPDATE contracts c
     SET renewed_from_contract_id = p_renewed_from_contract_id,
         renew_unlinked_reason    = NULL,
         unlinked_closed_at       = NULL,                          -- M28b: ผูกแล้ว = ไม่ใช่รายการที่ปิดอีกต่อไป
         unlinked_closed_by       = NULL,
         unlinked_closed_note     = NULL
   WHERE c.id = p_contract_id
  RETURNING c.id, c.updated_at INTO v_id, v_upd;
  PERFORM set_config('aga.renewal_link', '', true);

  -- admin นอกขอบเขตถูกตัดตั้งแต่ด้านบนแล้ว · ถ้ายัง 0 แถว (ไม่ควรเกิด) อย่าคืนผลเงียบๆ
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'not allowed to update this contract' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT v_id, v_upd;
END;
$$;
REVOKE ALL ON FUNCTION public.link_renewal_contract(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_renewal_contract(uuid, uuid) TO authenticated;

-- =====================================================================
-- 5. close_unlinked_renewal — ปิดรายการ "ไม่มีสัญญาเก่าในระบบ"
-- =====================================================================
CREATE FUNCTION public.close_unlinked_renewal(p_contract_id uuid, p_note text DEFAULT NULL)
RETURNS TABLE (contract_id uuid, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_sale   public.sale_type;
  v_link   uuid;
  v_closed timestamptz;
  v_id     uuid;
  v_upd    timestamptz;
BEGIN
  IF NOT (is_host() OR (current_app_role() = 'admin' AND p_contract_id IS NOT NULL AND contract_in_scope(p_contract_id))) THEN
    RAISE EXCEPTION 'only host or an admin in scope can close an unlinked renewal' USING ERRCODE = '42501';
  END IF;
  IF p_contract_id IS NULL THEN
    RAISE EXCEPTION 'contract is required' USING ERRCODE = '22004';
  END IF;

  SELECT c.sale_type, c.renewed_from_contract_id, c.unlinked_closed_at INTO v_sale, v_link, v_closed
    FROM contracts c WHERE c.id = p_contract_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;
  IF v_sale IS DISTINCT FROM 'renew' OR v_link IS NOT NULL THEN
    RAISE EXCEPTION 'only an unlinked renewal can be closed'
      USING ERRCODE = 'AG014',
            HINT = 'ปิดรายการได้เฉพาะสัญญา Renew ที่ยังไม่ผูกสัญญาเก่า';
  END IF;
  IF v_closed IS NOT NULL THEN
    RAISE EXCEPTION 'this unlinked renewal is already closed'
      USING ERRCODE = 'AG018',
            HINT = 'รายการนี้ปิดไปแล้ว (ไม่มีสัญญาเก่าในระบบ)';
  END IF;

  PERFORM set_config('aga.renewal_close', p_contract_id::text, true);
  UPDATE contracts c
     SET unlinked_closed_at   = now(),
         unlinked_closed_by   = auth.uid(),
         unlinked_closed_note = nullif(btrim(p_note), '')
   WHERE c.id = p_contract_id
  RETURNING c.id, c.updated_at INTO v_id, v_upd;
  PERFORM set_config('aga.renewal_close', '', true);

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'not allowed to update this contract' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT v_id, v_upd;
END;
$$;
REVOKE ALL ON FUNCTION public.close_unlinked_renewal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_unlinked_renewal(uuid, text) TO authenticated;

-- =====================================================================
-- 6. list_unlinked_renewals — เนื้อเดิม 20261115200000 (M30) · แก้จุดเดียว: ไม่คืนแถวที่ปิดแล้ว (ป้าย "M28b")
--    signature + คอลัมน์ผลลัพธ์เหมือนเดิม → CREATE OR REPLACE
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
  term_years            integer,
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
  SELECT c.id, c.contract_no, cu.id, cu.name, cu.branch_id, c.start_date, c.end_date, c.term_years::int,
         c.status, c.renew_unlinked_reason, c.created_at, c.updated_at, c.term_months::int
    FROM contracts c
    JOIN customers cu ON cu.id = c.customer_id
   WHERE c.sale_type = 'renew' AND c.renewed_from_contract_id IS NULL
     AND c.unlinked_closed_at IS NULL                                    -- M28b: ปิดรายการแล้วไม่ต้องตรวจอีก
     AND (p_branch_id IS NULL OR cu.branch_id = p_branch_id)
     AND (v_role = 'host' OR branch_in_scope(cu.branch_id))
   ORDER BY c.created_at, c.id;
END;
$$;
REVOKE ALL ON FUNCTION public.list_unlinked_renewals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_unlinked_renewals(uuid) TO authenticated;
