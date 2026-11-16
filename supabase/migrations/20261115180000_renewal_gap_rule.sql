-- M28 (DECISIONS 2.51 · เจ้าของอนุมัติ 16 พ.ย. 2026): กฎช่องว่าง 2 เดือน — Renew หรือ New
--
-- ⚠ M30 (สัญญาสั้น term_months) ต้องต่อจาก `save_job_opening` ในไฟล์นี้ (ไม่ใช่ 20261112140000)
--   และแก้ "วันจบ" ที่ `contract_effective_end_date` จุดเดียว (ฝั่ง TS: lib/rules/renewalGap.ts `effectiveEndDate`)
--
-- Logic summary:
--   1. กฎ (2.51): Renew ได้เฉพาะเมื่อ เดือนเริ่มของสัญญาใหม่ ≤ เดือนจบของสัญญาเก่า + 2 เดือน
--        จบ 31 ธ.ค. 2026 → เริ่ม ม.ค.–ก.พ. 2027 = Renew · เริ่ม มี.ค. 2027 ขึ้นไป = ต้องเปิดเป็น New
--      * "วันจบ" = end_date (ว่าง = วันเริ่ม + N ปี − 1 วัน) → `contract_effective_end_date` · ตั้งใจใช้ end_date
--        ไม่ใช่เดือนบริการสุดท้าย (เริ่ม 15 ม.ค. 2026 → จบ 14 ม.ค. 2027 → Renew ได้ถึง มี.ค. 2027)
--      * ซ้อนกัน (สัญญาใหม่เริ่มก่อนสัญญาเก่าจบ) = **Renew ได้** (ค่าเริ่มต้นตาม brief)
--      * สัญญาใหม่ต้องเริ่ม **หลัง** วันเริ่มสัญญาเก่า (เริ่มก่อน/วันเดียวกัน = ไม่ใช่การต่อสัญญา → AG010)
--      * ผูกสัญญาเก่า (renewed_from_contract_id มีค่า) ⇒ sale_type ต้องเป็น 'renew' (AG011)
--        ทางกลับไม่บังคับ: sale_type 'renew' ที่ไม่ผูกสัญญาเก่ายังได้ (สัญญาเก่าไม่อยู่ในระบบ / ข้อมูลเก่า ·
--        2.38 ค นับ New/Renew จากลิงก์ ไม่ใช่ sale_type) — ถามเจ้าของแล้วค่อยบังคับ
--      * บังคับ 2 ชั้น: `save_job_opening` (ตรวจก่อน ข้อความชัด) + trigger `contracts_renewal_gap_guard`
--        บน contracts (INSERT + UPDATE ผ่าน REST ข้ามไม่ได้)
--          - ฝั่งสัญญาใหม่: INSERT ที่ผูกสัญญาเก่า หรือ UPDATE ที่เปลี่ยน start_date / sale_type / ลิงก์
--          - ฝั่งสัญญาเก่า: แก้ start_date / end_date / term_years จนสัญญา Renew ที่ผูกอยู่ (ยังไม่ยกเลิก) หลุดช่วง → AG010
--          - แก้ช่องอื่น (เช่นหมายเหตุ) ของข้อมูลเก่าที่ผิดกฎอยู่แล้ว → ไม่ติด (ตรวจเฉพาะเมื่อค่าที่เกี่ยวเปลี่ยน)
--      * ใช้กับผู้ใช้ที่ล็อกอิน (current_user = 'authenticated') เท่านั้น — แนวเดียวกับ M12/M23:
--        postgres / service_role / migration / นำเข้าข้อมูลเก่า ผ่าน (ข้อมูลเก่าอาจต่อสัญญาก่อนมีกฎนี้)
--      * trigger เป็น SECURITY INVOKER อ่านสัญญาเก่าตาม RLS ของผู้เขียน — Renew ต้องเป็นลูกค้าเดียวกัน (M9) จึงอยู่สาขา
--        เดียวกันและมองเห็นเสมอ · มองไม่เห็น/ไม่มีจริง → ปล่อยให้ M9 (P0001) / FK (23503) ปฏิเสธเอง
--      * ชื่อ trigger เรียงหลัง contracts_renewal_same_customer (P0001) และ contracts_renewed_from_lock (AG009)
--        → 2 ตัวนั้นยังชนะก่อน (เทส 21 / 35 พึ่งลำดับนี้) · AG009 ของ M23 ไม่ถูกแตะ
--   2. New = นับหนึ่งใหม่: ไม่ผูกสัญญาเก่า → ย้ายสถานีไม่ได้ — `initialize_contract_stations` (M19b) ปฏิเสธอยู่แล้ว
--      (มีสถานีที่จะย้าย แต่สัญญาไม่มี renewed_from → SV008) → **ไม่แทนที่ function นั้น** · เทส 43 ยืนยัน
--      สถานีของสัญญาเก่าเก็บ/ไม่เก็บที่สัญญาเก่าเอง (collect_ig_stations รับ contract ของสถานี) ไม่ตามไปสัญญาใหม่
--   3. โมฆะ (2.47 ขยายตาม 2.51): `contract_is_renewed` (ชื่อ/signature เดิม — ผู้เรียกไม่ต้องแก้) = สัญญานี้ "ถูกแทนแล้ว"
--      เมื่อมีสัญญาอื่นที่ **ยังไม่ยกเลิก** (2.48 ②) และ
--        (ก) renewed_from_contract_id = สัญญานี้ หรือ
--        (ข) เป็น New (renewed_from ว่าง) ของลูกค้าคนเดียวกัน ที่ start_date > วันจบของสัญญานี้
--      * Renew ที่ผูกสัญญาอื่นของลูกค้าเดียวกัน ไม่นับเป็น (ข) (ลูกค้าหลายสัญญาพร้อมกัน — ต่อคนละหน้างาน)
--      * ผู้เรียกที่ได้ผลใหม่อัตโนมัติ (เนื้อไม่เปลี่ยน): visits_makeup_link_guard · resolve_missed_service ·
--        reopen_missed_service (MS011 — 2.48 ④ ห้าม "ไม่ชดเชย"/ชดเชย/เปิดกลับ บนสัญญาที่ถูกแทน) ·
--        save_missed_service_note (M24)
--      * `list_pending_missed_services` เดิมเขียนเงื่อนไขซ้ำในตัว → แทนที่ให้เรียก contract_is_renewed (นิยามเดียว)
--      * ไม่แตะ SV010 (ลบการเข้าของสัญญาที่ถูก Renew — 20261112180000) เป็นกฎคนละเรื่อง (สถานีย้ายไปแล้ว)
--      * lib/rules: `isSuperseded` (missedResolution.ts) ตรงกับฟังก์ชันนี้
--   4. error ใหม่ (ข้อความไทยอยู่ใน HINT ให้หน้าจอแสดงได้เลย):
--        AG010 สัญญาใหม่เริ่มเกิน 2 เดือนหลังสัญญาเก่าจบ (หรือไม่ได้เริ่มหลังสัญญาเก่า) → เปิดเป็น New
--              DETAIL = เดือนสุดท้ายที่ยังเริ่มแบบ Renew ได้ 'YYYY-MM'
--        AG011 ผูกสัญญาเก่าแต่ sale_type ไม่ใช่ 'renew'

