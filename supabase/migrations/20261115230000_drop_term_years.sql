-- =====================================================================
-- M30b — ลบ contracts.term_years (กระจกชั่วคราวของ M30) หลัง FE ย้ายไปใช้ term_months แล้ว
--        (DECISIONS 2.53 / M30 · หมวด 2 · 17 พ.ย. 2026)
--
-- สรุป logic (ทีมอ่านตรงนี้ก่อน):
--   * contracts.term_months (1–36) = แหล่งข้อมูลเดียวของระยะสัญญา · 12 = 1 ปี · 36 = 3 ปี · อื่น = Custom
--   * ลบ: trigger contracts_00_term_sync + function contracts_term_sync · ตัวช่วย contract_term_years_of ·
--     คอลัมน์ term_years (CHECK term_years IN (1,3) + contracts_term_years_mirror_check หายไปพร้อมคอลัมน์)
--   * สร้างใหม่จากเนื้อ "ล่าสุด" แก้เฉพาะจุดติดป้าย "M30b":
--       - trigger contracts_renewed_gap_guard (ตัว function ไม่อ่าน term_years แล้ว — แก้แค่รายการคอลัมน์ที่ฟัง)
--       - list_unlinked_renewals (เนื้อ M28b) — ตัดคอลัมน์ผลลัพธ์ term_years → return type เปลี่ยน = DROP + CREATE
--       - save_job_opening (เนื้อ M30) — ตัดพารามิเตอร์ p_term_years · p_term_months บังคับ (NULL → 22004)
--         AG016 / AG017 ไม่เกิดจาก RPC นี้อีก (ไม่มีปีให้ขัดกัน) → signature เปลี่ยน = DROP + CREATE + สิทธิ์เดิม
--   * ผู้เขียนแบบเดิมที่ยังส่ง term_years (REST / RPC) จะได้ error ชัดเจน (42703 column / 42883 function) — ไม่เงียบ
--   * ลำดับ: ต้องมาหลัง 20261115220000 (M35) · ไม่แตะ audit_trigger · RLS เดิมคงเดิม · dashboard_data.json ไม่เปลี่ยน
--   * ข้อมูลไม่เปลี่ยน: term_months NOT NULL + CHECK 1–36 ตั้งแต่ M30 (กระจกตรงกันเสมอ ไม่มีอะไรต้อง backfill)
-- =====================================================================

-- =====================================================================
-- 1. กระจก term_years ↔ term_months
-- =====================================================================
DROP TRIGGER contracts_00_term_sync ON public.contracts;
DROP FUNCTION public.contracts_term_sync();

-- =====================================================================
-- 2. trigger contracts_renewed_gap_guard — เนื้อเดิม 20261115200000 (M30 ข้อ 11)
--    แก้ M30b: ตัด term_years ออกจากรายการคอลัมน์ที่ฟัง (ตัว function ใช้ term_months อยู่แล้ว ไม่ต้องสร้างใหม่)
--    ต้องทำก่อนลบคอลัมน์ (trigger ที่ฟังคอลัมน์ผูก dependency ไว้)
-- =====================================================================
DROP TRIGGER contracts_renewed_gap_guard ON public.contracts;
CREATE TRIGGER contracts_renewed_gap_guard
  BEFORE INSERT OR UPDATE OF start_date, end_date, term_months, sale_type, renewed_from_contract_id,
                             status, cancelled_at, renew_unlinked_reason
  ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_renewed_gap_guard();

-- =====================================================================
-- 3. list_unlinked_renewals — เนื้อเดิม 20261115210000 (M28b ข้อ 6)
--    แก้ M30b: ตัดคอลัมน์ term_years (integer) ออกจากผลลัพธ์ · คอลัมน์อื่น/ลำดับ/เงื่อนไขเหมือนเดิม
-- =====================================================================
DROP FUNCTION public.list_unlinked_renewals(uuid);

