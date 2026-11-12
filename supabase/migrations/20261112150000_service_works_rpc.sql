-- ก้อน ③ schema หน้ากรอกข้อมูลทำบริการ: งานซ่อม/ฝังเพิ่ม · บันทึกทั้งฟอร์มเป็นก้อนเดียว · สรุปวัสดุ
-- เจ้าของอนุมัติแบบ 12 พ.ย. 2026 · แบบเต็ม: docs/plans/2026-11-12-service-entry-schema.md
-- (เลขไฟล์ตั้งให้ใหม่กว่า M12 `20261112140000` เพื่อไม่ให้ลำดับบน cloud สลับ)
--
-- Logic summary:
--   * `station_works` = 1 แถวต่อ 1 รายการงานซ่อม/ฝังเพิ่มในการเข้า 1 ครั้ง
--       kind: cap_replaced เปลี่ยนฝา · lost สถานีหาย · withdrawn ถอนออก · other อื่นๆ · added ฝังใหม่
--       `station_nos` = เลขที่แปลงจาก "3, 5, 8-12" แล้ว (lib/service/stationNumbers.ts) · ไม่ว่าง ไม่ซ้ำ ≤ 500
--       "สถานีหาย" และ "อื่นๆ" ต้องมีรายละเอียด · งานซ่อมใช้กับ IG/IC · ฝังใหม่ใช้กับ IG/IC/AG (ติดกล่อง AG ใหม่ = S)
--       `effects` (ระบบเขียนเอง) = ผลที่ทำกับสถานี เก็บไว้ย้อนคืนตอนแก้/ลบ:
--         added → {"created": [station ids]} · lost/withdrawn → {"prev": {station id: สถานะเดิม}}
--   * `save_service_visit(p jsonb)` — 1 การเรียก = 1 transaction · SECURITY INVOKER (RLS ของผู้เรียกทำงาน)
--       - หน้าจอสร้าง `visit_id` เอง → กดบันทึกซ้ำ = แก้ครั้งเดิม ไม่เกิดการเข้า 2 ครั้ง
--       - ล็อกต่อสัญญาด้วย pg_advisory_xact_lock เป็นคำสั่งแรก: 2 คนบันทึกลูกค้ารายเดียวกันพร้อมกัน
--         จะเข้าทีละคน → เลข F ไม่ค้างผิด
--       - สิทธิ์: host หรือ recorder ในขอบเขตหน่วยงาน (ตรวจตรงๆ ก่อน เพราะ RLS ที่ปฏิเสธ UPDATE ไม่ error)
--       - ต้องตั้งสถานีของสัญญาแล้ว (initialize_contract_stations) ไม่งั้น SV003
--       - ทีม ≥ 1 และเป็น A–O หรือ Z เท่านั้น (SV006)
--       - **แก้ = เทียบของเดิม** ไม่ลบทั้งชุดแล้วใส่ใหม่ (audit ไม่เก็บการเพิ่มตาม M3 → ลบแล้วใส่ใหม่ ประวัติจะหาย
--         และ created_by จะเพี้ยน): ทีม/ผลตรวจ/งานซ่อม แก้เฉพาะที่เปลี่ยน ลบเฉพาะที่หาย เพิ่มเฉพาะที่ใหม่ ·
--         ผลตรวจที่ค่าเท่าเดิมไม่ถูก UPDATE (ไม่ลง audit)
--       - กันลืมกล่อง (D10): กล่อง AG ที่ยังใช้งานทุกจุดต้องมีแถวผล (ตรวจแล้ว หรือ checked = false) หรือส่ง
--         `skip_all_ag` = true (ระบบใส่แถว "ไม่ได้ตรวจ" ให้ทุกจุด) ไม่งั้น SV004
--       - สถานีที่ฝังใหม่ในการเข้านี้ (S) ไม่มีผลตรวจในการเข้าเดียวกัน (ส่งมา = SV001) และไม่นับใน D10 →
--         กล่อง AG ใหม่ได้ F1 ในการติดตามครั้งแรกหลังติดตั้ง (SPEC §7.5)
--       - งานซ่อมที่ถูกเอาออก/เปลี่ยน → ย้อนผลกับสถานี (ลบสถานีที่ฝังใหม่ · คืนสถานะเดิม) ได้เฉพาะเมื่อ
--         การเข้าครั้งอื่นยังไม่ใช้สถานีนั้น ไม่งั้น SV005
--   * `delete_service_visit(p_visit_id)` — ย้อนผลงานซ่อมทั้งหมดของการเข้านั้น (กติกา SV005 เดียวกัน) แล้วลบ
--     (ทีม/ผลตรวจ/งานซ่อมลบตามแบบ CASCADE · เลข F คำนวณใหม่เอง)
--   * view `v_service_materials` (security_invoker) ต่อการเข้า 1 ครั้ง: เหยื่อนอก (IG+IC) · เหยื่อใน (AG) ·
--     เคมีผง (จุด และกรัม = จุด × 0.3) · ไม้ล่อ (IG 2 ชิ้น · IC 1 ชิ้น) — เจ้าของเลือก ก1 รายสถานีแล้วรวมด้วย view
--   * error code: SV001 สถานีไม่มี/ไม่ได้ใช้งาน · SV002 เลขฝังใหม่ซ้ำกับสถานีที่ใช้งาน · SV003 ยังไม่ตั้งสถานี ·
--     SV004 กล่อง AG ยังไม่ครบ · SV005 แก้/ลบงานซ่อมที่การเข้าครั้งอื่นใช้สถานีแล้วไม่ได้ · SV006 ทีมไม่ถูกต้อง ·
--     AG004 ไม่พบสัญญา/การเข้า · 42501 ไม่มีสิทธิ์ · 22004/22023 ข้อมูลที่หน้าจอส่งมาไม่ครบ/ไม่ถูก (บั๊กหน้าจอ)
--   * สิทธิ์ตาราง station_works: ผู้ใช้ **อ่านอย่างเดียว** (host / admin / recorder · anon ไม่มี) ·
--     เขียนได้ผ่าน RPC เท่านั้น — `effects` เป็นตัวที่บอกว่าย้อนแล้วต้องลบ/คืนสถานีไหน ถ้าให้เขียนตรงได้
--     หัวหน้างานจะปลอม effects แล้วลบสถานีใดก็ได้ในสัญญา (ผลตรวจของศูนย์กลาง 12 พ.ย. 2026)
--   * ฟังก์ชันภายใน `service_work_apply` / `service_work_set_detail` / `service_work_undo` (SECURITY DEFINER)
--     ทำงานได้เฉพาะเมื่อถูกเรียกจากใน save_service_visit / delete_service_visit ของการเข้าเดียวกัน
--     (RPC ตั้งค่า `aga.service_visit` = visit id แบบ transaction-local · ผู้ใช้ตั้งค่านี้เองผ่าน API ไม่ได้)
--     และตรวจสิทธิ์ซ้ำเอง · effects คำนวณฝั่งฐานข้อมูลเสมอ ไม่รับจากหน้าจอ
--   * ตรวจตำแหน่ง (host/recorder) ก่อนถือ advisory lock · ขนาดรายการใน payload มีเพดาน (22023)
--   * โหมดแก้: ช่องบังคับ (visit_type, start_time, end_time) ต้องส่งครบ (22004) · ช่องไม่บังคับที่ไม่ได้ส่ง
--     (note, internal_inspection, signed_by_proxy) คงค่าเดิม ไม่ถูกล้างเป็น NULL
--   * สถานะจุด AG ผ่าน `station_statuses` เปลี่ยนได้เฉพาะจาก active / pending_removal (ไม่ปลุกกล่องที่ถอด/กำจัดแล้ว)

