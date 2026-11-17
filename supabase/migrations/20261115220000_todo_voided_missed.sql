-- =====================================================================
-- M35 — ช่องข้อมูลที่หน้าจริง /todo (สถานะทะเบียนบริการ) ต้องการ (DECISIONS M35 · หมวด 1 แจ้ง 17 พ.ย. 2026)
--
-- สรุป logic (ทีมอ่านตรงนี้ก่อน):
--   ① รายการตกบริการที่ "โมฆะเพราะต่อสัญญาแล้ว" (2.47 + 2.51) — แสดงในส่วน "เรื่องที่ปิดแล้ว" ของ /todo
--     * `contract_renewed_by(p_contract_id)` = สัญญาที่ "แทน" สัญญานี้ (NULL = ยังไม่ถูกแทน)
--         กฎเดียวกับ `contract_is_renewed` ทุกตัวอักษร (เนื้อ M30) — ย้ายกฎมาไว้ที่นี่ที่เดียว แล้วให้
--         `contract_is_renewed` = `contract_renewed_by(...) IS NOT NULL` (นิยามเดียว ไม่เขียนกฎซ้ำ)
--         ถ้ามีหลายสัญญาเข้าเงื่อนไข เลือก: Renew ที่ผูกมา (renewed_from) ก่อน → เริ่มเร็วสุด → สร้างก่อน → id
--     * `list_voided_missed_services(p_branch_id, p_month)` — เกณฑ์ "เดือนตก" เดียวกับ list_pending_missed_services
--         (M18/M28/M30): ตั้งแต่เดือนตั้งสถานี · ภายในเดือนบริการของสัญญา (term_months) · ไม่มี routine ·
--         ไม่ชดเชย · ไม่ "ไม่ชดเชย" (waived) · สัญญาไม่ถูกยกเลิก — ต่างกันข้อเดียว: สัญญา **ถูกแทนแล้ว**
--       เดือนที่นับ = เดือนตกก่อน "เดือนเริ่มของสัญญาที่แทน" และก่อน p_month/เดือนปัจจุบัน
--         (Renew ที่ซ้อนช่วง: เดือนตั้งแต่สัญญาใหม่เริ่ม บริการย้ายไปสัญญาใหม่แล้ว ถ้านับจะได้เดือนตกปลอม
--          · New ที่แทนได้เริ่มหลังสัญญาเก่าจบเสมอ → ไม่ถูกตัด) · ⚠ ต่างจาก lib/rules missedResolutionStatus
--          ที่ไม่ตัดเดือนซ้อน (ทุกเดือนตกของสัญญาที่ถูกแทน = void_renewed) — รอ BE/เจ้าของยืนยัน
--       voided_at = เวลาที่บันทึกสัญญาที่แทน (created_at) — ข้อมูลประกอบ ไม่ใช้ตัดเดือน
--       void_reason: 'renewed' = สัญญาใหม่ผูกมา (Renew · 2.47) · 'new_contract' = New ที่เริ่มหลังสัญญานี้จบ (2.51)
--       คืนหมายเหตุ (missed_service_notes) ของเดือนนั้นด้วย ถ้ามี — หน้าจอไม่ต้องอ่านแยก
--     * สิทธิ์: SECURITY INVOKER (แพทเทิร์นเดียวกับ list_pending_missed_services) · host / admin ทุกสาขา ·
--       recorder เฉพาะสัญญาในขอบเขต (contract_in_scope) · viewer / ไม่มี role → 42501 · anon ไม่มี EXECUTE
--   ② เดือนที่กล่อง AG เข้าสถานะรอถอด — ⏳ รอเจ้าของเลือกวิธีเก็บ (เพิ่มคอลัมน์ = เปลี่ยน schema) · ไม่อยู่ในไฟล์นี้
--   * ไม่แตะ audit_trigger · ไม่เปลี่ยน RLS ของตารางใด · error ใหม่: ไม่มี (ใช้ 42501 เดิม)
-- =====================================================================

