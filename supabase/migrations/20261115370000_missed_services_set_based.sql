-- =====================================================================
-- PERF (หลัง go-live) — list_pending_missed_services แบบ set-based
--
-- ปัญหา (FE วัดบนเครื่อง ~2,390 สัญญาสมมติ · PM ทุกสาขา): 1.8 วินาที · ~85% อยู่ที่การเรียกฟังก์ชันทีละแถว
--   * contract_is_renewed(ct.id)            — 1 ครั้งต่อสัญญา (SQL function มี SET search_path → planner inline ไม่ได้)
--   * contract_month_paused(contract, month) — 1 ครั้งต่อ "สัญญา × เดือน" (SECURITY DEFINER + current_app_role() ข้างใน)
--   * contract_in_scope(ct.id)              — 1 ครั้งต่อสัญญา (เฉพาะ recorder · SECURITY DEFINER)
--
-- ไฟล์นี้แทนที่เนื้อ list_pending_missed_services (เนื้อล่าสุด 20261115300001_contract_pause.sql ข้อ 6a) เท่านั้น
--   signature / คอลัมน์ที่คืน / ORDER BY / plpgsql STABLE SECURITY INVOKER / search_path / สิทธิ์ EXECUTE เหมือนเดิม
--   ไม่แตะ contract_is_renewed / contract_renewed_by / contract_month_paused / contract_in_scope (ผู้เรียกอื่นยังใช้)
--   ไม่แตะ RLS / audit_trigger / ฟังก์ชันอื่น
--
-- สรุป logic (ผลต้องเท่าเนื้อเดิมทุกแถว · เทส supabase/tests/63_missed_services_set_based.test.sql เทียบกับสำเนาเนื้อเดิม):
--   0. ด่าน role เดิมทุกตัวอักษร: current_app_role() NULL / ไม่ใช่ host·admin·recorder → 42501
--      (viewer · ไม่มีโปรไฟล์ · บัญชีถูกปิด · service_role · postgres ไม่มี JWT = 42501 เหมือนเดิม)
--   1. ขอบเขต recorder: เดิม contract_in_scope(ct.id) = branch_in_scope(สาขาของลูกค้าของสัญญา)
--      → คำนวณรายการสาขาในขอบเขต 1 ครั้งต่อการเรียก (branch_in_scope ตัวเดิม ทีละสาขา ~43 ครั้ง)
--      แล้วกรอง cu.branch_id = ANY(...) · ไม่มีสาขาในขอบเขต → array NULL → ไม่ผ่าน (เท่า coalesce(..., false) เดิม)
--      admin / host ไม่กรองขอบเขต (เหมือนเดิม)
--   2. "ถูกแทนแล้ว" (กฎ contract_renewed_by · DECISIONS 2.47/2.51) → NOT EXISTS 2 ก้อน (NOT (A OR B) = NOT A AND NOT B):
--      A) มีสัญญาอื่นที่ไม่ยกเลิก ผูก renewed_from_contract_id มาที่สัญญานี้
--      B) มีสัญญาอื่นที่ไม่ยกเลิก ไม่ผูกใคร ลูกค้าเดียวกัน เริ่มหลังวันจบจริงของสัญญานี้
--         (วันจบจริง = contract_effective_end_date ตัวเดิม คำนวณครั้งเดียวต่อสัญญา)
--      ไม่กรองสาขา/ขอบเขตของสัญญาที่มาแทน (เหมือนเดิม — เดิมอ่านผ่าน RLS ของผู้เรียก ซึ่ง 3 role เห็นทุกแถว)
--   3. เดือนที่พัก (M29 · 2.52) → NOT EXISTS บน contract_pauses ด้วยสูตรเดียวกับ contract_month_paused:
--      paused_month <= เดือน AND (resume_month IS NULL OR เดือน < resume_month)
--      * ส่วน allowlist ของ SEC-05 ใน contract_month_paused เป็นจริงเสมอในฟังก์ชันนี้ (ผ่านด่านข้อ 0 มาแล้ว
--        = host/admin/recorder · current_app_role() ใน DEFINER เห็นผู้เรียกคนเดียวกัน) จึงไม่ต้องเขียนซ้ำ
--      * อ่าน contract_pauses แบบ INVOKER ผ่าน RLS contract_pauses_select (host/admin/recorder เห็นทุกแถว)
--        → ผลเท่า DEFINER เดิม · authenticated มี SELECT อยู่แล้ว
--      * missed_month มาจาก generate_series ที่เริ่มวันที่ 1 ของเดือนเสมอ → date_trunc ของเดิมไม่เปลี่ยนค่า
--   4. ระยะชดเชย missed_makeup_deadline_months() (IMMUTABLE) อ่านครั้งเดียวเก็บในตัวแปร
--   * ที่ยังเป็นทีละแถว (ไม่อยู่ในขอบเขตงานนี้): RLS policy ของ contracts/customers/visits เรียก current_app_role()
--     ต่อแถว · list_voided_missed_services / central_unready_branches ยังเรียก helper ทีละแถว
--   * ⚠ กฎข้อ 2 (ถูกแทน) และข้อ 3 (เดือนพัก) เขียนซ้ำในตัวเพื่อความเร็ว — แก้ contract_renewed_by /
--     contract_month_paused เมื่อไหร่ ต้องแก้ที่นี่ด้วย · เทส 63 เทียบกับเนื้อเดิมที่เรียก helper ตัวจริง → ถ้าสองฝั่งไม่ตรงกัน เทสพัง
--   * error ใหม่: ไม่มี
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
  v_role           text := current_app_role();
  v_now_month      date := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
  v_upto           date;
  v_deadline       int;
  v_scope_branches uuid[];
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'not allowed to read missed services' USING ERRCODE = '42501';
  END IF;
  v_upto     := least(coalesce(date_trunc('month', p_month)::date, v_now_month), v_now_month);
  v_deadline := missed_makeup_deadline_months();

  -- ขอบเขต recorder: สาขาที่ branch_in_scope() = true (นิยามขอบเขตสัญญาเดิม · คำนวณครั้งเดียว · ดูหัวไฟล์ข้อ 1)
  IF v_role = 'recorder' THEN
    SELECT array_agg(b.id) INTO v_scope_branches
      FROM branches b
     WHERE branch_in_scope(b.id);
  END IF;

  RETURN QUERY
  WITH c AS (
    SELECT ct.id AS contract_id, cu.id AS customer_id, cu.branch_id,
           missed_tracking_start_month(ct.start_date, ct.stations_initialized_at) AS track_from,
           (date_trunc('month', ct.start_date) + make_interval(months => ct.term_months - 1))::date AS last_month,
           contract_effective_end_date(ct.start_date, ct.end_date, ct.term_months) AS eff_end
      FROM contracts ct
      JOIN customers cu ON cu.id = ct.customer_id
     WHERE ct.status <> 'cancelled' AND ct.cancelled_at IS NULL
       AND ct.stations_initialized_at IS NOT NULL
       AND (p_branch_id IS NULL OR cu.branch_id = p_branch_id)
       AND (v_role <> 'recorder' OR cu.branch_id = ANY (v_scope_branches))
  ), live AS (
    -- 2.47 + 2.51 ถูกแทนแล้ว (กฎ contract_renewed_by) — A) Renew ที่ผูกมา
    SELECT c.*
      FROM c
     WHERE NOT EXISTS (SELECT 1 FROM contracts n
                        WHERE n.renewed_from_contract_id = c.contract_id
                          AND n.id <> c.contract_id
                          AND n.status <> 'cancelled' AND n.cancelled_at IS NULL)
       -- B) New ไม่ผูกใคร ลูกค้าเดียวกัน เริ่มหลังสัญญานี้จบ
       AND NOT EXISTS (SELECT 1 FROM contracts n
                        WHERE n.customer_id = c.customer_id
                          AND n.renewed_from_contract_id IS NULL
                          AND n.id <> c.contract_id
                          AND n.status <> 'cancelled' AND n.cancelled_at IS NULL
                          AND n.start_date > c.eff_end)
  ), m AS (
    SELECT live.*, gs::date AS missed_month
      FROM live,
           generate_series(live.track_from, least(live.last_month, (v_upto - interval '1 month')::date),
                           interval '1 month') gs
  )
  SELECT m.contract_id, m.customer_id, m.branch_id, m.missed_month, m.last_month,
         (m.last_month + make_interval(months => v_deadline))::date,
         v_now_month > (m.last_month + make_interval(months => v_deadline))::date
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
     -- M29 (2.52): เดือนที่พักไม่ใช่ตกบริการ (สูตรเดือนพักเดิม · ดูหัวไฟล์ข้อ 3)
     AND NOT EXISTS (SELECT 1 FROM contract_pauses p
                      WHERE p.contract_id = m.contract_id
                        AND p.paused_month <= m.missed_month
                        AND (p.resume_month IS NULL OR m.missed_month < p.resume_month))
   ORDER BY m.branch_id, m.customer_id, m.contract_id, m.missed_month;
END;
$$;

COMMENT ON FUNCTION public.list_pending_missed_services(uuid, date) IS
  'Pending missed service months (no routine visit, no make-up, not waived, not paused, contract not superseded). PERF 20261115370000: set-based (anti-joins) — same results and order as the per-row helper version.';

REVOKE ALL ON FUNCTION public.list_pending_missed_services(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_missed_services(uuid, date) TO authenticated;