-- =====================================================================
-- 1. ตาราง station_works
-- =====================================================================
CREATE TYPE public.station_work_kind AS ENUM ('cap_replaced', 'lost', 'withdrawn', 'other', 'added');

CREATE FUNCTION public.int_array_is_unique(p int[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT cardinality(p) = (SELECT count(DISTINCT x) FROM unnest(p) x);
$$;

CREATE TABLE public.station_works (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id     uuid NOT NULL REFERENCES public.visits (id) ON DELETE CASCADE,
  kind         public.station_work_kind NOT NULL,
  station_type public.station_type NOT NULL,
  station_nos  int[] NOT NULL,
  detail       text,
  effects      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by   uuid REFERENCES auth.users (id) DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT station_works_nos_size CHECK (cardinality(station_nos) BETWEEN 1 AND 500),
  CONSTRAINT station_works_nos_positive CHECK (0 < ALL (station_nos)),
  CONSTRAINT station_works_nos_unique CHECK (public.int_array_is_unique(station_nos)),
  CONSTRAINT station_works_detail_required CHECK (
    kind NOT IN ('lost', 'other') OR (detail IS NOT NULL AND btrim(detail) <> '')),
  CONSTRAINT station_works_repair_ig_ic CHECK (kind = 'added' OR station_type IN ('IG', 'IC'))
);
CREATE INDEX station_works_visit_id_idx ON public.station_works (visit_id);
CREATE INDEX station_works_station_nos_idx ON public.station_works USING gin (station_nos);

ALTER TABLE public.station_works ENABLE ROW LEVEL SECURITY;
CREATE POLICY station_works_select ON public.station_works FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));
-- ไม่มี policy เขียน: เขียนผ่านฟังก์ชันภายในที่ RPC เรียกเท่านั้น (ดูหัวไฟล์)

