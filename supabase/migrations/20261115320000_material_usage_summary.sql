-- DECISIONS 2.90 (เจ้าของเลือก ก · 19 พ.ย. 2026): สรุปวัสดุที่ใช้รายเดือน แยกประเภทงาน (หน้า /material)
--
-- Logic summary:
--   `material_usage_summary(p_month, p_branch_id)` — รวมวัสดุจาก `v_service_materials` (นิยามล่าสุด 20261112160000 · ไม่แก้ view)
--   · แถวต่อ สาขา × work_group × sale_type · มีเฉพาะกลุ่มที่มีการเข้าบริการในเดือนนั้น
--   · work_group: 'makeup'  = visit_type 'routine' ที่มี makeup_for_month (เข้าชดเชย)
--                 'routine' = visit_type 'routine' ปกติ
--                 'problem' = visit_type 'problem' หรือ 'follow_up'
--   · sale_type: 'new' | 'renew' จากสัญญา (สัญญาที่ไม่ระบุ sale_type → 'unknown' ไม่ทิ้งแถว)
--   · เดือน: p_month ต้องเป็นวันที่ 1 (ไม่ใช่ / NULL → MU001) · นับตาม visit_date
--   · สิทธิ์: host (ทุกสาขา) / admin / recorder (เฉพาะสาขาในขอบเขตส่วนงาน — branch_in_scope) · viewer / anon / ไม่มีโปรไฟล์ → 42501
--     p_branch_id นอกขอบเขต = ไม่คืนแถว (เหมือน ag_box_counts_by_branch)
--   · SECURITY INVOKER (RLS ของ visits/contracts/customers ยังทำงาน) · ไม่มีชื่อลูกค้า / เลขสัญญา (PDPA)
--   * error ใหม่: MU001 (p_month ไม่ใช่วันที่ 1 ของเดือน)
CREATE FUNCTION public.material_usage_summary(p_month date, p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  branch_id      uuid,
  branch_name    text,
  work_group     text,
  sale_type      text,
  visit_count    int,
  bait_outside_g bigint,
  bait_inside_g  bigint,
  powder_points  bigint,
  powder_g       numeric,
  timber_pcs     bigint,
  install_bait_g bigint
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
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'not allowed to read material usage' USING ERRCODE = '42501';
  END IF;
  IF p_month IS NULL OR p_month <> date_trunc('month', p_month)::date THEN
    RAISE EXCEPTION 'p_month ต้องเป็นวันที่ 1 ของเดือน' USING ERRCODE = 'MU001';
  END IF;

  RETURN QUERY
  SELECT b.id,
         b.name,
         CASE WHEN v.visit_type = 'routine' AND v.makeup_for_month IS NULL THEN 'routine'
              WHEN v.visit_type = 'routine' THEN 'makeup'
              ELSE 'problem' END,
         coalesce(c.sale_type::text, 'unknown'),
         count(*)::int,
         sum(m.bait_outside_g)::bigint,
         sum(m.bait_inside_g)::bigint,
         sum(m.powder_points)::bigint,
         sum(m.powder_g),
         sum(m.timber_pcs)::bigint,
         sum(m.install_bait_g)::bigint
    FROM v_service_materials m
    JOIN visits v     ON v.id = m.visit_id
    JOIN contracts c  ON c.id = v.contract_id
    JOIN customers cu ON cu.id = c.customer_id
    JOIN branches b   ON b.id = cu.branch_id
   WHERE m.visit_date >= p_month AND m.visit_date < (p_month + interval '1 month')::date
     AND (p_branch_id IS NULL OR b.id = p_branch_id)
     AND (v_role = 'host' OR branch_in_scope(b.id))
   GROUP BY b.id, b.name,
            CASE WHEN v.visit_type = 'routine' AND v.makeup_for_month IS NULL THEN 'routine'
                 WHEN v.visit_type = 'routine' THEN 'makeup'
                 ELSE 'problem' END,
            coalesce(c.sale_type::text, 'unknown')
   ORDER BY b.name, 3, 4;
END;
$$;

REVOKE ALL ON FUNCTION public.material_usage_summary(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.material_usage_summary(date, uuid) TO authenticated;
