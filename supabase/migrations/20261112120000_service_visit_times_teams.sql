-- ก้อน ① schema หน้ากรอกข้อมูลทำบริการ (SPEC v1.8 §8.1 · เจ้าของอนุมัติแบบ 12 พ.ย. 2026)
-- แบบเต็ม: docs/plans/2026-11-12-service-entry-schema.md
--
-- Logic summary:
--   * เวลาเข้า–ออก: `visits.start_time`, `end_time` (time · 24 ชม. · บังคับทั้งคู่ · ออกต้องหลังเข้า —
--     ยังไม่รองรับข้ามเที่ยงคืนตาม SPEC)
--       - บังคับด้วย NOT NULL ตรงๆ: SPEC §10 ข้อ 4 ไม่นำเข้าผลบริการย้อนหลัง จึงไม่มีแถวเก่าที่ไม่มีเวลา ·
--         ถ้าฐานข้อมูลไหนมีแถว visits อยู่แล้ว migration นี้จะ "หยุด" (ไม่เติมเวลาปลอมให้เงียบๆ)
--   * `duration_min` (เดิมให้ผู้ใช้กรอก) → คอลัมน์ generated = นาทีระหว่าง end − start (คำนวณเอง แก้ไม่ได้)
--   * หลายทีมต่อการเข้า 1 ครั้ง (ทีม A–O, Z — DECISIONS 2.4): ตารางใหม่ `visit_teams` แทน `visits.team_id`
--       - ย้ายค่าเดิม (ถ้ามี) เข้า `visit_teams` แล้ว **ลบคอลัมน์ `visits.team_id`** (ค่าเริ่มต้นที่เจ้าของรับ)
--       - "ต้องเลือกอย่างน้อย 1 ทีม" และ "รับเฉพาะ A–O, Z" ตรวจใน RPC บันทึกผลบริการ (ก้อน ③) —
--         constraint ข้ามตารางทำไม่ได้
--   * สิทธิ์ `visit_teams` (เหมือน visits): host ทั้งหมด · recorder เพิ่ม/ลบในขอบเขตหน่วยงาน ·
--     admin อ่านอย่างเดียว · anon ไม่มีสิทธิ์ (PDPA) · ไม่มี UPDATE (แก้ = ลบทีมเดิม + เพิ่มทีมใหม่)
--   * audit: `visit_teams` ลง audit_log เฉพาะการลบ (เหมือน visits / station_checks ตาม M3 —
--     "ใครเพิ่มเมื่อไหร่" อ่านจากการเข้าบริการ) · `audit_trigger()` รู้จักตารางนี้แล้ว (บริบทสัญญา/เดือน
--     หาจาก visit — ถ้า visit ถูกลบไปพร้อมกัน (CASCADE) บริบทจะว่าง เหมือน station_checks เดิม)
--   * view `v_visit_team_minutes`: 1 แถวต่อ (การเข้า × ทีม) พร้อมนาทีทำงาน · **เข้าหลายทีม = นับเต็มทุกทีม**
--     (DECISIONS 2.14 — ผลรวมทุกทีมจึงมากกว่าเวลาจริงได้) · security_invoker = RLS ของผู้อ่านทำงาน ·
--     anon อ่านไม่ได้

-- =====================================================================
-- 1. เวลาเข้า–ออก + นาทีทำงาน
-- =====================================================================
ALTER TABLE public.visits
  ADD COLUMN start_time time NOT NULL,
  ADD COLUMN end_time   time NOT NULL;

ALTER TABLE public.visits
  ADD CONSTRAINT visits_end_after_start CHECK (end_time > start_time);

ALTER TABLE public.visits DROP COLUMN duration_min;
ALTER TABLE public.visits
  ADD COLUMN duration_min int
    GENERATED ALWAYS AS ((EXTRACT(EPOCH FROM (end_time - start_time)) / 60)::int) STORED;

-- =====================================================================
-- 2. หลายทีมต่อการเข้า
-- =====================================================================
CREATE TABLE public.visit_teams (
  visit_id uuid NOT NULL REFERENCES public.visits (id) ON DELETE CASCADE,
  team_id  uuid NOT NULL REFERENCES public.teams (id),
  PRIMARY KEY (visit_id, team_id)
);
CREATE INDEX visit_teams_team_id_idx ON public.visit_teams (team_id);

-- ย้ายทีมเดิม (ถ้ามี) แล้วลบคอลัมน์เก่า
INSERT INTO public.visit_teams (visit_id, team_id)
SELECT v.id, v.team_id FROM public.visits v WHERE v.team_id IS NOT NULL;

