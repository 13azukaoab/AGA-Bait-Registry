-- M39b (phase 5): "ส่วนกลางพร้อมปิด" นับหมายเหตุตกบริการว่าบันทึกแล้ว (เจ้าของเลือก ก · 18 พ.ย. 2026)
--
-- Logic summary:
--   * แทน `central_unready_branches(p_month)` — เนื้อจาก 20261115270000_month_close.sql (M39) ทุกบรรทัด
--     + เงื่อนไขเดียวที่ติดป้าย "M39b": สัญญาที่มีแถว `missed_service_notes` ของเดือนนั้น = บันทึกแล้ว
--     → หัวหน้างานกรอกเหตุผลตกบริการครบทุกสัญญา = สาขาพร้อม ปิดส่วนกลางเองได้ ไม่ต้องให้ host ปิดข้าม
--   * ต่างจาก `list_pending_missed_services` ข้อเดียวนี้: หมายเหตุนับเฉพาะ "ความพร้อมปิดเดือน" —
--     สัญญานั้นยังเป็น "ตกบริการรอตัดสิน" ในรายการเดิมตามปกติ (ไม่แก้ฟังก์ชันนั้น)
--   * signature เดิม (CREATE OR REPLACE) → สิทธิ์เดิมคงอยู่ (REVOKE จาก PUBLIC/anon/authenticated/service_role
--     ใน 270000 · เรียกได้จาก close_month_part ที่เป็น SECURITY DEFINER เท่านั้น)
--   * ไม่แตะ audit_trigger · ไม่เปลี่ยน RLS · ไม่มี error ใหม่

CREATE OR REPLACE FUNCTION public.central_unready_branches(p_month text)
RETURNS TABLE (branch_id uuid, branch_name text, pending_count int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH m AS (SELECT to_date(p_month || '-01', 'YYYY-MM-DD') AS d)
  SELECT b.id, b.name, count(*)::int
    FROM contracts ct
    JOIN customers cu ON cu.id = ct.customer_id
    JOIN branches b ON b.id = cu.branch_id AND b.division = 'central'
    CROSS JOIN m
   WHERE ct.status <> 'cancelled' AND ct.cancelled_at IS NULL
     AND NOT contract_is_renewed(ct.id)
     AND ct.stations_initialized_at IS NOT NULL
     AND missed_tracking_start_month(ct.start_date, ct.stations_initialized_at) <= m.d
     AND (date_trunc('month', ct.start_date) + make_interval(months => ct.term_months - 1))::date >= m.d
     AND NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = ct.id AND vi.visit_type = 'routine'
                        AND vi.makeup_for_month IS NULL
                        AND vi.visit_date >= m.d
                        AND vi.visit_date < (m.d + interval '1 month')::date)
     AND NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = ct.id AND vi.makeup_for_month = m.d)
     AND NOT EXISTS (SELECT 1 FROM missed_service_resolutions r
                      WHERE r.contract_id = ct.id AND r.missed_month = m.d AND r.kind = 'waived')
     -- M39b: มีหมายเหตุตกบริการของเดือนนั้น = บันทึกแล้ว (เฉพาะความพร้อมปิดเดือน · ต่างจาก list_pending_missed_services)
     AND NOT EXISTS (SELECT 1 FROM missed_service_notes n
                      WHERE n.contract_id = ct.id AND n.missed_month = m.d)
   GROUP BY b.id, b.name
   ORDER BY b.name;
$$;

COMMENT ON FUNCTION public.central_unready_branches(text) IS
  'M39/M39b: สาขาส่วนกลางที่ยังมีสัญญาค้างบริการของเดือน (เกณฑ์ list_pending_missed_services + หมายเหตุตกบริการนับว่าบันทึกแล้ว)';