-- =====================================================================
-- 1. ตัวช่วย (pure — ไม่อ่านตาราง)
-- =====================================================================
-- วันจบที่ใช้จริง = end_date · ว่าง = วันเริ่ม + N ปี − 1 วัน
--   คิดแบบเดียวกับ lib/rules addYearsMinusDay (Date.UTC ล้นเดือนได้): 29 ก.พ. + 1 ปี − 1 วัน = 28 ก.พ.
--   (`date + interval '1 year'` ของ Postgres ได้ 27 ก.พ. — จึงไม่ใช้)
CREATE FUNCTION public.contract_effective_end_date(p_start_date date, p_end_date date, p_term_years integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    p_end_date,
    make_date(extract(year FROM p_start_date)::int + p_term_years, extract(month FROM p_start_date)::int, 1)
      + (extract(day FROM p_start_date)::int - 1) - 1)
$$;

-- เดือนสุดท้ายที่สัญญาใหม่ยังเริ่มแบบ Renew ได้ (วันที่ 1 ของเดือน)
CREATE FUNCTION public.renewal_latest_start_month(p_old_start date, p_old_end date, p_old_term integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT (date_trunc('month', public.contract_effective_end_date(p_old_start, p_old_end, p_old_term))
          + interval '2 months')::date
$$;

-- สัญญาใหม่ที่เริ่ม p_new_start นับเป็น Renew ของสัญญาเก่าได้ไหม (NULL เข้า → false)
CREATE FUNCTION public.renewal_gap_ok(p_old_start date, p_old_end date, p_old_term integer, p_new_start date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    p_new_start > p_old_start
    AND date_trunc('month', p_new_start)::date
        <= public.renewal_latest_start_month(p_old_start, p_old_end, p_old_term),
    false)
$$;

REVOKE ALL ON FUNCTION public.contract_effective_end_date(date, date, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.renewal_latest_start_month(date, date, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.renewal_gap_ok(date, date, integer, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_effective_end_date(date, date, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.renewal_latest_start_month(date, date, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.renewal_gap_ok(date, date, integer, date) TO authenticated, service_role;

-- =====================================================================
-- 2. trigger บน contracts (กัน REST ข้าม RPC)
-- =====================================================================
CREATE FUNCTION public.contracts_renewal_gap_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_start date;
  v_old_end   date;
  v_old_term  integer;
  v_latest    date;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- ---------- ฝั่งสัญญาใหม่ (สัญญานี้ผูกสัญญาเก่า) ----------
  IF NEW.renewed_from_contract_id IS NOT NULL
     AND NEW.renewed_from_contract_id IS DISTINCT FROM NEW.id          -- ชี้ตัวเอง → CHECK constraint ปฏิเสธเอง
     AND (TG_OP = 'INSERT'
          OR NEW.start_date IS DISTINCT FROM OLD.start_date
          OR NEW.sale_type IS DISTINCT FROM OLD.sale_type
          OR NEW.renewed_from_contract_id IS DISTINCT FROM OLD.renewed_from_contract_id) THEN
    IF NEW.sale_type IS DISTINCT FROM 'renew' THEN
      RAISE EXCEPTION 'a contract linked to an old contract must have sale_type renew'
        USING ERRCODE = 'AG011',
              HINT = 'สัญญาที่ผูกกับสัญญาเก่าต้องเป็นประเภท Renew — ถ้าเป็นลูกค้าใหม่ (New) ไม่ต้องผูกสัญญาเก่า';
    END IF;
    SELECT o.start_date, o.end_date, o.term_years
      INTO v_old_start, v_old_end, v_old_term
      FROM public.contracts o
     WHERE o.id = NEW.renewed_from_contract_id;
    IF FOUND AND NOT public.renewal_gap_ok(v_old_start, v_old_end, v_old_term, NEW.start_date) THEN
      v_latest := public.renewal_latest_start_month(v_old_start, v_old_end, v_old_term);
      IF NEW.start_date <= v_old_start THEN
        RAISE EXCEPTION 'a renewal must start after the old contract starts'
          USING ERRCODE = 'AG010', DETAIL = to_char(v_latest, 'YYYY-MM'),
                HINT = 'วันเริ่มสัญญาใหม่ต้องอยู่หลังวันเริ่มสัญญาเก่า — ตรวจวันที่ หรือเปิดเป็นลูกค้าใหม่ (New)';
      END IF;
      RAISE EXCEPTION 'a renewal must start within 2 months after the old contract ends; open it as New'
        USING ERRCODE = 'AG010', DETAIL = to_char(v_latest, 'YYYY-MM'),
              HINT = 'สัญญาใหม่เริ่มเกิน 2 เดือนหลังสัญญาเก่าจบ (กฎบริษัท) — ให้เปิดงานเป็นลูกค้าใหม่ (New) ไม่ผูกสัญญาเก่า';
    END IF;
  END IF;

  -- ---------- ฝั่งสัญญาเก่า (มีสัญญา Renew ผูกอยู่) แก้วันที่/ระยะเวลา ----------
  IF TG_OP = 'UPDATE'
     AND (NEW.start_date IS DISTINCT FROM OLD.start_date
          OR NEW.end_date IS DISTINCT FROM OLD.end_date
          OR NEW.term_years IS DISTINCT FROM OLD.term_years)
     AND EXISTS (SELECT 1 FROM public.contracts r
                  WHERE r.renewed_from_contract_id = NEW.id AND r.id <> NEW.id
                    AND r.status <> 'cancelled' AND r.cancelled_at IS NULL
                    AND NOT public.renewal_gap_ok(NEW.start_date, NEW.end_date, NEW.term_years, r.start_date)) THEN
    RAISE EXCEPTION 'this change would put a linked renewal outside the 2-month window'
      USING ERRCODE = 'AG010',
            DETAIL = to_char(public.renewal_latest_start_month(NEW.start_date, NEW.end_date, NEW.term_years), 'YYYY-MM'),
            HINT = 'แก้วันที่ของสัญญานี้แล้ว สัญญาที่ต่อ (Renew) จากสัญญานี้จะเริ่มเกิน 2 เดือนหลังวันจบ — แก้ไม่ได้';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.contracts_renewal_gap_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER contracts_renewal_gap_guard
  BEFORE INSERT OR UPDATE OF start_date, end_date, term_years, sale_type, renewed_from_contract_id
  ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_renewal_gap_guard();

-- =====================================================================
-- 3. โมฆะ: contract_is_renewed = "ถูกแทนแล้ว" (Renew ผูกมา หรือ New ที่เริ่มหลังสัญญานี้จบ)
--    เนื้อเดิม 20261114200000 · ชื่อ/signature/สิทธิ์เดิม (CREATE OR REPLACE คง GRANT) · SECURITY INVOKER เหมือนเดิม
-- =====================================================================
CREATE OR REPLACE FUNCTION public.contract_is_renewed(p_contract_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM contracts o
      JOIN contracts n ON n.id <> o.id
     WHERE o.id = p_contract_id
       AND n.status <> 'cancelled' AND n.cancelled_at IS NULL
       AND (n.renewed_from_contract_id = o.id
            OR (n.renewed_from_contract_id IS NULL
                AND n.customer_id = o.customer_id
                AND n.start_date > contract_effective_end_date(o.start_date, o.end_date, o.term_years))))
$$;

-- =====================================================================
-- 4. list_pending_missed_services — เนื้อเดิม 20261114200000 · แก้จุดเดียว: เงื่อนไข "ต่อแล้ว" ที่เขียนซ้ำในตัว
--    → เรียก contract_is_renewed (นิยามใหม่ M28)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.list_pending_missed_services(p_branch_id uuid DEFAULT NULL, p_month date DEFAULT NULL)
RETURNS TABLE (
  contract_id           uuid,
  customer_id           uuid,
  branch_id             uuid,
  missed_month          date,
  last_service_month    date,
  makeup_deadline_month date,
  past_deadline         boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role      text := current_app_role();
  v_now_month date := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
  v_upto      date;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'not allowed to read missed services' USING ERRCODE = '42501';
  END IF;
  v_upto := least(coalesce(date_trunc('month', p_month)::date, v_now_month), v_now_month);

  RETURN QUERY
  WITH c AS (
    SELECT ct.id AS contract_id, cu.id AS customer_id, cu.branch_id,
           missed_tracking_start_month(ct.start_date, ct.stations_initialized_at) AS track_from,
           (date_trunc('month', ct.start_date) + make_interval(months => ct.term_years * 12 - 1))::date AS last_month
      FROM contracts ct
      JOIN customers cu ON cu.id = ct.customer_id
     WHERE ct.status <> 'cancelled' AND ct.cancelled_at IS NULL
       AND NOT contract_is_renewed(ct.id)                         -- 2.47 + 2.51 ถูกแทนแล้ว (Renew / New ที่ใหม่กว่า)
       AND ct.stations_initialized_at IS NOT NULL
       AND (p_branch_id IS NULL OR cu.branch_id = p_branch_id)
       AND (v_role <> 'recorder' OR contract_in_scope(ct.id))
  ), m AS (
    SELECT c.*, gs::date AS missed_month
      FROM c,
           generate_series(c.track_from, least(c.last_month, (v_upto - interval '1 month')::date),
                           interval '1 month') gs
  )
  SELECT m.contract_id, m.customer_id, m.branch_id, m.missed_month, m.last_month,
         (m.last_month + make_interval(months => missed_makeup_deadline_months()))::date,
         v_now_month > (m.last_month + make_interval(months => missed_makeup_deadline_months()))::date
    FROM m
   WHERE NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = m.contract_id AND vi.visit_type = 'routine'
                        AND vi.makeup_for_month IS NULL
                        AND vi.visit_date >= m.missed_month
                        AND vi.visit_date < (m.missed_month + interval '1 month')::date)
     AND NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = m.contract_id AND vi.makeup_for_month = m.missed_month)
     AND NOT EXISTS (SELECT 1 FROM missed_service_resolutions r
                      WHERE r.contract_id = m.contract_id AND r.missed_month = m.missed_month
                        AND r.kind = 'waived')
   ORDER BY m.branch_id, m.customer_id, m.contract_id, m.missed_month;
END;
$$;

-- =====================================================================
-- 5. save_job_opening — เนื้อเดิม 20261112140000 (M12) · signature เดิม → CREATE OR REPLACE คงสิทธิ์
--    แก้เฉพาะจุดติดป้าย "M28": อ่านค่าเดิม (start/sale_type/ลิงก์) ในโหมดแก้ + ตรวจ AG011 / AG010 ก่อนเขียน
-- =====================================================================
CREATE OR REPLACE FUNCTION public.save_job_opening(
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
  -- M28: ค่าเดิมของสัญญา (โหมดแก้) + วันที่ของสัญญาเก่าที่ผูก
  v_cur_start     date;
  v_cur_sale      public.sale_type;
  v_cur_link      uuid;
  v_o_start       date;
  v_o_end         date;
  v_o_term        integer;
BEGIN
  -- ---------- ล้มเร็ว: admin นอกขอบเขตหน่วยงาน (RLS ปฏิเสธอยู่แล้ว นี่แค่ไม่ต้องทำงานเปล่า) ----------
  --   host ข้ามได้: policy ของ host ไม่ขึ้นกับ division_scope
  IF NOT is_host() AND NOT branch_in_scope(p_branch_id) THEN
    RAISE EXCEPTION 'branch is outside your division' USING ERRCODE = '42501';
  END IF;

  -- ---------- โหมดแก้: สัญญาต้องมีอยู่และมองเห็น · ห้ามย้ายสาขา ----------
  IF p_contract_id IS NOT NULL THEN
    SELECT c.customer_id, cu.branch_id, c.status, c.updated_at,
           c.start_date, c.sale_type, c.renewed_from_contract_id                -- M28
      INTO v_old_customer, v_old_branch, v_status, v_updated_at,
           v_cur_start, v_cur_sale, v_cur_link
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

  -- ---------- M28 / DECISIONS 2.51: Renew ต้องเริ่มไม่เกิน 2 เดือนหลังสัญญาเก่าจบ ----------
  --   ตรวจเมื่อเปิดงานใหม่ที่ผูกสัญญาเก่า หรือโหมดแก้ที่เปลี่ยนวันเริ่ม/sale_type (ลิงก์เดิม) — เปลี่ยนลิงก์ในโหมดแก้
  --   ปล่อยให้ AG009 (M23) ปฏิเสธเอง · trigger contracts_renewal_gap_guard กันซ้ำทุกทาง (รวม REST)
  IF p_renewed_from_contract_id IS NOT NULL
     AND (p_contract_id IS NULL
          OR (p_renewed_from_contract_id IS NOT DISTINCT FROM v_cur_link
              AND (p_start_date IS DISTINCT FROM v_cur_start OR p_sale_type IS DISTINCT FROM v_cur_sale))) THEN
    IF p_sale_type IS DISTINCT FROM 'renew' THEN
      RAISE EXCEPTION 'a contract linked to an old contract must have sale_type renew'
        USING ERRCODE = 'AG011',
              HINT = 'สัญญาที่ผูกกับสัญญาเก่าต้องเป็นประเภท Renew — ถ้าเป็นลูกค้าใหม่ (New) ไม่ต้องผูกสัญญาเก่า';
    END IF;
    SELECT o.start_date, o.end_date, o.term_years INTO v_o_start, v_o_end, v_o_term
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

-- ย้ำสิทธิ์ (CREATE OR REPLACE คงไว้อยู่แล้ว — กันพลาด)
REVOKE ALL ON FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, integer, numeric, public.sale_type, uuid[], uuid, uuid,
  boolean, text, text, boolean, uuid, date, date, time, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, integer, numeric, public.sale_type, uuid[], uuid, uuid,
  boolean, text, text, boolean, uuid, date, date, time, text, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.list_pending_missed_services(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_missed_services(uuid, date) TO authenticated;
REVOKE ALL ON FUNCTION public.contract_is_renewed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_is_renewed(uuid) TO authenticated;