-- =====================================================================
-- 2. audit — station_works (เนื้อเดิมจาก 20261112130100 + เพิ่ม station_works ในกรณีที่หาบริบทจาก visit)
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

  -- เลข F ที่ระบบคำนวณใหม่ ไม่ใช่การแก้ของคน → ไม่ลง (กัน "แก้หลังปิดเดือน" พอง)
  IF TG_TABLE_NAME = 'station_checks' AND TG_OP = 'UPDATE'
     AND (v_old - 'follow_up_no') = (v_new - 'follow_up_no') THEN
    RETURN NULL;
  END IF;

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
    WHEN 'station_checks', 'visit_teams', 'station_works' THEN
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

CREATE TRIGGER audit_station_works
  AFTER UPDATE OR DELETE ON public.station_works
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- =====================================================================
-- 3. ฟังก์ชันภายในของงานซ่อม (SECURITY DEFINER)
--    ทำไมต้อง DEFINER: หัวหน้างานลบสถานีเองไม่ได้ (ไม่มี policy ลบ) แต่การย้อน "ฝังใหม่" ต้องลบสถานีที่การเข้านั้น
--    สร้าง · และ station_works ผู้ใช้เขียนตรงไม่ได้ (กันปลอม effects)
--    ด่าน 2 ชั้นในทุกตัว: (1) ถูกเรียกจากใน RPC ของการเข้าเดียวกันเท่านั้น (aga.service_visit = visit id)
--    (2) ผู้เรียกเป็น host หรือ recorder ในขอบเขตของสัญญา · effects คำนวณที่นี่เสมอ
-- =====================================================================
CREATE FUNCTION public.service_work_gate(p_visit_id uuid)
RETURNS uuid   -- คืน contract_id ของการเข้า
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract uuid;
BEGIN
  IF p_visit_id IS NULL
     OR coalesce(current_setting('aga.service_visit', true), '') <> p_visit_id::text THEN
    RAISE EXCEPTION 'service works can only be changed through save_service_visit / delete_service_visit'
      USING ERRCODE = '42501';
  END IF;
  SELECT vi.contract_id INTO v_contract FROM visits vi WHERE vi.id = p_visit_id;
  IF v_contract IS NULL
     OR NOT (is_host() OR (current_app_role() = 'recorder' AND contract_in_scope(v_contract))) THEN
    RAISE EXCEPTION 'not allowed to change this visit' USING ERRCODE = '42501';
  END IF;
  RETURN v_contract;
END;
$$;

