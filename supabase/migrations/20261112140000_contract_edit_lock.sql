-- M12: ล็อกสัญญาปิด/ยกเลิก (DECISIONS 3.11 = 1ก) + กันเขียนทับพร้อมกัน (3.12 = 2ก) — เจ้าของตัดสิน 12 พ.ย. 2026
--
-- Logic summary:
--   * `contracts.updated_at` เดิม **ไม่เคยเปลี่ยน** หลังสร้าง (มีแค่ DEFAULT now() ไม่มี trigger) →
--     trigger `contracts_set_updated_at` ตั้งเป็น clock_timestamp() ทุกครั้งที่ UPDATE
--     (clock_timestamp ไม่ใช่ now(): แก้ 2 ครั้งใน transaction เดียวก็ได้ค่าต่างกัน)
--   * 3.11 สัญญา `closed` / `cancelled` → admin / recorder แก้ไม่ได้ · host แก้ได้ (เผื่อพิมพ์ผิดจริง)
--       - trigger `contracts_closed_guard` (BEFORE UPDATE บน contracts) + `contract_teams_closed_guard`
--         (เพิ่ม/แก้/ลบทีมของสัญญานั้น) → `AG007` · บังคับทั้งทาง RPC และ UPDATE ตรง (ไม่ใช่แค่ซ่อนปุ่ม)
--       - เปลี่ยนสถานะ "เป็น" closed/cancelled ยังทำได้ตามสิทธิ์เดิม (ล็อกเฉพาะเมื่อสถานะเดิมปิด/ยกเลิกแล้ว)
--       - ฟังก์ชันระบบแบบ SECURITY DEFINER (current_user ไม่ใช่ authenticated) ไม่ติดด่าน
--       - ทุกการแก้ของ host ลง audit_log ตาม trigger เดิม
--       - ผลข้างเคียง: admin ลบสัญญาที่ยกเลิกแล้วที่มีทีมผ่าน REST ตรงไม่ได้ (ทีมของสัญญาถูกกันลบ) —
--         ตรงกับกติกาหน้าจอ / delete_job_opening (AG005) อยู่แล้ว
--   * 3.12 กันเขียนทับ: `save_job_opening` โหมดแก้ **ต้องส่ง** `p_expected_updated_at` (เวลาแก้ล่าสุดที่หน้าจอเห็น)
--       - ไม่ส่ง → 22004 · ไม่ตรงกับในฐาน → `AG008` "มีคนแก้สัญญานี้ไปก่อนแล้ว" (ไม่ทับงานคนแรก)
--       - UPDATE ใส่เงื่อนไข updated_at ซ้ำอีกชั้น กันมีคนแก้แทรกระหว่างอ่านกับเขียน
--       - การแก้ทีมผ่าน RPC นับรวม: โหมดแก้ UPDATE แถวสัญญาทุกครั้ง updated_at จึงขยับเสมอ
--         (แก้ contract_teams ตรงผ่าน REST ไม่ขยับ — หน้าจอใช้ RPC เท่านั้น)
--       - คืน `updated_at` ใหม่ ให้หน้าจอเก็บไว้ใช้ตอนแก้ครั้งต่อไป
--   * ห้ามย้ายสถานีข้ามสัญญาด้วย UPDATE ตรง (ทุกตำแหน่ง · 42501) — ย้ายได้ผ่านฟังก์ชันระบบตอน Renew เท่านั้น
--   * signature ของ save_job_opening เปลี่ยน (เพิ่มพารามิเตอร์ + คอลัมน์ผลลัพธ์) → DROP แล้วสร้างใหม่ + ให้สิทธิ์ใหม่
--     (CREATE OR REPLACE จะได้ function ซ้อน 2 ตัวแทน) · โหมดสร้างใหม่เรียกแบบเดิมได้ (ค่าเริ่มต้น NULL)
--   * error code ใหม่ให้หน้าจอแปล: `AG007` สัญญาปิด/ยกเลิกแล้ว แก้ได้เฉพาะ Host · `AG008` มีคนแก้สัญญานี้ไปก่อนแล้ว
--     กรุณาโหลดใหม่ · (`22004` = หน้าจอลืมส่งเวลาแก้ล่าสุด — บั๊กของหน้าจอ)

