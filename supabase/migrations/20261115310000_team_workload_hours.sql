-- DECISIONS 2.88 (เจ้าของอนุมัติ 19 พ.ย. 2026): เกณฑ์ Workload ค่ากลาง + ทีมตั้งทับได้
--
-- Logic summary:
--   1. `teams.workload_hours` (numeric(5,2) · NULL = ใช้ค่ากลาง) = เกณฑ์ชม./คน/เดือนของทีมนั้น
--      CHECK: ว่าง หรือ 0 < ค่า ≤ 300 (ช่วงเดียวกับ save_workload_threshold / WL001 — กันค่าเกินช่วงผ่านทาง REST ตรงด้วย)
--   2. `team_workload_hours(p_team_id)` = **จุดอ่านเดียว** = COALESCE(ค่าของทีม, ค่ากลาง app_settings)
--      · หน้า /material และทุกที่ที่คิด Workload รายทีมต้องเรียกตัวนี้ ห้ามอ่าน `teams.workload_hours` /
--        `workload_hours_per_person()` เอง
--      · SECURITY INVOKER (ทุก role ที่อ่านตาราง teams ได้ = authenticated ทุก role · policy teams_select) ·
--        ค่ากลางอ่านผ่าน `workload_hours_per_person()` (SECURITY DEFINER เดิม) · anon เรียกไม่ได้
--      · ไม่พบทีม → AG004 (แบบเดียวกับ set_team_active)
--      · ยังไม่มีฟังก์ชัน SQL ใดอ่าน `workload_hours_per_person` เพื่อคิดรายทีม (ตรวจแล้ว: มีแต่ตัว helper เอง +
--        save_workload_threshold) → ไม่มีเนื้อฟังก์ชันเดิมที่ต้องแก้
--   3. `save_team_workload_hours(p_team_id, p_hours, p_confirm)` — host เท่านั้น · SECURITY INVOKER
--      (RLS teams_host_write + audit_teams ทำงานตามปกติ — ไม่แตะ audit_trigger)
--      · p_hours = NULL → ล้างค่าของทีม กลับไปใช้ค่ากลาง
--      · p_confirm ต้อง true (หน้าจอส่งเมื่อผู้ใช้พิมพ์ "ยืนยันแก้ไข" แล้ว — แบบเดียวกับ save_workload_threshold
--        แต่ DB บังคับด้วย) ไม่งั้น TM007
--      · ค่าเท่าเดิม = ไม่เขียน (ไม่มีแถว audit เปล่า)
--      · คืน (team_id, workload_hours, effective_hours)
--   4. REST ตรง: คอลัมน์นี้ **ไม่ล็อกให้ผ่าน RPC อย่างเดียว** — ตามแบบ headcount / is_active ของทีม (host แก้ตรงที่ตารางได้
--      ผ่าน RLS teams_host_write · role อื่นแก้ไม่ได้) · ทุกทางลง audit_teams · ช่วงค่าบังคับโดย CHECK
--      ⚠ ผลคือคำยืนยัน p_confirm บังคับเฉพาะทาง RPC — ถ้าต้องการให้ REST ตรงก็ผ่านคำยืนยันด้วย ต้องเพิ่มด่าน GUC แบบ M26
--   * error ใหม่: TM007 (ต้องยืนยันก่อนแก้เกณฑ์ Workload ของทีม) · ใช้ WL001 เดิมกับค่านอกช่วง · AG004 ไม่พบทีม

-- =====================================================================
-- 1. teams.workload_hours
-- =====================================================================
ALTER TABLE public.teams
  ADD COLUMN workload_hours numeric(5,2) NULL
    CONSTRAINT teams_workload_hours_range CHECK (workload_hours IS NULL OR (workload_hours > 0 AND workload_hours <= 300));

COMMENT ON COLUMN public.teams.workload_hours IS
  'DECISIONS 2.88: เกณฑ์ Workload ชม./คน/เดือนของทีม (ว่าง = ใช้ค่ากลาง app_settings.workload_hours_per_person) — อ่านผ่าน team_workload_hours() เท่านั้น · host แก้ผ่าน save_team_workload_hours (ลง audit_log)';

-- =====================================================================
-- 2. จุดอ่านเดียว
-- =====================================================================
CREATE FUNCTION public.team_workload_hours(p_team_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_found boolean;
  v_team  numeric;
BEGIN
  SELECT true, t.workload_hours INTO v_found, v_team FROM teams t WHERE t.id = p_team_id;
  IF v_found IS NOT TRUE THEN
    RAISE EXCEPTION 'team not found' USING ERRCODE = 'AG004';
  END IF;
  RETURN COALESCE(v_team, public.workload_hours_per_person());
END;
$$;

-- =====================================================================
-- 3. บันทึกเกณฑ์ของทีม (host)
-- =====================================================================
CREATE FUNCTION public.save_team_workload_hours(p_team_id uuid, p_hours numeric, p_confirm boolean)
RETURNS TABLE (team_id uuid, workload_hours numeric, effective_hours numeric)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF NOT is_host() THEN
    RAISE EXCEPTION 'บันทึกเกณฑ์ Workload ของทีมได้เฉพาะผู้ดูแลระบบ (host)' USING ERRCODE = '42501';
  END IF;
  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'ต้องยืนยันก่อนแก้เกณฑ์ Workload ของทีม (พิมพ์ "ยืนยันแก้ไข")' USING ERRCODE = 'TM007';
  END IF;
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'team id is required' USING ERRCODE = '22004';
  END IF;
  IF p_hours IS NOT NULL THEN
    IF p_hours <= 0 OR p_hours > 300 THEN
      RAISE EXCEPTION 'เกณฑ์ Workload ต้องมากกว่า 0 และไม่เกิน 300 ชม./คน/เดือน' USING ERRCODE = 'WL001';
    END IF;
    IF p_hours <> round(p_hours, 2) THEN
      RAISE EXCEPTION 'เกณฑ์ Workload มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง' USING ERRCODE = 'WL001';
    END IF;
  END IF;

  -- ล็อกแถวทีม (ไม่พบ = AG004) แล้วเขียนเฉพาะเมื่อค่าเปลี่ยน
  PERFORM 1 FROM teams t WHERE t.id = p_team_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'team not found' USING ERRCODE = 'AG004';
  END IF;
  UPDATE teams t SET workload_hours = p_hours
   WHERE t.id = p_team_id AND t.workload_hours IS DISTINCT FROM p_hours;

  RETURN QUERY
    SELECT t.id, t.workload_hours, COALESCE(t.workload_hours, public.workload_hours_per_person())
      FROM teams t WHERE t.id = p_team_id;
END;
$$;

-- =====================================================================
-- 4. สิทธิ์: anon ไม่ได้อะไรเลย · authenticated เรียกได้ (host ถูกตรวจใน RPC + RLS)
-- =====================================================================
REVOKE ALL ON FUNCTION public.team_workload_hours(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_workload_hours(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.save_team_workload_hours(uuid, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_team_workload_hours(uuid, numeric, boolean) TO authenticated;