-- ทำผลกับสถานีแล้วบันทึกงาน 1 รายการ
CREATE FUNCTION public.service_work_apply(
  p_visit_id     uuid,
  p_work_id      uuid,
  p_kind         public.station_work_kind,
  p_station_type public.station_type,
  p_station_nos  int[],
  p_detail       text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract uuid := service_work_gate(p_visit_id);
  v_date     date;
  v_nos      int[] := ARRAY(SELECT DISTINCT n FROM unnest(coalesce(p_station_nos, '{}')) n ORDER BY n);
  v_ids      uuid[];
  v_effects  jsonb;
BEGIN
  SELECT vi.visit_date INTO v_date FROM visits vi WHERE vi.id = p_visit_id;

  IF p_kind = 'added' THEN
    IF EXISTS (SELECT 1 FROM stations s
                WHERE s.contract_id = v_contract AND s.type = p_station_type
                  AND s.station_no = ANY (v_nos)
                  AND s.status IN ('active', 'eliminated', 'pending_removal')) THEN
      RAISE EXCEPTION 'a new station number is already in use' USING ERRCODE = 'SV002';
    END IF;
    WITH ins AS (
      INSERT INTO stations (contract_id, type, station_no, status, installed_at)
      SELECT v_contract, p_station_type, n, 'active', v_date FROM unnest(v_nos) n
      RETURNING id
    )
    SELECT jsonb_build_object('created', coalesce(jsonb_agg(ins.id), '[]')) INTO v_effects FROM ins;
  ELSE
    v_ids := ARRAY(SELECT s.id FROM stations s
                    WHERE s.contract_id = v_contract AND s.type = p_station_type
                      AND s.station_no = ANY (v_nos)
                      AND s.status IN ('active', 'eliminated', 'pending_removal'));
    IF cardinality(v_ids) <> cardinality(v_nos) THEN
      RAISE EXCEPTION 'station number does not exist or is not in use' USING ERRCODE = 'SV001';
    END IF;
    IF p_kind IN ('lost', 'withdrawn') THEN
      SELECT jsonb_build_object('prev', jsonb_object_agg(s.id, s.status)) INTO v_effects
        FROM stations s WHERE s.id = ANY (v_ids);
      UPDATE stations s
         SET status     = (CASE WHEN p_kind = 'lost' THEN 'lost' ELSE 'withdrawn' END)::public.station_status,
             removed_at = CASE WHEN p_kind = 'withdrawn' THEN now() END,
             updated_at = now()
       WHERE s.id = ANY (v_ids);
    ELSE
      v_effects := '{}'::jsonb;
    END IF;
  END IF;

  INSERT INTO station_works (id, visit_id, kind, station_type, station_nos, detail, effects, created_by)
  VALUES (coalesce(p_work_id, gen_random_uuid()), p_visit_id, p_kind, p_station_type, v_nos,
          nullif(btrim(p_detail), ''), v_effects, auth.uid());
END;
$$;

-- แก้รายละเอียดของงานเดิม (ไม่แตะผลกับสถานี)
CREATE FUNCTION public.service_work_set_detail(p_work_id uuid, p_detail text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit uuid;
BEGIN
  SELECT sw.visit_id INTO v_visit FROM station_works sw WHERE sw.id = p_work_id;
  PERFORM service_work_gate(v_visit);
  UPDATE station_works sw SET detail = nullif(btrim(p_detail), '')
   WHERE sw.id = p_work_id AND sw.detail IS DISTINCT FROM nullif(btrim(p_detail), '');
END;
$$;

-- ย้อนผลงาน 1 รายการแล้วลบ (ใช้ร่วมกันระหว่างแก้และลบการเข้า)
CREATE FUNCTION public.service_work_undo(p_work_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w          record;
  v_ids      uuid[];
  v_prev     jsonb;
  v_contract uuid;
BEGIN
  -- ด่านก่อนค้นหา (ไม่ให้ใช้ลองว่ามี id อยู่จริงไหม)
  IF coalesce(current_setting('aga.service_visit', true), '') = '' THEN
    RAISE EXCEPTION 'service works can only be changed through save_service_visit / delete_service_visit'
      USING ERRCODE = '42501';
  END IF;
  SELECT sw.id, sw.visit_id, sw.kind, sw.effects INTO w FROM station_works sw WHERE sw.id = p_work_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_contract := service_work_gate(w.visit_id);

  IF w.kind = 'added' THEN
    v_ids := ARRAY(SELECT jsonb_array_elements_text(coalesce(w.effects -> 'created', '[]'))::uuid);
  ELSIF w.kind IN ('lost', 'withdrawn') THEN
    v_prev := coalesce(w.effects -> 'prev', '{}');
    v_ids  := ARRAY(SELECT k::uuid FROM jsonb_object_keys(v_prev) k);
  ELSE
    v_ids := '{}';
  END IF;

  -- การเข้าครั้งอื่นใช้สถานีนี้แล้ว (มีผลตรวจ หรือมีงานซ่อมอื่นอ้างถึง) → ย้อนไม่ได้
  IF EXISTS (SELECT 1 FROM station_checks sc
              WHERE sc.station_id = ANY (v_ids) AND sc.visit_id <> w.visit_id)
     OR EXISTS (SELECT 1 FROM station_works o
                 WHERE o.id <> w.id AND o.visit_id <> w.visit_id
                   AND (o.effects -> 'created' ?| v_ids::text[] OR o.effects -> 'prev' ?| v_ids::text[])) THEN
    RAISE EXCEPTION 'another visit already uses these stations' USING ERRCODE = 'SV005';
  END IF;

  IF w.kind = 'added' THEN
    DELETE FROM station_checks sc WHERE sc.station_id = ANY (v_ids) AND sc.visit_id = w.visit_id;
    DELETE FROM stations s WHERE s.id = ANY (v_ids) AND s.contract_id = v_contract;
  ELSIF w.kind IN ('lost', 'withdrawn') THEN
    UPDATE stations s
       SET status     = (v_prev ->> s.id::text)::public.station_status,
           removed_at = NULL,
           updated_at = now()
     WHERE s.id = ANY (v_ids) AND s.contract_id = v_contract;
  END IF;

  DELETE FROM station_works sw WHERE sw.id = w.id;
END;
$$;

-- =====================================================================
-- 4. บันทึกทั้งฟอร์ม
-- =====================================================================
CREATE FUNCTION public.save_service_visit(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_visit_id    uuid := nullif(p ->> 'visit_id', '')::uuid;
  v_contract    uuid := nullif(p ->> 'contract_id', '')::uuid;
  v_visit_date  date := nullif(p ->> 'visit_date', '')::date;
  v_skip_ag     boolean := coalesce((p ->> 'skip_all_ag')::boolean, false);
  v_existing    uuid;
  v_is_edit     boolean;
  v_initialized timestamptz;
  v_team_ids    uuid[];
  v_ids         uuid[];
  v_prev        jsonb;
  v_effects     jsonb;
  v_missing     int;
  v_created     uuid[];
  v_checks      jsonb := coalesce(p -> 'checks', '[]'::jsonb);
  c             record;
  w             record;
BEGIN
  IF v_visit_id IS NULL OR v_contract IS NULL OR v_visit_date IS NULL
     OR NOT (p ? 'visit_type' AND p ? 'start_time' AND p ? 'end_time') THEN
    RAISE EXCEPTION 'visit_id, contract_id, visit_date, visit_type, start_time and end_time are required'
      USING ERRCODE = '22004';
  END IF;

  -- เพดานขนาดรายการ (กัน payload ใหญ่ผิดปกติ)
  IF jsonb_array_length(coalesce(p -> 'works', '[]')) > 200
     OR jsonb_array_length(coalesce(p -> 'checks', '[]')) > 2000
     OR jsonb_array_length(coalesce(p -> 'station_labels', '[]')) > 2000
     OR jsonb_array_length(coalesce(p -> 'station_statuses', '[]')) > 2000
     OR jsonb_array_length(coalesce(p -> 'team_ids', '[]')) > 20 THEN
    RAISE EXCEPTION 'too many items in one save' USING ERRCODE = '22023';
  END IF;

  -- ตำแหน่งก่อน (ไม่ให้คนที่ไม่มีสิทธิ์ถือ lock หรือใช้ลองว่ามี id อยู่จริงไหม)
  IF NOT (is_host() OR current_app_role() = 'recorder') THEN
    RAISE EXCEPTION 'not allowed to record service' USING ERRCODE = '42501';
  END IF;

  -- ล็อกต่อสัญญา (บันทึกลูกค้ารายเดียวกันพร้อมกันเข้าทีละคน → เลข F ไม่ค้างผิด)
  PERFORM pg_advisory_xact_lock(hashtextextended('public.save_service_visit:' || v_contract::text, 0));

  -- ---------- สัญญา + สิทธิ์ ----------
  SELECT ct.stations_initialized_at INTO v_initialized FROM contracts ct WHERE ct.id = v_contract;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;
  IF NOT (is_host() OR (current_app_role() = 'recorder' AND contract_in_scope(v_contract))) THEN
    RAISE EXCEPTION 'not allowed to record service for this contract' USING ERRCODE = '42501';
  END IF;
  IF v_initialized IS NULL THEN
    RAISE EXCEPTION 'stations of this contract are not set up yet' USING ERRCODE = 'SV003';
  END IF;

  -- เปิดทางให้ฟังก์ชันภายในของการเข้านี้ (transaction-local · ปิดตอนจบฟังก์ชัน)
  PERFORM set_config('aga.service_visit', v_visit_id::text, true);

  -- ---------- ทีม: ≥ 1 · A–O หรือ Z ----------
  v_team_ids := ARRAY(SELECT DISTINCT x::uuid
                        FROM jsonb_array_elements_text(coalesce(p -> 'team_ids', '[]')) x);
  IF cardinality(v_team_ids) = 0
     OR EXISTS (SELECT 1 FROM unnest(v_team_ids) t LEFT JOIN teams tm ON tm.id = t
                 WHERE tm.id IS NULL OR NOT (tm.code ~ '^[A-O]$' OR tm.code = 'Z')) THEN
    RAISE EXCEPTION 'choose at least one team from A-O or Z' USING ERRCODE = 'SV006';
  END IF;

  -- ---------- การเข้า (สร้าง / แก้) ----------
  SELECT vi.contract_id INTO v_existing FROM visits vi WHERE vi.id = v_visit_id;
  v_is_edit := FOUND;
  IF v_is_edit AND v_existing <> v_contract THEN
    RAISE EXCEPTION 'this visit belongs to another contract' USING ERRCODE = '22023';
  END IF;

  IF v_is_edit THEN
    UPDATE visits vi SET
      visit_date          = v_visit_date,
      visit_type          = (p ->> 'visit_type')::public.visit_type,
      start_time          = (p ->> 'start_time')::time,
      end_time            = (p ->> 'end_time')::time,
      internal_inspection = CASE WHEN p ? 'internal_inspection' THEN (p ->> 'internal_inspection')::boolean
                                 ELSE vi.internal_inspection END,
      signed_by_proxy     = CASE WHEN p ? 'signed_by_proxy' THEN (p ->> 'signed_by_proxy')::boolean
                                 ELSE vi.signed_by_proxy END,
      note                = CASE WHEN p ? 'note' THEN nullif(btrim(p ->> 'note'), '') ELSE vi.note END
    WHERE vi.id = v_visit_id
      AND (vi.visit_date, vi.visit_type, vi.start_time, vi.end_time, vi.internal_inspection,
           vi.signed_by_proxy, vi.note)
          IS DISTINCT FROM
          (v_visit_date, (p ->> 'visit_type')::public.visit_type, (p ->> 'start_time')::time,
           (p ->> 'end_time')::time,
           CASE WHEN p ? 'internal_inspection' THEN (p ->> 'internal_inspection')::boolean
                ELSE vi.internal_inspection END,
           CASE WHEN p ? 'signed_by_proxy' THEN (p ->> 'signed_by_proxy')::boolean
                ELSE vi.signed_by_proxy END,
           CASE WHEN p ? 'note' THEN nullif(btrim(p ->> 'note'), '') ELSE vi.note END);
  ELSE
    INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time,
                        internal_inspection, signed_by_proxy, note)
    VALUES (v_visit_id, v_contract, v_visit_date, (p ->> 'visit_type')::public.visit_type,
            (p ->> 'start_time')::time, (p ->> 'end_time')::time,
            (p ->> 'internal_inspection')::boolean, (p ->> 'signed_by_proxy')::boolean,
            nullif(btrim(p ->> 'note'), ''));
  END IF;

  -- ---------- ทีม: ลบที่หาย · เพิ่มที่ใหม่ ----------
  DELETE FROM visit_teams vt WHERE vt.visit_id = v_visit_id AND NOT (vt.team_id = ANY (v_team_ids));
  INSERT INTO visit_teams (visit_id, team_id)
  SELECT v_visit_id, t FROM unnest(v_team_ids) t
  ON CONFLICT DO NOTHING;

  -- ---------- งานซ่อม: ที่หาย/เปลี่ยน → ย้อนผล (ก่อนแตะผลตรวจ เพื่อให้สถานีที่ฝังใหม่ถูกลบได้) ----------
  FOR w IN
    SELECT sw.id FROM station_works sw
     WHERE sw.visit_id = v_visit_id
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_to_recordset(coalesce(p -> 'works', '[]'))
                  AS x(id uuid, kind public.station_work_kind, station_type public.station_type, station_nos int[])
          WHERE x.id = sw.id AND x.kind = sw.kind AND x.station_type = sw.station_type
            AND ARRAY(SELECT DISTINCT n FROM unnest(x.station_nos) n ORDER BY n) = sw.station_nos)
  LOOP
    PERFORM service_work_undo(w.id);
  END LOOP;

  -- ---------- งานซ่อม: ใหม่ → ทำผลกับสถานี · เดิม → แก้รายละเอียดอย่างเดียว ----------
  FOR w IN
    SELECT x.id, x.kind, x.station_type, x.station_nos, x.detail, (sw.id IS NOT NULL) AS existing
      FROM jsonb_to_recordset(coalesce(p -> 'works', '[]'))
           AS x(id uuid, kind public.station_work_kind, station_type public.station_type,
                station_nos int[], detail text)
      LEFT JOIN station_works sw ON sw.id = x.id AND sw.visit_id = v_visit_id
  LOOP
    IF w.existing THEN
      PERFORM service_work_set_detail(w.id, w.detail);
    ELSE
      PERFORM service_work_apply(v_visit_id, w.id, w.kind, w.station_type, w.station_nos, w.detail);
    END IF;
  END LOOP;

  -- ---------- ป้ายจุด (AG · แก้ได้ทุกเดือนแม้ไม่ได้ตรวจ) ----------
  UPDATE stations s SET point_label = nullif(btrim(x.point_label), ''), updated_at = now()
    FROM jsonb_to_recordset(coalesce(p -> 'station_labels', '[]')) AS x(station_id uuid, point_label text)
   WHERE s.id = x.station_id AND s.contract_id = v_contract
     AND s.point_label IS DISTINCT FROM nullif(btrim(x.point_label), '');

  -- ---------- สถานะจุด AG (ติดตามต่อ / รอถอด / ถอดแล้ว) ----------
  UPDATE stations s
     SET status     = x.status,
         removed_at = CASE WHEN x.status = 'removed' THEN coalesce(s.removed_at, now()) END,
         updated_at = now()
    FROM jsonb_to_recordset(coalesce(p -> 'station_statuses', '[]'))
         AS x(station_id uuid, status public.station_status)
   WHERE s.id = x.station_id AND s.contract_id = v_contract AND s.type = 'AG'
     AND x.status IN ('active', 'pending_removal', 'removed')
     AND s.status IN ('active', 'pending_removal')   -- ไม่ปลุกกล่องที่ถอด/กำจัดแล้ว
     AND s.status IS DISTINCT FROM x.status;

  -- ---------- สถานีที่ฝังใหม่ในการเข้านี้ (S) ----------
  -- SPEC §7.5: การติดตั้ง = S · F1 คือการติดตามครั้งแรก "หลัง" ติดตั้ง → สถานีที่ฝังในการเข้านี้
  -- ไม่ต้องมี/ห้ามมีผลตรวจในการเข้าเดียวกัน และไม่นับในกันลืมกล่อง (D10)
  v_created := ARRAY(SELECT jsonb_array_elements_text(sw.effects -> 'created')::uuid
                       FROM station_works sw
                      WHERE sw.visit_id = v_visit_id AND sw.kind = 'added');

  -- ---------- ผลตรวจ ----------
  -- สถานีต้องเป็นของสัญญานี้ และใช้งานอยู่ (หรือมีผลในการเข้านี้อยู่แล้ว — แก้ผลเดิมได้)
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_checks) AS c0(station_id uuid)
              LEFT JOIN stations s ON s.id = c0.station_id AND s.contract_id = v_contract
             WHERE s.id IS NULL
                OR s.id = ANY (v_created)
                OR (s.status NOT IN ('active', 'eliminated', 'pending_removal')
                    AND NOT EXISTS (SELECT 1 FROM station_checks sc
                                     WHERE sc.visit_id = v_visit_id AND sc.station_id = s.id))) THEN
    RAISE EXCEPTION 'station does not exist or is not in use' USING ERRCODE = 'SV001';
  END IF;

  -- ข้ามทุกจุด AG = ใส่แถว "ไม่ได้ตรวจ" ให้จุดที่ยังไม่มีแถว
  IF v_skip_ag THEN
    v_checks := v_checks || coalesce((
      SELECT jsonb_agg(jsonb_build_object('station_id', s.id, 'checked', false))
        FROM stations s
       WHERE s.contract_id = v_contract AND s.type = 'AG'
         AND s.status IN ('active', 'eliminated', 'pending_removal')
         AND NOT (s.id = ANY (v_created))
         AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_checks) AS c0(station_id uuid)
                          WHERE c0.station_id = s.id)), '[]'::jsonb);
  END IF;

  -- กันลืมกล่อง (D10): กล่อง AG ที่ใช้งานทุกจุดต้องมีแถวผล
  SELECT count(*) INTO v_missing FROM stations s
   WHERE s.contract_id = v_contract AND s.type = 'AG'
     AND s.status IN ('active', 'eliminated', 'pending_removal')
     AND NOT (s.id = ANY (v_created))
     AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_checks) AS c0(station_id uuid)
                      WHERE c0.station_id = s.id);
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'every AG box needs a result or "not checked"' USING ERRCODE = 'SV004';
  END IF;

  DELETE FROM station_checks sc
   WHERE sc.visit_id = v_visit_id
     AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_checks) AS c0(station_id uuid)
                      WHERE c0.station_id = sc.station_id);

  INSERT INTO station_checks AS sc (visit_id, station_id, checked, termite_group, termite_caste,
                                    bait_added_g, bait_eaten_pct, powder_points, timber_replaced, note)
  SELECT v_visit_id, c0.station_id, coalesce(c0.checked, true), c0.termite_group, c0.termite_caste,
         c0.bait_added_g, c0.bait_eaten_pct, c0.powder_points, coalesce(c0.timber_replaced, false),
         nullif(btrim(c0.note), '')
    FROM jsonb_to_recordset(v_checks)
         AS c0(station_id uuid, checked boolean, termite_group public.termite_group,
               termite_caste public.termite_caste, bait_added_g int, bait_eaten_pct smallint,
               powder_points int, timber_replaced boolean, note text)
  ON CONFLICT (visit_id, station_id) DO UPDATE SET
    checked = EXCLUDED.checked, termite_group = EXCLUDED.termite_group,
    termite_caste = EXCLUDED.termite_caste, bait_added_g = EXCLUDED.bait_added_g,
    bait_eaten_pct = EXCLUDED.bait_eaten_pct, powder_points = EXCLUDED.powder_points,
    timber_replaced = EXCLUDED.timber_replaced, note = EXCLUDED.note
  WHERE (sc.checked, sc.termite_group, sc.termite_caste, sc.bait_added_g, sc.bait_eaten_pct,
         sc.powder_points, sc.timber_replaced, sc.note)
        IS DISTINCT FROM
        (EXCLUDED.checked, EXCLUDED.termite_group, EXCLUDED.termite_caste, EXCLUDED.bait_added_g,
         EXCLUDED.bait_eaten_pct, EXCLUDED.powder_points, EXCLUDED.timber_replaced, EXCLUDED.note);

  PERFORM set_config('aga.service_visit', '', true);
  RETURN jsonb_build_object('visit_id', v_visit_id, 'contract_id', v_contract, 'edited', v_is_edit);