-- =====================================================================
-- 1. updated_at ขยับทุกครั้งที่แก้
-- =====================================================================
CREATE FUNCTION public.contracts_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER contracts_set_updated_at
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_set_updated_at();

-- =====================================================================
-- 2. ล็อกสัญญาปิด/ยกเลิก (ยกเว้น host)
-- =====================================================================
CREATE FUNCTION public.contracts_closed_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated' AND NOT public.is_host()
     AND OLD.status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'a closed or cancelled contract can be edited by host only' USING ERRCODE = 'AG007';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contracts_closed_guard
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_closed_guard();

CREATE FUNCTION public.contract_teams_closed_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated' AND NOT public.is_host()
     AND EXISTS (SELECT 1 FROM public.contracts c
                  WHERE (c.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.contract_id ELSE NEW.contract_id END
                         OR (TG_OP = 'UPDATE' AND c.id = OLD.contract_id))
                    AND c.status IN ('closed', 'cancelled')) THEN
    RAISE EXCEPTION 'a closed or cancelled contract can be edited by host only' USING ERRCODE = 'AG007';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER contract_teams_closed_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.contract_teams
  FOR EACH ROW EXECUTE FUNCTION public.contract_teams_closed_guard();

-- =====================================================================
-- 2.1 ห้ามย้ายสถานีข้ามสัญญาด้วย UPDATE ตรง (ผลตรวจของศูนย์กลาง 12 พ.ย. 2026)
--     policy `stations_admin_update` (20261104100318) ให้ admin เปลี่ยน contract_id ไปลูกค้าอื่นในสาขาเดียวกันได้
--     → สถานีย้ายโดยไม่มีบันทึก (ข้าม station_transfers) · การย้ายที่ถูกต้องทำผ่านฟังก์ชันระบบ
--     (initialize_contract_stations — SECURITY DEFINER, current_user ไม่ใช่ authenticated) เท่านั้น
-- =====================================================================
CREATE FUNCTION public.stations_contract_move_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated' AND NEW.contract_id IS DISTINCT FROM OLD.contract_id THEN
    RAISE EXCEPTION 'a station cannot be moved to another contract directly' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stations_contract_move_guard
  BEFORE UPDATE OF contract_id ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.stations_contract_move_guard();

-- =====================================================================
-- 3. save_job_opening: + p_expected_updated_at · + คืน updated_at · + ด่าน AG007 / AG008
--    (เนื้อเดิมจาก 20261112110000 — แก้เฉพาะส่วน M12)
-- =====================================================================
DROP FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, integer, numeric, public.sale_type, uuid[], uuid, uuid,
  boolean, text, text, boolean, uuid, date, date, time, text);