CREATE FUNCTION public.list_unlinked_renewals(p_branch_id uuid DEFAULT NULL)
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
     AND (p_branch_id IS NULL OR cu.branch_id = p_branch_id)
     AND (v_role = 'host' OR branch_in_scope(cu.branch_id))
   ORDER BY c.created_at, c.id;
END;
$$;
REVOKE ALL ON FUNCTION public.list_unlinked_renewals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_unlinked_renewals(uuid) TO authenticated;


-- =====================================================================
-- 4. save_job_opening — เนื้อเดิม 20261115200000 (M30 ข้อ 13) · แก้เฉพาะจุดติดป้าย "M30b":
--    ตัดพารามิเตอร์ p_term_years (ตัวสุดท้าย) + ด่านที่ใช้ปี (23514 ปี / AG016 / AG017) + v_cur_term ที่ใช้แค่ AG017
--    p_term_months ยัง DEFAULT NULL (อยู่หลังพารามิเตอร์ที่มี default) แต่ NULL → 22004 เหมือนเดิม
--    signature เปลี่ยน → DROP + CREATE + สิทธิ์เดิม (authenticated เท่านั้น)
-- =====================================================================
DROP FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, numeric, public.sale_type, uuid[], uuid, uuid, boolean, text, text, boolean, uuid, date, date, time, text, timestamptz, text, integer, integer);