END;
$$;

-- =====================================================================
-- 5. ลบการเข้าบริการ
-- =====================================================================
CREATE FUNCTION public.delete_service_visit(p_visit_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_contract uuid;
  w          record;
  v_deleted  uuid;
BEGIN
  IF NOT (is_host() OR current_app_role() = 'recorder') THEN
    RAISE EXCEPTION 'not allowed to delete this visit' USING ERRCODE = '42501';
  END IF;

  SELECT vi.contract_id INTO v_contract FROM visits vi WHERE vi.id = p_visit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'visit not found' USING ERRCODE = 'AG004';
  END IF;
  IF NOT (is_host() OR contract_in_scope(v_contract)) THEN
    RAISE EXCEPTION 'not allowed to delete this visit' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.save_service_visit:' || v_contract::text, 0));
  PERFORM set_config('aga.service_visit', p_visit_id::text, true);

  FOR w IN SELECT sw.id FROM station_works sw WHERE sw.visit_id = p_visit_id LOOP
    PERFORM service_work_undo(w.id);
  END LOOP;

  DELETE FROM visits vi WHERE vi.id = p_visit_id RETURNING vi.id INTO v_deleted;
  IF v_deleted IS NULL THEN
    RAISE EXCEPTION 'not allowed to delete this visit' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('aga.service_visit', '', true);
END;
$$;

-- =====================================================================
-- 6. สรุปวัสดุต่อการเข้า (ก1: เก็บรายสถานี รวมด้วย view)
-- =====================================================================
CREATE VIEW public.v_service_materials WITH (security_invoker = true) AS
SELECT v.id          AS visit_id,
       v.contract_id,
       v.visit_date,
       v.visit_type,
       coalesce(sum(sc.bait_added_g) FILTER (WHERE s.type IN ('IG', 'IC')), 0)::int AS bait_outside_g,
       coalesce(sum(sc.bait_added_g) FILTER (WHERE s.type = 'AG'), 0)::int          AS bait_inside_g,
       coalesce(sum(sc.powder_points), 0)::int                                       AS powder_points,
       round(coalesce(sum(sc.powder_points), 0) * 0.3, 1)                            AS powder_g,
       coalesce(sum(CASE WHEN sc.timber_replaced AND s.type = 'IG' THEN 2
                         WHEN sc.timber_replaced AND s.type = 'IC' THEN 1
                         ELSE 0 END), 0)::int                                        AS timber_pcs
  FROM public.visits v
  LEFT JOIN public.station_checks sc ON sc.visit_id = v.id
  LEFT JOIN public.stations s ON s.id = sc.station_id
 GROUP BY v.id, v.contract_id, v.visit_date, v.visit_type;

-- =====================================================================
-- 7. สิทธิ์ (ตาราง/view/function ใหม่ต้องกำหนดในไฟล์นี้ — CLAUDE.md)
-- =====================================================================
REVOKE ALL ON public.station_works FROM PUBLIC;
REVOKE ALL ON public.station_works FROM anon;
REVOKE ALL ON public.station_works FROM authenticated;
GRANT SELECT ON public.station_works TO authenticated;          -- เขียนผ่าน RPC เท่านั้น
GRANT SELECT, INSERT, UPDATE, DELETE ON public.station_works TO service_role;

REVOKE ALL ON public.v_service_materials FROM PUBLIC;
REVOKE ALL ON public.v_service_materials FROM anon;
GRANT SELECT ON public.v_service_materials TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.int_array_is_unique(int[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.int_array_is_unique(int[]) TO authenticated, service_role;

-- ฟังก์ชันภายใน: RPC (SECURITY INVOKER) เรียกในนามผู้ใช้ จึงต้องมี EXECUTE แต่ทำงานได้เฉพาะเมื่อถูกเรียก
-- จากใน RPC ของการเข้าเดียวกัน (ด่าน aga.service_visit) — เรียกตรงผ่าน /rpc ได้ 42501
REVOKE ALL ON FUNCTION public.service_work_gate(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.service_work_apply(uuid, uuid, public.station_work_kind, public.station_type, int[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.service_work_set_detail(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.service_work_undo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_work_gate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_work_apply(uuid, uuid, public.station_work_kind, public.station_type, int[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_work_set_detail(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_work_undo(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.save_service_visit(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_service_visit(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_service_visit(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_service_visit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_service_visit(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_service_visit(uuid) TO authenticated;
