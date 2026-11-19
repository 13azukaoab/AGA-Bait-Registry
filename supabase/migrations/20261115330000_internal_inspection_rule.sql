-- M43 (DECISIONS 2.93): ช่อง "ตรวจภายใน" ติ๊กได้เฉพาะงานบริการประจำเดือน (routine) + สรุปรายเดือน
--
-- Logic summary:
--   1. กฎ: `visits.internal_inspection` เป็น true ได้เฉพาะ `visit_type = 'routine'`
--      · ใช้ CHECK `visits_internal_inspection_routine_only` (SQLSTATE 23514 — ไม่มี error code ใหม่)
--        ครอบทุกทาง (save_service_visit / REST ตรง / นำเข้า) · CHECK ทำงานหลัง BEFORE trigger ทุกตัว
--        (ลำดับ trigger เดิมไม่เปลี่ยน · ไม่ต้องแทนที่ save_service_visit)
--      · ก่อนเพิ่มกฎ นับแถวเดิมที่ผิดกฎ (internal_inspection = true แต่ไม่ใช่ routine):
--          - ไม่มี  → CHECK ปกติ (validated)
--          - มี     → CHECK แบบ NOT VALID (บังคับกับแถวใหม่/แถวที่ถูกแก้ · ไม่แก้ข้อมูลเงียบๆ)
--            + RAISE NOTICE จำนวนแถว · ⚠ แถวเก่าที่ผิดกฎ จะ UPDATE ไม่ได้จนกว่าจะแก้ค่านั้น
--              (ให้เจ้าของ/ผู้ดูแลฐานข้อมูลตัดสิน แล้วค่อย VALIDATE CONSTRAINT)
--   2. `inside_inspection_summary(p_month, p_branch_id DEFAULT NULL)` — สรุปตรวจภายในรายเดือน (หน้า /material)
--      · แถวต่อ สาขา × ทีม · เฉพาะ routine ที่ internal_inspection = true และ visit_date อยู่ในเดือนนั้น
--      · inspection_count = จำนวนการเข้า (visit) · contract_count = จำนวนสัญญาไม่ซ้ำ (≈ "กี่ราย")
--      · ทีมจาก `visit_teams` (การเข้าที่มีหลายทีม นับให้ทุกทีม ⚠ ห้ามบวกทุกแถวเป็นยอดรวมสาขา —
--        จะนับเกิน) · ไม่มีทีม → team_id/team_name = NULL
--      · สาขา = สาขาของลูกค้า (ตรง material_usage_summary 2.90)
--      · สิทธิ์ตรง material_usage_summary: host ทุกสาขา · admin / recorder เฉพาะสาขาในขอบเขต
--        (branch_in_scope) · viewer / anon / ไม่มีโปรไฟล์ → 42501 · p_branch_id นอกขอบเขต = ไม่คืนแถว
--      · SECURITY INVOKER (RLS ยังทำงาน) · ไม่มีชื่อลูกค้า / เลขสัญญา (PDPA)
--   * error ใหม่: II001 (p_month ไม่ใช่วันที่ 1 ของเดือน / NULL)

-- =====================================================================
-- 1. กฎ routine เท่านั้น
-- =====================================================================
DO $$
DECLARE
  v_bad bigint;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.visits
   WHERE internal_inspection IS TRUE AND visit_type <> 'routine';

  IF v_bad = 0 THEN
    ALTER TABLE public.visits
      ADD CONSTRAINT visits_internal_inspection_routine_only
      CHECK (internal_inspection IS NOT TRUE OR visit_type = 'routine');
  ELSE
    ALTER TABLE public.visits
      ADD CONSTRAINT visits_internal_inspection_routine_only
      CHECK (internal_inspection IS NOT TRUE OR visit_type = 'routine') NOT VALID;
    RAISE NOTICE 'M43: % existing non-routine visit(s) have internal_inspection = true; constraint added NOT VALID (data left unchanged)', v_bad;
  END IF;
END;
$$;

COMMENT ON CONSTRAINT visits_internal_inspection_routine_only ON public.visits IS
  'M43 / DECISIONS 2.93: internal_inspection may be true only for routine visits.';

-- =====================================================================
-- 2. สรุปตรวจภายในรายเดือน
-- =====================================================================
CREATE FUNCTION public.inside_inspection_summary(p_month date, p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  branch_id        uuid,
  branch_name      text,
  team_id          uuid,
  team_name        text,
  inspection_count int,
  contract_count   int
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
    RAISE EXCEPTION 'not allowed to read inside inspection summary' USING ERRCODE = '42501';
  END IF;
  IF p_month IS NULL OR p_month <> date_trunc('month', p_month)::date THEN
    RAISE EXCEPTION 'p_month ต้องเป็นวันที่ 1 ของเดือน' USING ERRCODE = 'II001';
  END IF;

  RETURN QUERY
  SELECT b.id,
         b.name,
         t.id,
         t.name,
         count(DISTINCT v.id)::int,
         count(DISTINCT v.contract_id)::int
    FROM visits v
    JOIN contracts c  ON c.id = v.contract_id
    JOIN customers cu ON cu.id = c.customer_id
    JOIN branches b   ON b.id = cu.branch_id
    LEFT JOIN visit_teams vt ON vt.visit_id = v.id
    LEFT JOIN teams t        ON t.id = vt.team_id
   WHERE v.visit_type = 'routine'
     AND v.internal_inspection IS TRUE
     AND v.visit_date >= p_month AND v.visit_date < (p_month + interval '1 month')::date
     AND (p_branch_id IS NULL OR b.id = p_branch_id)
     AND (v_role = 'host' OR branch_in_scope(b.id))
   GROUP BY b.id, b.name, t.id, t.name
   ORDER BY b.name, t.name NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.inside_inspection_summary(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inside_inspection_summary(date, uuid) TO authenticated;