CREATE FUNCTION public.save_job_opening(
  p_branch_id                uuid,
  p_customer_name            text,
  p_customer_type            text,
  p_contract_no              text,
  p_start_date               date,
  p_end_date                 date,
  p_term_years               integer,
  p_value_total              numeric,
  p_sale_type                public.sale_type,
  p_team_ids                 uuid[]  DEFAULT '{}',
  p_contract_id              uuid    DEFAULT NULL,
  p_customer_id              uuid    DEFAULT NULL,
  p_confirm_new_customer     boolean DEFAULT false,
  p_sale_name                text    DEFAULT NULL,
  p_am_name                  text    DEFAULT NULL,
  p_is_urgent                boolean DEFAULT false,
  p_renewed_from_contract_id uuid    DEFAULT NULL,
  p_mail_received_date       date    DEFAULT NULL,
  p_first_service_date       date    DEFAULT NULL,
  p_first_service_time       time    DEFAULT NULL,
  p_note                     text    DEFAULT NULL,
  p_expected_updated_at      timestamptz DEFAULT NULL
)
RETURNS TABLE (
  contract_id            uuid,
  customer_id            uuid,
  reused_customer        boolean,
  existing_customer_type text,
  updated_at             timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_customer_id   uuid;
  v_customer_type text;
  v_old_customer  uuid;
  v_old_branch    uuid;
  v_status        public.contract_status;
  v_updated_at    timestamptz;
  v_reused        boolean := false;
  v_contract_id   uuid;
  v_key           text;
  v_matches       jsonb;
  v_team_ids      uuid[] := ARRAY(SELECT DISTINCT t FROM unnest(coalesce(p_team_ids, '{}')) t
                                   WHERE t IS NOT NULL);
BEGIN
  -- ---------- ล้มเร็ว: admin นอกขอบเขตหน่วยงาน (RLS ปฏิเสธอยู่แล้ว นี่แค่ไม่ต้องทำงานเปล่า) ----------
  --   host ข้ามได้: policy ของ host ไม่ขึ้นกับ division_scope
  IF NOT is_host() AND NOT branch_in_scope(p_branch_id) THEN
    RAISE EXCEPTION 'branch is outside your division' USING ERRCODE = '42501';
  END IF;

  -- ---------- โหมดแก้: สัญญาต้องมีอยู่และมองเห็น · ห้ามย้ายสาขา ----------
  IF p_contract_id IS NOT NULL THEN
    SELECT c.customer_id, cu.branch_id, c.status, c.updated_at
      INTO v_old_customer, v_old_branch, v_status, v_updated_at
      FROM contracts c JOIN customers cu ON cu.id = c.customer_id
     WHERE c.id = p_contract_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
    END IF;
    -- สาขาของสัญญา = สาขาของลูกค้าเดิม · เปลี่ยนสาขาผ่านหน้าเปิดงานไม่ได้ (กันย้ายสัญญาข้ามสาขา)
    IF p_branch_id IS DISTINCT FROM v_old_branch THEN
      RAISE EXCEPTION 'the branch of a saved contract cannot be changed' USING ERRCODE = 'AG006';
    END IF;
    -- M12 / DECISIONS 3.11: สัญญาปิด/ยกเลิก แก้ได้เฉพาะ host (trigger contracts_closed_guard กันซ้ำอีกชั้น)
    IF v_status IN ('closed', 'cancelled') AND NOT is_host() THEN
      RAISE EXCEPTION 'a closed or cancelled contract can be edited by host only' USING ERRCODE = 'AG007';
    END IF;
    -- M12 / DECISIONS 3.12: กันเขียนทับ — ต้องส่งเวลาแก้ล่าสุดที่หน้าจอเห็นมาด้วย
    IF p_expected_updated_at IS NULL THEN
      RAISE EXCEPTION 'p_expected_updated_at is required when editing' USING ERRCODE = '22004';
    END IF;
    IF v_updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'this contract was changed by someone else' USING ERRCODE = 'AG008';
    END IF;
  END IF;

  -- ---------- ลูกค้า ----------
  IF p_customer_id IS NOT NULL OR p_contract_id IS NOT NULL THEN
    -- เลือกรายเดิม (หรือคงรายเดิมของสัญญาที่แก้)
    v_customer_id := coalesce(p_customer_id, v_old_customer);
    SELECT cu.customer_type INTO v_customer_type
      FROM customers cu WHERE cu.id = v_customer_id AND cu.branch_id = p_branch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'customer is not in this branch' USING ERRCODE = 'AG002';
    END IF;
    v_reused := true;
  ELSE
    v_key := customer_name_key(p_customer_name);
    IF v_key = '' THEN
      RAISE EXCEPTION 'customer name is required' USING ERRCODE = '23514';
    END IF;

    -- กันกดพร้อมกัน: ชื่อ+สาขาเดียวกันเข้าทีละรายการ (ปลดเองเมื่อจบ transaction)
    PERFORM pg_advisory_xact_lock(
      hashtextextended('public.customers:' || p_branch_id::text || ':' || v_key, 0));

    IF NOT p_confirm_new_customer THEN
      SELECT jsonb_agg(jsonb_build_object(
               'customer_id', cu.id,
               'name', cu.name,
               'customer_type', cu.customer_type,
               'latest_contract_no', (SELECT c.contract_no FROM contracts c
                                       WHERE c.customer_id = cu.id
                                       ORDER BY c.start_date DESC LIMIT 1))
             ORDER BY cu.created_at)
        INTO v_matches
        FROM customers cu
       WHERE cu.branch_id = p_branch_id AND cu.name_key = v_key;
      IF v_matches IS NOT NULL THEN
        RAISE EXCEPTION 'a customer with this name already exists in this branch'
          USING ERRCODE = 'AG001', DETAIL = v_matches::text;
      END IF;
    END IF;

    INSERT INTO customers (branch_id, name, customer_type)
    VALUES (p_branch_id, btrim(p_customer_name), nullif(btrim(p_customer_type), ''))
    RETURNING id INTO v_customer_id;
  END IF;

  -- ---------- สัญญา ----------
  IF p_contract_id IS NULL THEN
    INSERT INTO contracts (
      customer_id, contract_no, start_date, end_date, term_years, value_total, sale_type,
      sale_name, am_name, is_urgent, renewed_from_contract_id, mail_received_date,
      first_service_date, first_service_time, note)
    VALUES (
      v_customer_id, p_contract_no, p_start_date, p_end_date, p_term_years, p_value_total,
      p_sale_type, nullif(btrim(p_sale_name), ''), nullif(btrim(p_am_name), ''),
      coalesce(p_is_urgent, false), p_renewed_from_contract_id, p_mail_received_date,
      p_first_service_date, p_first_service_time, nullif(btrim(p_note), ''))
    RETURNING id INTO v_contract_id;
  ELSE
    UPDATE contracts c SET
      customer_id              = v_customer_id,
      contract_no              = p_contract_no,
      start_date               = p_start_date,
      end_date                 = p_end_date,
      term_years               = p_term_years,
      value_total              = p_value_total,
      sale_type                = p_sale_type,
      sale_name                = nullif(btrim(p_sale_name), ''),
      am_name                  = nullif(btrim(p_am_name), ''),
      is_urgent                = coalesce(p_is_urgent, false),
      renewed_from_contract_id = p_renewed_from_contract_id,
      mail_received_date       = p_mail_received_date,
      first_service_date       = p_first_service_date,
      first_service_time       = p_first_service_time,
      note                     = nullif(btrim(p_note), '')
    WHERE c.id = p_contract_id
      AND c.updated_at = p_expected_updated_at   -- มีคนแก้ระหว่างอ่านกับเขียน = 0 แถว
    RETURNING c.id INTO v_contract_id;
    -- 0 แถว: มีคนแก้ไปก่อน (AG008) หรือ RLS ไม่ให้แก้ (ไม่ error แค่ 0 แถว → แปลงเป็น 42501)
    IF v_contract_id IS NULL THEN
      IF (SELECT c.updated_at FROM contracts c WHERE c.id = p_contract_id)
         IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'this contract was changed by someone else' USING ERRCODE = 'AG008';
      END IF;
      RAISE EXCEPTION 'not allowed to update this contract' USING ERRCODE = '42501';
    END IF;

    -- ทีมที่ไม่อยู่ในรายการใหม่ → ลบ
    DELETE FROM contract_teams ct
     WHERE ct.contract_id = v_contract_id AND NOT (ct.team_id = ANY (v_team_ids));
  END IF;

  -- ---------- ทีม (เพิ่มเฉพาะที่ยังไม่มี) ----------
  INSERT INTO contract_teams (contract_id, team_id)
  SELECT v_contract_id, t FROM unnest(v_team_ids) t
  ON CONFLICT DO NOTHING;

  -- ---------- เปลี่ยนไปใช้ลูกค้ารายอื่น: ลูกค้าเดิมที่ไม่เหลือสัญญาลบทิ้ง (ไม่ปล่อย PII ค้าง) ----------
  IF v_old_customer IS NOT NULL AND v_old_customer <> v_customer_id
     AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.customer_id = v_old_customer) THEN
    DELETE FROM customers cu WHERE cu.id = v_old_customer;
  END IF;

  RETURN QUERY SELECT v_contract_id, v_customer_id, v_reused,
                      CASE WHEN v_reused THEN v_customer_type END,
                      (SELECT c.updated_at FROM contracts c WHERE c.id = v_contract_id);
END;
$$;

-- =====================================================================
-- 4. สิทธิ์ (function ใหม่ / สร้างใหม่ ต้องกำหนดในไฟล์นี้ — CLAUDE.md)
-- =====================================================================
REVOKE ALL ON FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, integer, numeric, public.sale_type, uuid[], uuid, uuid,
  boolean, text, text, boolean, uuid, date, date, time, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, integer, numeric, public.sale_type, uuid[], uuid, uuid,
  boolean, text, text, boolean, uuid, date, date, time, text, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, integer, numeric, public.sale_type, uuid[], uuid, uuid,
  boolean, text, text, boolean, uuid, date, date, time, text, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.contracts_set_updated_at()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contracts_closed_guard()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contract_teams_closed_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stations_contract_move_guard() FROM PUBLIC, anon, authenticated;