ALTER TABLE public.visits DROP COLUMN team_id;

ALTER TABLE public.visit_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY visit_teams_select ON public.visit_teams FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));
CREATE POLICY visit_teams_host_write ON public.visit_teams FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());
CREATE POLICY visit_teams_recorder_insert ON public.visit_teams FOR INSERT TO authenticated
  WITH CHECK (public.current_app_role() = 'recorder' AND public.visit_in_scope(visit_id));
CREATE POLICY visit_teams_recorder_delete ON public.visit_teams FOR DELETE TO authenticated
  USING (public.current_app_role() = 'recorder' AND public.visit_in_scope(visit_id));

-- =====================================================================
-- 3. audit — audit_trigger() รู้จัก visit_teams (เนื้อเดิมจาก 20261111090300 + กรณีใหม่ 1 กรณี)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old        jsonb;
  v_new        jsonb;
  v_rec        jsonb;
  v_row_id     uuid;
  v_branch     uuid;
  v_contract   uuid;
  v_month      text;
  v_visit_date date;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;
  v_rec := COALESCE(v_new, v_old);

  -- tables without an "id" column (contract_teams, visit_teams, snapshots, closures) yield NULL
  v_row_id := NULLIF(v_rec ->> 'id', '')::uuid;

  CASE TG_TABLE_NAME
    WHEN 'customers' THEN
      v_branch := (v_rec ->> 'branch_id')::uuid;
    WHEN 'contracts' THEN
      v_contract := v_row_id;
      SELECT cu.branch_id INTO v_branch
        FROM public.customers cu WHERE cu.id = (v_rec ->> 'customer_id')::uuid;
    WHEN 'contract_teams', 'stations', 'contract_files' THEN
      v_contract := (v_rec ->> 'contract_id')::uuid;
    WHEN 'visits' THEN
      v_contract := (v_rec ->> 'contract_id')::uuid;
      v_month    := to_char((v_rec ->> 'visit_date')::date, 'YYYY-MM');
    WHEN 'station_checks', 'visit_teams' THEN
      SELECT v.contract_id, v.visit_date INTO v_contract, v_visit_date
        FROM public.visits v WHERE v.id = (v_rec ->> 'visit_id')::uuid;
      v_month := to_char(v_visit_date, 'YYYY-MM');
    WHEN 'monthly_branch_snapshots' THEN
      v_branch := (v_rec ->> 'branch_id')::uuid;
      v_month  := public.normalize_month_key(v_rec ->> 'month_key');
    WHEN 'month_closures' THEN
      v_month := public.normalize_month_key(v_rec ->> 'month_key');
    ELSE
      NULL;
  END CASE;

  IF v_branch IS NULL AND v_contract IS NOT NULL THEN
    SELECT cu.branch_id INTO v_branch
      FROM public.contracts c
      JOIN public.customers cu ON cu.id = c.customer_id
     WHERE c.id = v_contract;
  END IF;

  INSERT INTO public.audit_log
    (table_name, row_id, action, old_data, new_data, changed_by, branch_id, contract_id, month_key)
  VALUES
    (TG_TABLE_NAME, v_row_id, lower(TG_OP)::public.audit_action, v_old, v_new, auth.uid(),
     v_branch, v_contract, v_month);

  RETURN NULL; -- AFTER trigger: return value ignored
END;
$$;

CREATE TRIGGER audit_visit_teams
  AFTER UPDATE OR DELETE ON public.visit_teams
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- =====================================================================
-- 4. view เวลาทำงานรายทีม
-- =====================================================================
CREATE VIEW public.v_visit_team_minutes WITH (security_invoker = true) AS
SELECT v.id           AS visit_id,
       v.contract_id,
       v.visit_date,
       v.visit_type,
       vt.team_id,
       v.duration_min AS minutes
  FROM public.visits v
  JOIN public.visit_teams vt ON vt.visit_id = v.id;

-- =====================================================================
-- 5. สิทธิ์ (ตาราง/view ใหม่ต้องกำหนดในไฟล์นี้ — CLAUDE.md)
-- =====================================================================
REVOKE ALL ON public.visit_teams FROM PUBLIC;
REVOKE ALL ON public.visit_teams FROM anon;
GRANT SELECT, INSERT, DELETE ON public.visit_teams TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visit_teams TO service_role;

REVOKE ALL ON public.v_visit_team_minutes FROM PUBLIC;
REVOKE ALL ON public.v_visit_team_minutes FROM anon;
GRANT SELECT ON public.v_visit_team_minutes TO authenticated, service_role;
