-- M25: ค่าตั้งระบบ (app_settings) · เกณฑ์ Workload · จำนวนคนต่อทีม · ด่านประเภททีม · audit ทีม/ประเภทลูกค้า
--      · จำนวนกล่อง AG ต่อสาขา · M20b (เกณฑ์ Tier ห้ามย้อนก่อนเดือนเริ่มใช้ระบบ)
-- (mockup #material FINAL `220adf8` + settings · เจ้าของอนุมัติ 15–16 พ.ย. 2026 — DECISIONS M25, 2.49 ①)
--
-- Logic summary:
--   1. `app_settings` = ตารางแถวเดียว (PK `singleton boolean` = true เสมอ · ห้ามชื่อ `id` เพราะ audit_trigger
--      แปลง id เป็น uuid) · ลบแถวไม่ได้ (trigger) · TRUNCATE ไม่ได้ (trigger) · แถวที่ 2 ชน PK
--      - `go_live_month` (2026-10-01 · วันที่ 1 ของเดือน) = เดือนแรกที่ใช้ระบบ — **แก้ได้เฉพาะผู้ดูแลฐานข้อมูล (postgres)**
--        ไม่มี RPC · authenticated / service_role ไม่มีสิทธิ์ UPDATE ตารางเลย (REVOKE) · trigger กันซ้ำอีกชั้น:
--        เปลี่ยน go_live_month ได้เฉพาะ session ที่ต่อเข้ามาเป็น postgres/supabase_admin (ทาง API session_user =
--        authenticator → ถูกปฏิเสธแม้ผ่านฟังก์ชัน SECURITY DEFINER) → AS001
--        ⚠ เปลี่ยนค่านี้ = ตัวเลขย้อนหลังเปลี่ยน (เกณฑ์ Tier ที่ตั้งได้ · เดือนค้างปิดในหน้า #todo)
--      - `workload_hours_per_person` (ค่าเริ่มต้น 30 ชม./คน/เดือน) — host แก้ผ่าน RPC `save_workload_threshold` เท่านั้น
--        (ช่วงที่รับ 0 < ค่า ≤ 300 ทศนิยมไม่เกิน 2 ตำแหน่ง ตาม mockup · ผิด = WL001) · ลง audit_log (trigger audit_app_settings)
--      - อ่าน: authenticated ทุก role (SELECT + RLS policy) · anon ไม่ได้อะไรเลย
--      - helper `go_live_month()` / `workload_hours_per_person()` = จุดอ่านเดียว (ห้าม hardcode ที่อื่น)
--        ไม่พบแถว → error (ไม่คืน NULL เงียบๆ เพราะ NULL ทำให้ด่าน M20b หลุด และ floor ของ #todo หาย)
--   2. M20b (DECISIONS 2.49 ①): `tier_rules.effective_month` ต้อง ≥ go_live_month() — ยกเว้นชุดตั้งต้น 2000-01-01
--      - ด่านอยู่ใน `tier_rules_closed_month_guard` (ทุกทางที่เขียน) + `save_tier_rule_set` (ข้อความชัดก่อนเขียน) → TR005
--      - เนื้อฟังก์ชันคัดลอกจาก M20 (20261115130000 — ยังเป็นนิยามล่าสุด) แก้เฉพาะบล็อกที่ติดป้าย "M25"
--   3. `oldest_open_month()`: floor = go_live_month() แทนการเดาจากแถว legacy ใน monthly_branch_snapshots
--      (เนื้อจาก M24 20261115140000 · signature เดิม) · ถ้าเดือนเริ่มใช้ระบบยังไม่ถึง → เดือนปัจจุบัน
--   4. `teams.headcount` = จำนวนคนภาคสนามของทีม (0–99 ตาม mockup · ค่าเริ่มต้น 0) · host แก้ตรงที่ตารางได้
--      (RLS teams_host_write เดิม) · ลง audit (ข้อ 6) · ⚠ FE: headcount = 0 → ชม./คน หารศูนย์ ต้องแสดง "—"
--   5. ด่านประเภททีม `teams_kind_guard`: เปลี่ยนทีมเป็น 'supervisor' ไม่ได้ถ้ายังมีงานผูก
--      (contract_teams / visit_teams) → TM003 ข้อความไทย + DETAIL JSON จำนวน · ทำกับทุก role (รวม postgres)
--      - ล็อกแถวทีม FOR UPDATE ก่อนนับ → การผูกงานที่กำลังเขียนอยู่ต้องรอ แล้วนับเห็น
--      - ช่องโหว่ที่เหลือ (รู้แล้ว ไม่บล็อก): save_service_visit อ่าน kind ไม่ล็อก — ถ้าเช็ก SV006 ผ่านก่อนเปลี่ยนประเภท
--        แล้วเขียน visit_teams หลังจากนั้น จะหลุดได้ 1 รายการ (โอกาสต่ำมาก การเปลี่ยนประเภททีมนานๆ ครั้ง)
--   6. audit: trigger `audit_teams` / `audit_customer_types` / `audit_app_settings` เรียก `public.audit_trigger()` เดิม
--      **ไม่แทนที่ audit_trigger** (ตัวล่าสุด = M19a 20261115150000) — ไม่ต้องใช้บริบทเพิ่ม
--      · customer_types ไม่มีคอลัมน์ id → audit_log.row_id = NULL (รหัสอยู่ใน old_data/new_data)
--      · app_settings ไม่มี id → row_id = NULL · reorder_customer_types เขียน 2 รอบ → audit 2 แถวต่อประเภท
--   7. `ag_box_counts_by_branch(p_month)` — จำนวนกล่อง AG ต่อสาขา (host/admin/recorder · ตามขอบเขตส่วนงาน)
--      - ag_in_use       = กล่อง AG ที่ใช้งานอยู่ "ตอนนี้" (active / eliminated / pending_removal) จาก stations
--      - ag_checked      = กล่อง AG ที่มีผลตรวจจริง (checked) ในเดือน p_month — ใช้หาร "ก./กล่อง AG"
--      - ag_checked_prev = เหมือนบน ของเดือนก่อนหน้า (ใช้ % เทียบเดือนก่อน)
--      - ag_in_use_prev  = NULL เสมอ: ระบบยังไม่มีที่เก็บจำนวนกล่องรายเดือน (monthly_branch_snapshots ไม่มีช่อง AG ·
--        stations ย้อนหลังไม่ได้ — lost ไม่มีเวลา, eliminated ไม่มีเวลา, installed_at ว่างได้) → ดูรายงาน M25
--      - viewer / anon / ไม่มีโปรไฟล์ → 42501 (ไม่คืนแถว 0 ปลอมๆ)
--   * error ใหม่: AS001 (go_live_month / แถวค่าตั้งระบบ แก้ไม่ได้) · WL001 (ค่า Workload ไม่ถูกต้อง)
--     · TR005 (เกณฑ์ Tier ก่อนเดือนเริ่มใช้ระบบ) · TM003 (เปลี่ยนเป็นทีมหัวหน้างานขณะมีงานผูก)

-- =====================================================================
-- 1. app_settings (แถวเดียว)
-- =====================================================================
CREATE TABLE public.app_settings (
  singleton                 boolean PRIMARY KEY DEFAULT true
                              CONSTRAINT app_settings_singleton CHECK (singleton),
  go_live_month             date NOT NULL DEFAULT DATE '2026-10-01'
                              CONSTRAINT app_settings_go_live_first_day
                              CHECK (go_live_month = date_trunc('month', go_live_month)::date),
  workload_hours_per_person numeric(5,2) NOT NULL DEFAULT 30
                              CONSTRAINT app_settings_workload_positive CHECK (workload_hours_per_person > 0),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid
);

COMMENT ON TABLE public.app_settings IS
  'M25: ค่าตั้งระบบแถวเดียว — อ่านผ่าน go_live_month() / workload_hours_per_person() · ห้าม hardcode ค่าเหล่านี้ที่อื่น';
COMMENT ON COLUMN public.app_settings.go_live_month IS
  'M25: เดือนแรกที่ใช้ระบบ (วันที่ 1) — แก้ได้เฉพาะผู้ดูแลฐานข้อมูล (postgres) · เปลี่ยนแล้วตัวเลขย้อนหลังเปลี่ยน';
COMMENT ON COLUMN public.app_settings.workload_hours_per_person IS
  'M25: เกณฑ์ Workload ชม./คน/เดือน — host แก้ผ่าน save_workload_threshold (ลง audit_log)';

INSERT INTO public.app_settings (singleton) VALUES (true);

-- ด่าน: ลบแถวไม่ได้ · go_live_month แก้ได้เฉพาะ session ของผู้ดูแลฐานข้อมูล
CREATE FUNCTION public.app_settings_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'ลบค่าตั้งระบบไม่ได้ (ตารางนี้ต้องมี 1 แถวเสมอ)' USING ERRCODE = 'AS001';
  END IF;

  -- session_user = role ที่ต่อเข้ามาจริง (ทาง API = authenticator) — ไม่เปลี่ยนตาม SECURITY DEFINER / SET ROLE
  IF NEW.go_live_month IS DISTINCT FROM OLD.go_live_month
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'เดือนเริ่มใช้ระบบแก้ได้เฉพาะผู้ดูแลฐานข้อมูล' USING ERRCODE = 'AS001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_settings_guard
  BEFORE UPDATE OR DELETE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.app_settings_guard();
CREATE TRIGGER app_settings_no_truncate
  BEFORE TRUNCATE ON public.app_settings
  FOR EACH STATEMENT EXECUTE FUNCTION public.app_settings_guard();

CREATE TRIGGER audit_app_settings
  AFTER UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_settings_select ON public.app_settings FOR SELECT TO authenticated USING (true);

-- helper: จุดอ่านเดียว · SECURITY DEFINER ให้ฟังก์ชัน/trigger ของทุก role เรียกได้โดยไม่ต้องพึ่ง GRANT ตาราง
CREATE FUNCTION public.go_live_month()
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v date;
BEGIN
  SELECT s.go_live_month INTO v FROM app_settings s WHERE s.singleton;
  IF v IS NULL THEN
    RAISE EXCEPTION 'app_settings row is missing (go_live_month)' USING ERRCODE = 'AS001';
  END IF;
  RETURN v;
END;
$$;

CREATE FUNCTION public.workload_hours_per_person()
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v numeric;
BEGIN
  SELECT s.workload_hours_per_person INTO v FROM app_settings s WHERE s.singleton;
  IF v IS NULL THEN
    RAISE EXCEPTION 'app_settings row is missing (workload_hours_per_person)' USING ERRCODE = 'AS001';
  END IF;
  RETURN v;
END;
$$;

-- RPC บันทึกเกณฑ์ Workload (host เท่านั้น) — คำยืนยัน "ยืนยันแก้ไข" ตรวจที่หน้าจอ · DB บังคับ role + ช่วงค่า
-- คืนค่าที่บันทึกแล้ว (numeric)
CREATE FUNCTION public.save_workload_threshold(p_hours numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_saved numeric;
BEGIN
  IF NOT public.is_host() THEN
    RAISE EXCEPTION 'บันทึกเกณฑ์ Workload ได้เฉพาะผู้ดูแลระบบ (host)' USING ERRCODE = '42501';
  END IF;
  IF p_hours IS NULL OR p_hours <= 0 OR p_hours > 300 THEN
    RAISE EXCEPTION 'เกณฑ์ Workload ต้องมากกว่า 0 และไม่เกิน 300 ชม./คน/เดือน' USING ERRCODE = 'WL001';
  END IF;
  IF p_hours <> round(p_hours, 2) THEN
    RAISE EXCEPTION 'เกณฑ์ Workload มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง' USING ERRCODE = 'WL001';
  END IF;

  -- ค่าเดิมซ้ำ = ไม่เขียน (ไม่มีแถว audit เปล่า)
  UPDATE app_settings s
     SET workload_hours_per_person = p_hours,
         updated_at = now(),
         updated_by = auth.uid()
   WHERE s.singleton AND s.workload_hours_per_person IS DISTINCT FROM p_hours;

  SELECT s.workload_hours_per_person INTO v_saved FROM app_settings s WHERE s.singleton;
  IF v_saved IS NULL THEN
    RAISE EXCEPTION 'app_settings row is missing (workload_hours_per_person)' USING ERRCODE = 'AS001';
  END IF;
  RETURN v_saved;
END;
$$;

-- =====================================================================
-- 2. M20b — เกณฑ์ Tier ห้ามมีผลก่อนเดือนเริ่มใช้ระบบ (ยกเว้นชุดตั้งต้น 2000-01-01)
-- =====================================================================
-- 2.1 trigger guard (เนื้อ M20 20261115130000 ทุกบรรทัด + บล็อก "M25")
CREATE OR REPLACE FUNCTION public.tier_rules_closed_month_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month    date;
  v_next     date;
  v_baseline date;
  v_closed   text;
  v_go_live  date;   -- M25
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;

  -- M25 (M20b · DECISIONS 2.49 ①): เดือนเริ่มใช้ต้องไม่ก่อนเดือนเริ่มใช้ระบบ — ชุดตั้งต้น 2000-01-01 ยกเว้น
  IF TG_OP <> 'DELETE' AND NEW.effective_month <> DATE '2000-01-01' THEN
    v_go_live := public.go_live_month();
    IF NEW.effective_month < v_go_live THEN
      RAISE EXCEPTION 'เกณฑ์ Tier ต้องเริ่มใช้ตั้งแต่เดือนเริ่มใช้ระบบ (%) เป็นต้นไป', to_char(v_go_live, 'YYYY-MM')
        USING ERRCODE = 'TR005';
    END IF;
  END IF;

  -- กันปิดเดือนแทรกระหว่างตรวจ (ทุกทาง ไม่ใช่แค่ RPC) — ปิดเดือนรอจนรายการนี้ commit
  LOCK TABLE public.month_closures IN SHARE MODE;

  -- ชุดตั้งต้น (เดือนแรกสุด) ลบหรือย้ายเดือนไม่ได้ — ไม่งั้นเดือนเก่าไม่มีเกณฑ์ (แก้ค่าได้ถ้าไม่กระทบเดือนที่ปิด)
  IF TG_OP <> 'INSERT' THEN
    SELECT min(effective_month) INTO v_baseline FROM tier_rules;
    IF OLD.effective_month = v_baseline
       AND (TG_OP = 'DELETE' OR NEW.effective_month <> OLD.effective_month) THEN
      RAISE EXCEPTION 'ชุดเกณฑ์ตั้งต้น (%) ลบหรือย้ายเดือนไม่ได้', to_char(v_baseline, 'YYYY-MM')
        USING ERRCODE = 'TR004';
    END IF;
  END IF;

  -- ช่วงที่ชุดนี้มีผล = ตั้งแต่ effective_month ถึงก่อนชุดถัดไป
  -- (ทั้งตอนเพิ่ม/แก้ และตอนลบ — ลบแล้วช่วงนี้กลับไปใช้ชุดก่อนหน้า)
  FOREACH v_month IN ARRAY ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.effective_month END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.effective_month END
  ] LOOP
    CONTINUE WHEN v_month IS NULL;
    SELECT min(effective_month) INTO v_next FROM tier_rules WHERE effective_month > v_month;
    SELECT max(public.normalize_month_key(mc.month_key)) INTO v_closed
      FROM month_closures mc
     WHERE public.normalize_month_key(mc.month_key) >= to_char(v_month, 'YYYY-MM')
       AND (v_next IS NULL OR public.normalize_month_key(mc.month_key) < to_char(v_next, 'YYYY-MM'));
    IF v_closed IS NOT NULL THEN
      RAISE EXCEPTION 'เกณฑ์ที่เริ่มใช้ % จะกระทบเดือน % ที่ปิดแล้ว — เลือกเดือนเริ่มใช้หลังเดือนที่ปิดล่าสุด',
        to_char(v_month, 'YYYY-MM'), v_closed USING ERRCODE = 'TR002';
    END IF;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- 2.2 RPC บันทึกชุดเกณฑ์ (เนื้อ M20 20261115130000 ทุกบรรทัด + บล็อก "M25")
CREATE OR REPLACE FUNCTION public.save_tier_rule_set(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month_txt text := p ->> 'effective_month';
  v_month     date;
  v_reason    text := btrim(coalesce(p ->> 'reason', ''));
  v_keys      text[] := ARRAY['min_m', 'min_l', 'min_xl'];
  v_mins      numeric[] := ARRAY[]::numeric[];
  v_val       numeric;
  v_baseline  date;
  v_go_live   date;   -- M25
  k           text;
BEGIN
  IF NOT public.is_host() THEN
    RAISE EXCEPTION 'บันทึกเกณฑ์ Tier ได้เฉพาะผู้ดูแลระบบ (host)' USING ERRCODE = '42501';
  END IF;

  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'ข้อมูลไม่ถูกต้อง' USING ERRCODE = 'TR001';
  END IF;

  IF v_month_txt IS NULL OR v_month_txt !~ '^\d{4}-(0[1-9]|1[0-2])(-01)?$' THEN
    RAISE EXCEPTION 'เดือนเริ่มใช้ต้องเป็นรูปแบบ YYYY-MM' USING ERRCODE = 'TR001';
  END IF;
  v_month := to_date(left(v_month_txt, 7) || '-01', 'YYYY-MM-DD');

  -- M25 (M20b · DECISIONS 2.49 ①): ห้ามตั้งเกณฑ์ใหม่ก่อนเดือนเริ่มใช้ระบบ
  v_go_live := public.go_live_month();
  IF v_month < v_go_live THEN
    RAISE EXCEPTION 'เกณฑ์ Tier ต้องเริ่มใช้ตั้งแต่เดือนเริ่มใช้ระบบ (%) เป็นต้นไป', to_char(v_go_live, 'YYYY-MM')
      USING ERRCODE = 'TR005';
  END IF;

  FOREACH k IN ARRAY v_keys LOOP
    IF jsonb_typeof(p -> k) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'ต้องระบุ % เป็นตัวเลข', k USING ERRCODE = 'TR001';
    END IF;
    v_val := (p ->> k)::numeric;
    IF v_val <= 0 OR v_val >= 10000000000 THEN
      RAISE EXCEPTION '% ต้องมากกว่า 0 และไม่เกิน 9,999,999,999.99', k USING ERRCODE = 'TR001';
    END IF;
    IF v_val <> round(v_val, 2) THEN
      RAISE EXCEPTION '% มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง', k USING ERRCODE = 'TR001';
    END IF;
    v_mins := v_mins || v_val;
  END LOOP;
  -- ห่างกันอย่างน้อย 0.02 (และ M >= 0.02) — ไม่งั้นปลายช่วง (= จุดเริ่มถัดไป − 0.01) ไม่มากกว่าจุดเริ่มของตัวเอง
  IF NOT (v_mins[1] >= 0.02 AND v_mins[2] - v_mins[1] >= 0.02 AND v_mins[3] - v_mins[2] >= 0.02) THEN
    RAISE EXCEPTION 'จุดเริ่ม M < L < XL ต้องเรียงจากน้อยไปมาก (ห่างกันอย่างน้อย 0.02)' USING ERRCODE = 'TR001';
  END IF;

  IF v_reason = '' THEN
    RAISE EXCEPTION 'ต้องระบุเหตุผลที่แก้เกณฑ์' USING ERRCODE = 'TR003';
  END IF;
  IF length(v_reason) > 500 THEN
    RAISE EXCEPTION 'เหตุผลยาวได้ไม่เกิน 500 ตัวอักษร' USING ERRCODE = 'TR001';
  END IF;

  -- กันบันทึกชนกัน (การล็อก month_closures อยู่ใน trigger guard)
  LOCK TABLE public.tier_rules IN SHARE ROW EXCLUSIVE MODE;

  SELECT min(effective_month) INTO v_baseline FROM tier_rules;
  IF v_baseline IS NOT NULL AND v_month <= v_baseline THEN
    RAISE EXCEPTION 'เดือนเริ่มใช้ต้องหลังชุดตั้งต้น (%)', to_char(v_baseline, 'YYYY-MM') USING ERRCODE = 'TR001';
  END IF;

  INSERT INTO tier_rules AS t (effective_month, tier, min_annual, max_annual, change_reason)
  VALUES
    (v_month, 'S',  0,          v_mins[1] - 0.01, v_reason),
    (v_month, 'M',  v_mins[1],  v_mins[2] - 0.01, v_reason),
    (v_month, 'L',  v_mins[2],  v_mins[3] - 0.01, v_reason),
    (v_month, 'XL', v_mins[3],  NULL,             v_reason)
  ON CONFLICT (effective_month, tier) DO UPDATE
    SET min_annual    = EXCLUDED.min_annual,
        max_annual    = EXCLUDED.max_annual,
        change_reason = EXCLUDED.change_reason;

  -- ให้ TR004 ขึ้นทันที · หมายเหตุ: มีผลกับส่วนที่เหลือของ transaction ผู้เรียกด้วย
  -- (ผ่าน PostgREST = 1 คำสั่งต่อ transaction ไม่กระทบ)
  SET CONSTRAINTS public.tier_rules_valid_set IMMEDIATE;

  RETURN jsonb_build_object(
    'effective_month', to_char(v_month, 'YYYY-MM-DD'),
    'rules', (SELECT jsonb_agg(jsonb_build_object('tier', tier, 'min_annual', min_annual,
                                                  'max_annual', max_annual) ORDER BY min_annual)
                FROM tier_rules WHERE effective_month = v_month)
  );
END;
$$;

-- =====================================================================
-- 3. oldest_open_month — floor = go_live_month() (เนื้อ M24 20261115140000 · แก้เฉพาะบล็อก "M25")
-- =====================================================================
CREATE OR REPLACE FUNCTION public.oldest_open_month()
RETURNS TABLE (
  scope             public.closure_scope,
  oldest_open_month date,
  is_behind         boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role      text := current_app_role();
  v_divs      text[] := current_division_scope()::text[];
  v_now_month date := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
  v_go_live   date;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'not allowed to read month closures' USING ERRCODE = '42501';
  END IF;

  -- M25: เดือนเริ่มใช้ระบบอ่านจาก app_settings (ไม่เดาจากแถว legacy อีกต่อไป) · เดือนก่อนหน้านี้ไม่นับว่าค้าง
  v_go_live := go_live_month();

  RETURN QUERY
  WITH sc AS (
    SELECT e AS scope
      FROM unnest(enum_range(NULL::closure_scope)) e
     WHERE v_role = 'host' OR e::text = ANY (coalesce(v_divs, '{}'))
  ), closed AS (
    -- trigger month_closures_only_past_months บังคับ 'YYYY-MM' แล้ว · normalize กันแถวเก่ารูปแบบอื่น
    SELECT mc.scope, to_date(normalize_month_key(mc.month_key) || '-01', 'YYYY-MM-DD') AS m
      FROM month_closures mc
     WHERE normalize_month_key(mc.month_key) ~ '^\d{4}-(0[1-9]|1[0-2])$'
  ), fl AS (
    SELECT sc.scope,
           least(v_go_live, v_now_month) AS floor_month   -- M25
      FROM sc
  )
  SELECT fl.scope,
         coalesce(o.m, v_now_month),
         coalesce(o.m, v_now_month) < v_now_month
    FROM fl
    LEFT JOIN LATERAL (
      SELECT min(gs::date) AS m
        FROM generate_series(fl.floor_month, (v_now_month - interval '1 month')::date, interval '1 month') gs
       WHERE NOT EXISTS (SELECT 1 FROM closed cl WHERE cl.scope = fl.scope AND cl.m = gs::date)
    ) o ON true
   ORDER BY fl.scope;
END;
$$;

-- =====================================================================
-- 4. teams.headcount — จำนวนคนภาคสนาม (ใช้คิด ชม./คน)
-- =====================================================================
ALTER TABLE public.teams
  ADD COLUMN headcount int NOT NULL DEFAULT 0
    CONSTRAINT teams_headcount_range CHECK (headcount BETWEEN 0 AND 99);

COMMENT ON COLUMN public.teams.headcount IS
  'M25: จำนวนคนภาคสนามของทีม (0–99 ตาม mockup) — ใช้คำนวณ ชม./คน เทียบ workload_hours_per_person() · 0 = ยังไม่ระบุ (หน้าจอห้ามหารศูนย์)';

-- =====================================================================
-- 5. ด่านประเภททีม: เปลี่ยนเป็นทีมหัวหน้างานไม่ได้ ถ้ายังมีงานผูก (กัน SV006 ขัดกับการเข้าเดิม)
-- =====================================================================
CREATE FUNCTION public.teams_kind_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contracts int;
  v_visits    int;
BEGIN
  IF NEW.kind IS DISTINCT FROM 'supervisor' OR OLD.kind IS NOT DISTINCT FROM 'supervisor' THEN
    RETURN NEW;
  END IF;

  -- ล็อกแถวทีมแรงสุด: การผูกงานที่ยังไม่ commit (FK ถือ KEY SHARE) ต้องจบก่อน แล้วการนับข้างล่างเห็นแถวนั้น
  -- และการผูกงานใหม่ต้องรอจนรายการนี้จบ
  PERFORM 1 FROM teams t WHERE t.id = OLD.id FOR UPDATE;

  SELECT count(*) INTO v_contracts FROM contract_teams ct WHERE ct.team_id = OLD.id;
  SELECT count(DISTINCT vt.visit_id) INTO v_visits FROM visit_teams vt WHERE vt.team_id = OLD.id;

  IF v_contracts + v_visits > 0 THEN
    RAISE EXCEPTION 'เปลี่ยนทีม % เป็นทีมหัวหน้างานไม่ได้ เพราะยังมีงานผูกอยู่ (สัญญา % · การเข้าบริการ %)',
                    OLD.code, v_contracts, v_visits
      USING ERRCODE = 'TM003',
            DETAIL  = jsonb_build_object('contracts', v_contracts, 'visits', v_visits)::text;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER teams_kind_guard
  BEFORE UPDATE OF kind ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.teams_kind_guard();

-- =====================================================================
-- 6. audit ทีม + ประเภทลูกค้า (ใช้ audit_trigger ตัวล่าสุดของ M19a โดยไม่แก้เนื้อ)
-- =====================================================================
CREATE TRIGGER audit_teams
  AFTER INSERT OR UPDATE OR DELETE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_customer_types
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_types
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- =====================================================================
-- 7. จำนวนกล่อง AG ต่อสาขา (หน้า #material)
--    p_month: วันใดก็ได้ในเดือน · NULL = เดือนปัจจุบัน (เวลาไทย)
-- =====================================================================
CREATE FUNCTION public.ag_box_counts_by_branch(p_month date DEFAULT NULL)
RETURNS TABLE (
  branch_id       uuid,
  branch_name     text,
  ag_in_use       int,
  ag_checked      int,
  ag_checked_prev int,
  ag_in_use_prev  int
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role  text := current_app_role();
  v_month date := date_trunc('month', coalesce(p_month, (now() AT TIME ZONE 'Asia/Bangkok')::date))::date;
  v_prev  date;
BEGIN
  -- ข้อมูลระดับสถานีลูกค้า — viewer / anon / ไม่มีโปรไฟล์ ไม่ได้ (PDPA กฎข้อ 2)
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'not allowed to read AG box counts' USING ERRCODE = '42501';
  END IF;
  v_prev := (v_month - interval '1 month')::date;

  RETURN QUERY
  WITH br AS (
    -- RLS ของ stations/visits อ่านได้ทุกส่วนงาน → กรองขอบเขตส่วนงานเอง (host เห็นทั้งหมด)
    SELECT b.id, b.name, z.sort_order
      FROM branches b
      JOIN zones z ON z.id = b.zone_id
     WHERE v_role = 'host' OR branch_in_scope(b.id)
  ), in_use AS (
    SELECT cu.branch_id, count(*)::int AS n
      FROM stations s
      JOIN contracts c  ON c.id = s.contract_id
      JOIN customers cu ON cu.id = c.customer_id
     WHERE s.type = 'AG' AND s.status IN ('active', 'eliminated', 'pending_removal')
     GROUP BY cu.branch_id
  ), checked AS (
    SELECT cu.branch_id,
           count(DISTINCT sc.station_id) FILTER (WHERE v.visit_date >= v_month
                                                   AND v.visit_date < v_month + interval '1 month')::int AS n_cur,
           count(DISTINCT sc.station_id) FILTER (WHERE v.visit_date >= v_prev
                                                   AND v.visit_date < v_month)::int AS n_prev
      FROM station_checks sc
      JOIN visits v     ON v.id = sc.visit_id
      JOIN stations s   ON s.id = sc.station_id
      JOIN contracts c  ON c.id = v.contract_id
      JOIN customers cu ON cu.id = c.customer_id
     WHERE sc.checked AND s.type = 'AG'
       AND v.visit_date >= v_prev AND v.visit_date < v_month + interval '1 month'
     GROUP BY cu.branch_id
  )
  SELECT br.id, br.name,
         coalesce(iu.n, 0),
         coalesce(ck.n_cur, 0),
         coalesce(ck.n_prev, 0),
         NULL::int                     -- ยังไม่มีที่เก็บจำนวนกล่องรายเดือน (ดูหัวไฟล์ข้อ 7)
    FROM br
    LEFT JOIN in_use iu  ON iu.branch_id = br.id
    LEFT JOIN checked ck ON ck.branch_id = br.id
   ORDER BY br.sort_order, br.name;
END;
$$;

-- =====================================================================
-- 8. สิทธิ์
-- =====================================================================
-- app_settings: ไม่มีใครเขียนผ่าน API ได้ (UPDATE เฉพาะ owner = postgres) · authenticated อ่านอย่างเดียว · anon ไม่มีอะไร
REVOKE ALL ON public.app_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.app_settings TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.app_settings_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.teams_kind_guard() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.go_live_month() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.go_live_month() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.workload_hours_per_person() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workload_hours_per_person() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_workload_threshold(numeric) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_workload_threshold(numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.ag_box_counts_by_branch(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ag_box_counts_by_branch(date) TO authenticated;

-- แทนที่ด้วย OR REPLACE คงสิทธิ์เดิม — ย้ำอีกครั้งกันพลาด
REVOKE ALL ON FUNCTION public.tier_rules_closed_month_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_tier_rule_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_tier_rule_set(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.oldest_open_month() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.oldest_open_month() TO authenticated, service_role;