-- =====================================================================
-- 1. contract_renewed_by — กฎ "ถูกแทนแล้ว" (ย้ายมาจากเนื้อ contract_is_renewed ล่าสุด 20261115200000 · M30)
-- =====================================================================
CREATE FUNCTION public.contract_renewed_by(p_contract_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT n.id
    FROM contracts o
    JOIN contracts n ON n.id <> o.id
   WHERE o.id = p_contract_id
     AND n.status <> 'cancelled' AND n.cancelled_at IS NULL
     AND (n.renewed_from_contract_id = o.id
          OR (n.renewed_from_contract_id IS NULL
              AND n.customer_id = o.customer_id
              AND n.start_date > contract_effective_end_date(o.start_date, o.end_date, o.term_months)))
   ORDER BY (n.renewed_from_contract_id = o.id) DESC NULLS LAST, n.start_date, n.created_at, n.id
   LIMIT 1
$$;

COMMENT ON FUNCTION public.contract_renewed_by(uuid) IS
  'M35: id of the contract that supersedes this one (Renew linked to it, or a New contract of the same customer starting after it ended · DECISIONS 2.47/2.51) · NULL = not superseded. Single source of the rule behind contract_is_renewed.';

-- =====================================================================
-- 2. contract_is_renewed — เนื้อเดิม 20261115200000 (M30) · แก้: เรียก contract_renewed_by (กฎเดียวกัน ย้ายไปแล้ว)
--    signature / ภาษา / STABLE / สิทธิ์เดิม · ผลเท่าเดิมทุกกรณี (EXISTS ⇔ มีอย่างน้อย 1 แถว)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.contract_is_renewed(p_contract_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.contract_renewed_by(p_contract_id) IS NOT NULL
$$;

-- =====================================================================
-- 3. list_voided_missed_services — ตกบริการที่โมฆะเพราะต่อสัญญา / มีสัญญาใหม่ (ส่วน "เรื่องที่ปิดแล้ว" ของ /todo)
--   p_branch_id: NULL = ทุกสาขาที่มองเห็น · p_month: นับเดือนตกก่อนเดือนนี้ (NULL = เดือนปัจจุบัน · เกินปัจจุบัน = ปัจจุบัน)
-- =====================================================================
CREATE FUNCTION public.list_voided_missed_services(p_branch_id uuid DEFAULT NULL, p_month date DEFAULT NULL)
RETURNS TABLE (
  contract_id           uuid,
  customer_id           uuid,
  branch_id             uuid,
  missed_month          date,
  void_reason           text,
  voided_by_contract_id uuid,
  voided_by_start_date  date,
  voided_at             timestamptz,
  note                  text
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
           (date_trunc('month', ct.start_date) + make_interval(months => ct.term_months - 1))::date AS last_month,
           contract_renewed_by(ct.id) AS by_id
      FROM contracts ct
      JOIN customers cu ON cu.id = ct.customer_id
     WHERE ct.status <> 'cancelled' AND ct.cancelled_at IS NULL
       AND ct.stations_initialized_at IS NOT NULL
       AND (p_branch_id IS NULL OR cu.branch_id = p_branch_id)
       AND (v_role <> 'recorder' OR contract_in_scope(ct.id))
  ), r AS (
    SELECT c.*,
           CASE WHEN n.renewed_from_contract_id = c.contract_id THEN 'renewed' ELSE 'new_contract' END AS reason,
           n.start_date AS by_start,
           n.created_at AS by_created,
           -- เดือนแรกที่ไม่นับแล้ว = เดือนเริ่มของสัญญาที่แทน (ช่วงซ้อนของ Renew ไม่ใช่ "เดือนตก")
           date_trunc('month', n.start_date)::date AS void_month
      FROM c
      JOIN contracts n ON n.id = c.by_id
  ), m AS (
    SELECT r.*, gs::date AS missed_month
      FROM r,
           generate_series(r.track_from,
                           least(r.last_month, (r.void_month - interval '1 month')::date,
                                 (v_upto - interval '1 month')::date),
                           interval '1 month') gs
  )
  SELECT m.contract_id, m.customer_id, m.branch_id, m.missed_month,
         m.reason, m.by_id, m.by_start, m.by_created, nt.note
    FROM m
    LEFT JOIN missed_service_notes nt
           ON nt.contract_id = m.contract_id AND nt.missed_month = m.missed_month
   WHERE NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = m.contract_id AND vi.visit_type = 'routine'
                        AND vi.makeup_for_month IS NULL
                        AND vi.visit_date >= m.missed_month
                        AND vi.visit_date < (m.missed_month + interval '1 month')::date)
     AND NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = m.contract_id AND vi.makeup_for_month = m.missed_month)
     AND NOT EXISTS (SELECT 1 FROM missed_service_resolutions rs
                      WHERE rs.contract_id = m.contract_id AND rs.missed_month = m.missed_month
                        AND rs.kind = 'waived')
   ORDER BY m.branch_id, m.customer_id, m.contract_id, m.missed_month;
END;
$$;

COMMENT ON FUNCTION public.list_voided_missed_services(uuid, date) IS
  'M35: missed service months voided because the contract was superseded (Renew / later New · DECISIONS 2.47/2.51) — same missed-month rule as list_pending_missed_services, counted up to (not including) the start month of the superseding contract.';

-- =====================================================================
-- 4. สิทธิ์
-- =====================================================================
REVOKE ALL ON FUNCTION public.contract_renewed_by(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_renewed_by(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_voided_missed_services(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_voided_missed_services(uuid, date) TO authenticated, service_role;