CREATE FUNCTION public.save_job_opening(
  p_branch_id                uuid,
  p_customer_name            text,
  p_customer_type            text,
  p_contract_no              text,
  p_start_date               date,
  p_end_date                 date,
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
  p_expected_updated_at      timestamptz DEFAULT NULL,
  p_renew_unlinked_reason    text    DEFAULT NULL,           -- M28 รอบ 2
  p_term_months              integer DEFAULT NULL            -- M30: ระยะสัญญา (เดือน 1–36) · M30b: บังคับ (NULL → 22004)
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
  -- M28: ค่าเดิมของสัญญา (โหมดแก้) + วันที่ของสัญญาเก่าที่ผูก
  v_cur_start     date;
  v_cur_sale      public.sale_type;
  v_cur_link      uuid;
  v_o_start       date;
  v_o_end         date;
  v_o_term        integer;
  v_cur_reason    text;                                     -- M28 รอบ 2
  v_was_unlinked  boolean := false;
  v_reason        text := nullif(btrim(p_renew_unlinked_reason), '');
  v_term_months   integer := p_term_months;                 -- M30b: ไม่รับระยะแบบปีแล้ว
  v_added         uuid[];                                   -- M26/33: ทีมที่เพิ่มเทียบกับ contract_teams เดิม
  v_bad_teams     text;                                     -- M26/33
BEGIN
  -- ---------- ล้มเร็ว: admin นอกขอบเขตหน่วยงาน (RLS ปฏิเสธอยู่แล้ว นี่แค่ไม่ต้องทำงานเปล่า) ----------
  --   host ข้ามได้: policy ของ host ไม่ขึ้นกับ division_scope
  IF NOT is_host() AND NOT branch_in_scope(p_branch_id) THEN
    RAISE EXCEPTION 'branch is outside your division' USING ERRCODE = '42501';
  END IF;

  -- ---------- โหมดแก้: สัญญาต้องมีอยู่และมองเห็น · ห้ามย้ายสาขา ----------
  IF p_contract_id IS NOT NULL THEN
    SELECT c.customer_id, cu.branch_id, c.status, c.updated_at,
           c.start_date, c.sale_type, c.renewed_from_contract_id, c.renew_unlinked_reason   -- M28
      INTO v_old_customer, v_old_branch, v_status, v_updated_at,
           v_cur_start, v_cur_sale, v_cur_link, v_cur_reason
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
    IF date_trunc('milliseconds', v_updated_at) IS DISTINCT FROM date_trunc('milliseconds', p_expected_updated_at) THEN
      RAISE EXCEPTION 'this contract was changed by someone else' USING ERRCODE = 'AG008';
    END IF;
  END IF;

  -- ---------- M30 / DECISIONS 2.53: ระยะสัญญา (เดือน) ----------
  IF v_term_months IS NULL THEN
    RAISE EXCEPTION 'contract term is required (p_term_months)' USING ERRCODE = '22004';
  END IF;
  -- M30b: ลบพารามิเตอร์ระยะแบบปี + ด่านที่ใช้ปี (23514 ปีไม่ใช่ 1/3 · AG016 ปีกับเดือนขัดกัน · AG017 แก้ Custom ด้วยปี)
  --   ช่วง 1–36 → CHECK contracts_term_months_check (23514) เหมือนเดิม

  -- ---------- M28 / DECISIONS 2.51: Renew ต้องเริ่มไม่เกิน 2 เดือนหลังสัญญาเก่าจบ ----------
  --   ตรวจเมื่อเปิดงานใหม่ที่ผูกสัญญาเก่า หรือโหมดแก้ที่เปลี่ยนวันเริ่ม/sale_type (ลิงก์เดิม) — เปลี่ยนลิงก์ในโหมดแก้
  --   ปล่อยให้ AG009 (M23) ปฏิเสธเอง · trigger contracts_renewed_gap_guard กันซ้ำทุกทาง (รวม REST)
  IF p_renewed_from_contract_id IS NOT NULL
     AND (p_contract_id IS NULL
          OR (p_renewed_from_contract_id IS NOT DISTINCT FROM v_cur_link
              AND (p_start_date IS DISTINCT FROM v_cur_start OR p_sale_type IS DISTINCT FROM v_cur_sale))) THEN
    IF p_sale_type IS DISTINCT FROM 'renew' THEN
      RAISE EXCEPTION 'a contract linked to an old contract must have sale_type renew'
        USING ERRCODE = 'AG011',
              HINT = 'สัญญาที่ผูกกับสัญญาเก่าต้องเป็นประเภท Renew — ถ้าเป็นลูกค้าใหม่ (New) ไม่ต้องผูกสัญญาเก่า';
    END IF;
    SELECT o.start_date, o.end_date, o.term_months INTO v_o_start, v_o_end, v_o_term
      FROM contracts o WHERE o.id = p_renewed_from_contract_id;
    -- ไม่พบ (ไม่มีจริง/มองไม่เห็น) → ปล่อยให้ FK (23503) / M9 (P0001) ปฏิเสธตามเดิม
    IF FOUND AND NOT renewal_gap_ok(v_o_start, v_o_end, v_o_term, p_start_date) THEN
      IF p_start_date <= v_o_start THEN
        RAISE EXCEPTION 'a renewal must start after the old contract starts'
          USING ERRCODE = 'AG010',
                DETAIL = to_char(renewal_latest_start_month(v_o_start, v_o_end, v_o_term), 'YYYY-MM'),
                HINT = 'วันเริ่มสัญญาใหม่ต้องอยู่หลังวันเริ่มสัญญาเก่า — ตรวจวันที่ หรือเปิดเป็นลูกค้าใหม่ (New)';
      END IF;
      RAISE EXCEPTION 'a renewal must start within 2 months after the old contract ends; open it as New'
        USING ERRCODE = 'AG010',
              DETAIL = to_char(renewal_latest_start_month(v_o_start, v_o_end, v_o_term), 'YYYY-MM'),
              HINT = 'สัญญาใหม่เริ่มเกิน 2 เดือนหลังสัญญาเก่าจบ (กฎบริษัท) — ให้เปิดงานเป็นลูกค้าใหม่ (New) ไม่ผูกสัญญาเก่า';
    END IF;
  END IF;

  -- ---------- M28 รอบ 2: Renew ไม่ผูกสัญญาเก่า — ต้องมีเหตุผล (AG012) · เปิดได้ถึงวันที่กำหนด (AG013) ----------
  --   ตรวจเมื่อ "กลายเป็น" Renew ไม่ผูก (เปิดงานใหม่ / เดิมไม่ใช่) หรือแก้เหตุผลจนว่าง — แบบเดียวกับ trigger
  --   New / ผูกแล้ว → ไม่เก็บเหตุผล (NULL · CHECK contracts_renew_unlinked_reason_check)
  --   โหมดแก้ที่ล้างลิงก์เดิม (มีค่า → NULL) ไม่ตรวจที่นี่ — ปล่อยให้ AG009 (M23) ปฏิเสธก่อน
  IF p_sale_type = 'renew' AND p_renewed_from_contract_id IS NULL
     AND (p_contract_id IS NULL OR v_cur_link IS NULL) THEN
    v_was_unlinked := p_contract_id IS NOT NULL AND coalesce(v_cur_sale = 'renew' AND v_cur_link IS NULL, false);
    IF v_reason IS NULL AND (NOT v_was_unlinked OR v_cur_reason IS NOT NULL) THEN
      RAISE EXCEPTION 'a renewal without a link to the old contract needs a reason'
        USING ERRCODE = 'AG012',
              HINT = 'Renew ที่ไม่ผูกสัญญาเก่า ต้องระบุเหตุผล (เช่น สัญญาเก่าไม่อยู่ในระบบ)';
    END IF;
    IF NOT v_was_unlinked AND NOT unlinked_renew_open() THEN
      RAISE EXCEPTION 'renewals without a link to the old contract are no longer allowed'
        USING ERRCODE = 'AG013', DETAIL = to_char(allow_unlinked_renew_until(), 'YYYY-MM-DD'),
              HINT = 'เลยช่วงที่เปิด Renew แบบไม่ผูกสัญญาเก่าได้แล้ว — เลือกสัญญาเก่าที่ต่อ หรือเปิดเป็นลูกค้าใหม่ (New)';
    END IF;
  ELSE
    v_reason := NULL;
  END IF;

  -- ---------- M26/33: ทีมที่ "เพิ่ม" (เปิดงานใหม่ = ทุกทีม · โหมดแก้ = ที่ยังไม่อยู่ใน contract_teams) ----------
  --   หัวหน้างาน → TM005 (L2) · ปิดใช้งาน → TM004 (M33) · ส่งรายการทีมเดิมครบชุดซ้ำ = ไม่มีทีมเพิ่ม → ผ่าน
  --   ทีมที่ไม่มีจริง → ปล่อยให้ FK (23503) ปฏิเสธตามเดิม · trigger team_links_guard ตรวจซ้ำตอน INSERT
  v_added := ARRAY(SELECT t FROM unnest(v_team_ids) t
                    WHERE p_contract_id IS NULL
                       OR NOT EXISTS (SELECT 1 FROM contract_teams ct
                                       WHERE ct.contract_id = p_contract_id AND ct.team_id = t));
  SELECT string_agg(tm.code, ',' ORDER BY tm.code) INTO v_bad_teams
    FROM teams tm WHERE tm.id = ANY (v_added) AND tm.kind = 'supervisor';
  IF v_bad_teams IS NOT NULL THEN
    RAISE EXCEPTION 'ทีม % เป็นทีมหัวหน้างาน ผูกกับสัญญาหรือการเข้าบริการไม่ได้', v_bad_teams
      USING ERRCODE = 'TM005', DETAIL = v_bad_teams;
  END IF;
  SELECT string_agg(tm.code, ',' ORDER BY tm.code) INTO v_bad_teams
    FROM teams tm WHERE tm.id = ANY (v_added) AND NOT tm.is_active;
  IF v_bad_teams IS NOT NULL THEN
    RAISE EXCEPTION 'ทีม % ปิดใช้งานอยู่ เลือกให้งานใหม่ไม่ได้', v_bad_teams
      USING ERRCODE = 'TM004', DETAIL = v_bad_teams;
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
    -- M26: สร้าง id เอง แล้วเปิดด่าน contracts_renewed_rpc_only เฉพาะแถวนี้ (is_local · ล้างทันทีหลัง INSERT)
    v_contract_id := gen_random_uuid();
    PERFORM set_config('aga.job_opening', v_contract_id::text, true);
    INSERT INTO contracts (
      id, customer_id, contract_no, start_date, end_date, term_months, value_total, sale_type,
      sale_name, am_name, is_urgent, renewed_from_contract_id, mail_received_date,
      first_service_date, first_service_time, note, renew_unlinked_reason)
    VALUES (
      v_contract_id, v_customer_id, p_contract_no, p_start_date, p_end_date, v_term_months, p_value_total,
      p_sale_type, nullif(btrim(p_sale_name), ''), nullif(btrim(p_am_name), ''),
      coalesce(p_is_urgent, false), p_renewed_from_contract_id, p_mail_received_date,
      p_first_service_date, p_first_service_time, nullif(btrim(p_note), ''), v_reason)
    RETURNING id INTO v_contract_id;
    PERFORM set_config('aga.job_opening', '', true);
  ELSE
    UPDATE contracts c SET
      customer_id              = v_customer_id,
      contract_no              = p_contract_no,
      start_date               = p_start_date,
      end_date                 = p_end_date,
      term_months              = v_term_months,             -- M30
      value_total              = p_value_total,
      sale_type                = p_sale_type,
      sale_name                = nullif(btrim(p_sale_name), ''),
      am_name                  = nullif(btrim(p_am_name), ''),
      is_urgent                = coalesce(p_is_urgent, false),
      renewed_from_contract_id = p_renewed_from_contract_id,
      mail_received_date       = p_mail_received_date,
      first_service_date       = p_first_service_date,
      first_service_time       = p_first_service_time,
      note                     = nullif(btrim(p_note), ''),
      renew_unlinked_reason    = v_reason
    WHERE c.id = p_contract_id
      AND date_trunc('milliseconds', c.updated_at) = date_trunc('milliseconds', p_expected_updated_at)
          -- มีคนแก้ระหว่างอ่านกับเขียน = 0 แถว
    RETURNING c.id INTO v_contract_id;
    -- 0 แถว: มีคนแก้ไปก่อน (AG008) หรือ RLS ไม่ให้แก้ (ไม่ error แค่ 0 แถว → แปลงเป็น 42501)
    IF v_contract_id IS NULL THEN
      IF (SELECT date_trunc('milliseconds', c.updated_at) FROM contracts c WHERE c.id = p_contract_id)
         IS DISTINCT FROM date_trunc('milliseconds', p_expected_updated_at) THEN
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
  SELECT v_contract_id, t FROM unnest(v_added) t             -- M26/33: เฉพาะทีมที่เพิ่ม (trigger team_links_guard ตรวจซ้ำ)
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
REVOKE ALL ON FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, numeric, public.sale_type, uuid[], uuid, uuid, boolean, text, text, boolean, uuid, date, date, time, text, timestamptz, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, numeric, public.sale_type, uuid[], uuid, uuid, boolean, text, text, boolean, uuid, date, date, time, text, timestamptz, text, integer) TO authenticated;

-- =====================================================================
-- 5. ตัวช่วยกระจกปี + คอลัมน์ term_years (สุดท้าย — หลังไม่มีอะไรอ่านแล้ว)
--    CHECK (term_years IN (1, 3)) และ contracts_term_years_mirror_check หายไปพร้อมคอลัมน์ · ไม่ใช้ CASCADE
--    (ถ้ายังมี object ใดผูก term_years อยู่ migration จะล้ม แทนที่จะลบของนั้นทิ้งเงียบๆ)
-- =====================================================================
DROP FUNCTION public.contract_term_years_of(integer);
ALTER TABLE public.contracts DROP COLUMN term_years;
