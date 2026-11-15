-- M22: ประเภททีม · ลบทีมอย่างปลอดภัย · จัดเรียงประเภทลูกค้า
-- (mockup ตั้งค่า FINAL `990b50b` · เจ้าของอนุมัติ 15 พ.ย. 2026 — DECISIONS M22 · SPEC v1.9 §8.1)
--
-- Logic summary:
--   1. `teams.kind` = ประเภททีม: 'service' (ทีมบริการ) · 'install' (ทีมติดตั้ง) · 'supervisor' (ทีมหัวหน้างาน)
--      - backfill: A–O → service · Z → install (ทีมปกติ ไม่ใช่ทีมระบบอีกต่อไป) · Sup → supervisor
--      - เติมแล้วยังมีแถวที่ไม่รู้ประเภท (ข้อมูลบน cloud ที่ไม่ใช่ A–O/Z/Sup) → migration หยุด (ไม่เดาให้)
--      - NOT NULL ไม่มีค่า default: เพิ่มทีมใหม่จากหน้าตั้งค่าต้องเลือกประเภทเสมอ
--      - ใช้ text + CHECK (ไม่ใช่ enum) → เพิ่มประเภทภายหลังได้ด้วย migration ธรรมดา
--      - ชื่อทีม Z ที่ยังเป็นค่าเริ่มต้นเดิม 'ทีม Z (ติดตั้งงานใหม่)' → 'ทีม Z (ติดตั้ง)' (mockup FINAL)
--   2. `teams.is_system` = ทีมระบบ (ตอนนี้มีทีมเดียวคือ Sup) — ลบไม่ได้ · เปลี่ยนรหัส/ประเภท/สาขาไม่ได้
--      (แก้ชื่อได้) · ตั้งทีมอื่นเป็นทีมระบบผ่าน API ไม่ได้ → trigger `teams_system_guard` (TM002)
--      - ด่านทำงานกับผู้เรียกผ่าน API (authenticated) · migration / service_role ไม่ติด (แบบเดียวกับด่าน M15)
--   3. `save_service_visit`: ด่านทีม (SV006) เช็กจาก `kind IN ('service','install')` แทนรหัส `^[A-O]$` / `Z`
--      → ทีมใหม่ที่เพิ่มจากหน้าตั้งค่า (เช่น P) บันทึกบริการได้ · ทีมหัวหน้างานยังถูกปฏิเสธเหมือน Sup เดิม
--      - เนื้อฟังก์ชันคัดลอกจาก **20261112180000** (นิยามล่าสุด — 190000/200000/M18 ไม่ได้แทนที่) แก้เฉพาะบล็อก SV006
--      - ฟังก์ชันอื่นไม่มีการเช็กรหัสทีม จึงไม่แทนที่: `delete_service_visit` / `service_ag_removal_restore`
--        (ล่าสุด 20261112180000) · ด่าน visits ทั้งหมด · `save_makeup_service_visit` (M18 เรียก save_service_visit
--        จึงได้ด่านใหม่ไปเอง) · `visits_makeup_link_guard` (ไม่แตะทีม)
--   4. `delete_team(p_team_id)` — host เท่านั้น (ตรง RLS `teams_host_write`) · SECURITY INVOKER
--      - ทีมที่ยังมีงานผูก (contract_teams / visit_teams / visits.team_id / profiles.team_id) → TM001 ข้อความไทย
--        + DETAIL เป็น JSON จำนวนที่ผูก · FK เดิม (RESTRICT) เป็นตาข่ายชั้นสุดท้าย — ไม่มี ON DELETE CASCADE
--      - ทีมระบบ → TM002 · ไม่พบทีม → AG004 · ไม่ใช่ host → 42501
--   5. `reorder_customer_types(p_codes text[])` — host เท่านั้น · ส่ง "รหัสทุกตัวตามลำดับใหม่" ทั้งชุดในครั้งเดียว
--      - sort_order เป็น UNIQUE แบบไม่ deferrable (Postgres ตรวจทีละแถว) → สลับ 2 ขั้นใน transaction เดียว:
--        ตั้งเป็นค่าติดลบ (−ลำดับใหม่) ก่อน แล้วค่อยกลับเป็นบวก → ไม่ชนกันระหว่างทาง
--      - ล็อกตาราง (SHARE ROW EXCLUSIVE: อ่านได้ เขียนพร้อมกันไม่ได้) แล้วตรวจว่ารายการครบทุกรหัส ไม่ซ้ำ ไม่มีรหัสแปลก
--        → ไม่ตรง = CT001 (ข้อความไทย) ไม่แก้อะไรเลย
--   * error ใหม่: TM001 (ทีมมีงานผูก) · TM002 (ทีมระบบ) · CT001 (รายการจัดเรียงไม่ตรงกับข้อมูลปัจจุบัน)
--     ข้อความ MESSAGE เป็นภาษาไทยแสดงผู้ใช้ได้ตรง · SV006 ความหมายเดิม (ข้อความเปลี่ยนเป็นภาษาประเภททีม)

-- =====================================================================
-- 1. teams.kind + teams.is_system
-- =====================================================================
ALTER TABLE public.teams ADD COLUMN kind text;
ALTER TABLE public.teams ADD COLUMN is_system boolean NOT NULL DEFAULT false;

UPDATE public.teams SET kind = CASE
    WHEN code ~ '^[A-O]$' THEN 'service'
    WHEN code = 'Z'       THEN 'install'
    WHEN code = 'Sup'     THEN 'supervisor'
  END
 WHERE kind IS NULL;
UPDATE public.teams SET is_system = true WHERE code = 'Sup' AND branch_id IS NULL;
UPDATE public.teams SET name = 'ทีม Z (ติดตั้ง)'
 WHERE code = 'Z' AND branch_id IS NULL AND name = 'ทีม Z (ติดตั้งงานใหม่)';

DO $$
DECLARE
  v_unknown text;
BEGIN
  SELECT string_agg(code, ', ' ORDER BY code) INTO v_unknown FROM public.teams WHERE kind IS NULL;
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'M22: teams with an unknown kind (set teams.kind by hand before this migration): %', v_unknown;
  END IF;
END;
$$;

ALTER TABLE public.teams ALTER COLUMN kind SET NOT NULL;
ALTER TABLE public.teams ADD CONSTRAINT teams_kind_check CHECK (kind IN ('service', 'install', 'supervisor'));

COMMENT ON COLUMN public.teams.kind IS
  'ประเภททีม: service = ทีมบริการ · install = ทีมติดตั้ง · supervisor = ทีมหัวหน้างาน (M22) — save_service_visit รับเฉพาะ service/install';
COMMENT ON COLUMN public.teams.is_system IS
  'ทีมระบบ (ตอนนี้มีเฉพาะ Sup) — ลบ/เปลี่ยนรหัส/ประเภท/สาขาไม่ได้ (trigger teams_system_guard · M22)';

-- =====================================================================
-- 2. ด่านทีมระบบ
-- =====================================================================
CREATE FUNCTION public.teams_system_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- ระบบ (migration / service_role / ฟังก์ชัน SECURITY DEFINER) ผ่าน · ตรวจเฉพาะผู้เรียกผ่าน API
  IF current_user <> 'authenticated' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'ทีม % เป็นทีมระบบ ลบไม่ได้', OLD.code USING ERRCODE = 'TM002';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_system THEN
      RAISE EXCEPTION 'ตั้งทีมระบบจากหน้าจอไม่ได้' USING ERRCODE = 'TM002';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.is_system IS DISTINCT FROM OLD.is_system THEN
    RAISE EXCEPTION 'เปลี่ยนสถานะทีมระบบจากหน้าจอไม่ได้' USING ERRCODE = 'TM002';
  END IF;
  IF OLD.is_system AND (NEW.code, NEW.kind, NEW.branch_id) IS DISTINCT FROM (OLD.code, OLD.kind, OLD.branch_id) THEN
    RAISE EXCEPTION 'ทีม % เป็นทีมระบบ เปลี่ยนรหัส ประเภท หรือสาขาไม่ได้ (แก้ชื่อได้)', OLD.code USING ERRCODE = 'TM002';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER teams_system_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.teams_system_guard();

-- =====================================================================
-- 3. save_service_visit (เนื้อเดิมจาก 20261112180000 — แก้เฉพาะบล็อกทีม SV006 · ป้าย "M22")
-- =====================================================================
CREATE OR REPLACE FUNCTION public.save_service_visit(p jsonb)
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
  v_removing    uuid[];
  v_unremoving  uuid[];
  v_checks      jsonb := coalesce(p -> 'checks', '[]'::jsonb);
  c             record;
  w             record;
  v_work_id     uuid;
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

  -- M15: สถานีเดียวกันซ้ำในรายการเดียว → 22023 (เทียบเป็น uuid กันตัวพิมพ์เล็ก/ใหญ่ต่างกัน)
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p -> 'station_statuses', '[]')) e
              GROUP BY (e ->> 'station_id')::uuid HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p -> 'station_labels', '[]')) e
                 GROUP BY (e ->> 'station_id')::uuid HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p -> 'checks', '[]')) e
                 GROUP BY (e ->> 'station_id')::uuid HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'the same station appears more than once in one list' USING ERRCODE = '22023';
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

  -- ---------- ทีม: ≥ 1 · ประเภททีมบริการ (service) หรือทีมติดตั้ง (install) — M22: เช็กจาก kind ไม่ใช่รหัส ----------
  v_team_ids := ARRAY(SELECT DISTINCT x::uuid
                        FROM jsonb_array_elements_text(coalesce(p -> 'team_ids', '[]')) x);
  IF cardinality(v_team_ids) = 0
     OR EXISTS (SELECT 1 FROM unnest(v_team_ids) t LEFT JOIN teams tm ON tm.id = t
                 WHERE tm.id IS NULL OR tm.kind NOT IN ('service', 'install')) THEN
    RAISE EXCEPTION 'choose at least one service or install team' USING ERRCODE = 'SV006';
  END IF;

  -- ---------- การเข้า (สร้าง / แก้) ----------
  SELECT vi.contract_id INTO v_existing FROM visits vi WHERE vi.id = v_visit_id;
  v_is_edit := FOUND;
  IF v_is_edit AND v_existing <> v_contract THEN
    RAISE EXCEPTION 'this visit belongs to another contract' USING ERRCODE = '22023';
  END IF;

  -- M15 (2.25 ข / X9): เอาติ๊กถอดออก → ตรวจด่านด้วยวันที่ "ก่อนแก้" (ก่อน UPDATE visits ข้างล่าง)
  -- ตอนคืนกล่องจริงตรวจซ้ำด้วยวันที่ "หลังแก้" → เลื่อนวันที่พร้อมเอาติ๊กออกในครั้งเดียวก็เลี่ยงไม่ได้
  IF v_is_edit THEN
    PERFORM service_ag_removal_guard(v_visit_id, ARRAY(
      SELECT DISTINCT s.id
        FROM jsonb_to_recordset(coalesce(p -> 'station_statuses', '[]'))
             AS x(station_id uuid, status public.station_status)
        JOIN stations s ON s.id = x.station_id
        JOIN station_ag_removals ar ON ar.station_id = s.id AND ar.visit_id = v_visit_id
       WHERE x.status IN ('active', 'pending_removal')
         AND s.contract_id = v_contract AND s.type = 'AG' AND s.status = 'removed'));
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
     ORDER BY (sw.kind = 'added') DESC, sw.created_at DESC, sw.id   -- M13: ย้อนกลับด้านของลำดับ apply
  LOOP
    BEGIN
      PERFORM service_work_undo(w.id);
    EXCEPTION WHEN unique_violation THEN
      -- คืนสถานีเดิมแล้วชนเลขที่ฝังใหม่ (DECISIONS 2.20) ซึ่งยังอยู่ในการเข้านี้ → บอกเป็นภาษาของระบบ
      RAISE EXCEPTION 'restoring this station clashes with a station number now in use' USING ERRCODE = 'SV002';
    END;
  END LOOP;

  -- ---------- งานซ่อม: ใหม่ → ทำผลกับสถานี · เดิม → แก้รายละเอียดอย่างเดียว ----------
  FOR w IN
    SELECT x.id, x.kind, x.station_type, x.station_nos, x.detail, x.installs,
           (sw.id IS NOT NULL) AS existing
      FROM jsonb_to_recordset(coalesce(p -> 'works', '[]'))
           AS x(id uuid, kind public.station_work_kind, station_type public.station_type,
                station_nos int[], detail text, installs jsonb)
      LEFT JOIN station_works sw ON sw.id = x.id AND sw.visit_id = v_visit_id
     ORDER BY (x.kind = 'added')   -- M13: คืนเลข (หาย/ถอน) ก่อน แล้วค่อยฝังใหม่ — ใช้เลขเดิมได้ (DECISIONS 2.20)
  LOOP
    v_work_id := coalesce(w.id, gen_random_uuid());
    IF w.existing THEN
      PERFORM service_work_set_detail(v_work_id, w.detail);
    ELSE
      PERFORM service_work_apply(v_visit_id, v_work_id, w.kind, w.station_type, w.station_nos, w.detail);
    END IF;
    -- M13: เหยื่อ + ป้ายจุดของกล่อง AG ที่ติดใหม่ (ข้อมูลติดตั้ง ไม่ใช่รอบตรวจ)
    PERFORM service_work_set_installs(v_work_id, w.installs);
  END LOOP;

  -- ---------- M14: เอาติ๊กถอดออก (แก้การเข้าเดิม) → คืนค่าก่อนถอด ----------
  -- เฉพาะกล่องที่ "การเข้านี้" เป็นคนถอด (มีแถวใน station_ag_removals ของ visit นี้) และ payload สั่งกลับมา
  -- ใช้งาน/รอถอด · ทำหลังวงงานซ่อม (ย้อนงานฝังใหม่เลขเดิมก่อน) และก่อนตรวจผล → กล่องเป็นจุดใช้งานปกติของการเข้านี้
  -- (D10) · สถานะสุดท้ายตาม payload ทำงานในขั้นท้ายฟังก์ชันตามเดิม · กล่องที่ถอดในการเข้าอื่นไม่ถูกแตะ
  v_unremoving := ARRAY(
    SELECT DISTINCT s.id
      FROM jsonb_to_recordset(coalesce(p -> 'station_statuses', '[]'))
           AS x(station_id uuid, status public.station_status)
      JOIN stations s ON s.id = x.station_id
      JOIN station_ag_removals ar ON ar.station_id = s.id AND ar.visit_id = v_visit_id
     WHERE x.status IN ('active', 'pending_removal')
       AND s.contract_id = v_contract AND s.type = 'AG' AND s.status = 'removed');
  IF cardinality(v_unremoving) > 0 THEN
    PERFORM service_ag_removal_restore(v_visit_id, v_unremoving);
  END IF;

  -- ---------- ป้ายจุด (AG · แก้ได้ทุกเดือนแม้ไม่ได้ตรวจ) ----------
  UPDATE stations s SET point_label = nullif(btrim(x.point_label), ''), updated_at = now()
    FROM jsonb_to_recordset(coalesce(p -> 'station_labels', '[]')) AS x(station_id uuid, point_label text)
   WHERE s.id = x.station_id AND s.contract_id = v_contract
     AND s.point_label IS DISTINCT FROM nullif(btrim(x.point_label), '');

  -- M13 (บั๊ก SV001): จุด AG ที่ payload สั่ง "ถอดแล้ว" ในการเข้านี้ — ตรวจผลตามสถานะเดิมก่อน
  -- แล้วค่อยเปลี่ยนสถานะท้ายฟังก์ชัน (ถอดกล่อง = ผลตรวจครั้งสุดท้ายของจุดนั้น · mockup FINAL)
  -- จุดที่กำลังถอดไม่บังคับต้องมีแถวผล (D10) และไม่เติมแถว "ไม่ได้ตรวจ" ให้ (เหมือนเดิมก่อนแก้)
  v_removing := ARRAY(
    SELECT s.id
      FROM jsonb_to_recordset(coalesce(p -> 'station_statuses', '[]'))
           AS x(station_id uuid, status public.station_status)
      JOIN stations s ON s.id = x.station_id
     WHERE x.status = 'removed' AND s.contract_id = v_contract AND s.type = 'AG'
       AND s.status IN ('active', 'pending_removal'));

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
         AND NOT (s.id = ANY (v_removing))
         AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_checks) AS c0(station_id uuid)
                          WHERE c0.station_id = s.id)), '[]'::jsonb);
  END IF;

  -- กันลืมกล่อง (D10): กล่อง AG ที่ใช้งานทุกจุดต้องมีแถวผล
  SELECT count(*) INTO v_missing FROM stations s
   WHERE s.contract_id = v_contract AND s.type = 'AG'
     AND s.status IN ('active', 'eliminated', 'pending_removal')
     AND NOT (s.id = ANY (v_created))
     AND NOT (s.id = ANY (v_removing))
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

  -- ---------- M14: จำค่าก่อนถอดของจุดที่การเข้านี้กำลังถอด (ก่อน UPDATE สถานะข้างล่าง) ----------
  IF cardinality(v_removing) > 0 THEN
    PERFORM service_ag_removal_capture(v_visit_id, v_removing);
  END IF;

  -- ---------- สถานะจุด AG (ติดตามต่อ / รอถอด / ถอดแล้ว) — หลังบันทึกผลตรวจ (M13 บั๊ก SV001) ----------
  UPDATE stations s
     SET status     = x.status,
         removed_at = CASE WHEN x.status = 'removed' THEN coalesce(s.removed_at, now()) END,
         updated_at = now()
    FROM jsonb_to_recordset(coalesce(p -> 'station_statuses', '[]'))
         AS x(station_id uuid, status public.station_status)
   WHERE s.id = x.station_id AND s.contract_id = v_contract AND s.type = 'AG'
     AND x.status IN ('active', 'pending_removal', 'removed')
     AND s.status IN ('active', 'pending_removal')   -- ไม่ปลุกกล่องที่ถอด/กำจัดแล้ว (คืนของการเข้านี้ทำข้างบนแล้ว)
     AND s.status IS DISTINCT FROM x.status;

  PERFORM set_config('aga.service_visit', '', true);
  RETURN jsonb_build_object('visit_id', v_visit_id, 'contract_id', v_contract, 'edited', v_is_edit);
END;
$$;

-- =====================================================================
-- 4. ลบทีม — ได้เฉพาะทีมที่ไม่มีงานผูก (หน้าตั้งค่า · host)
--    ไม่มีการลบตามกัน (ไม่มี CASCADE) · FK เดิมเป็นตาข่ายชั้นสุดท้าย
-- =====================================================================
CREATE FUNCTION public.delete_team(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code      text;
  v_system    boolean;
  v_contracts int;
  v_visits    int;
  v_users     int;
  v_deleted   int;
BEGIN
  IF NOT is_host() THEN
    RAISE EXCEPTION 'not allowed to delete teams' USING ERRCODE = '42501';
  END IF;
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'team id is required' USING ERRCODE = '22004';
  END IF;

  -- ล็อกแถวทีม: ระหว่างนี้ไม่มีใครผูกงานใหม่เข้ามาได้ (FK ต้องใช้ key share lock ของแถวนี้)
  SELECT t.code, t.is_system INTO v_code, v_system FROM teams t WHERE t.id = p_team_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'team not found' USING ERRCODE = 'AG004';
  END IF;
  IF v_system THEN
    RAISE EXCEPTION 'ทีม % เป็นทีมระบบ ลบไม่ได้', v_code USING ERRCODE = 'TM002';
  END IF;

  SELECT count(*) INTO v_contracts FROM contract_teams ct WHERE ct.team_id = p_team_id;
  SELECT count(*) INTO v_visits FROM visits vi
   WHERE vi.team_id = p_team_id
      OR EXISTS (SELECT 1 FROM visit_teams vt WHERE vt.visit_id = vi.id AND vt.team_id = p_team_id);
  SELECT count(*) INTO v_users FROM profiles pr WHERE pr.team_id = p_team_id;

  IF v_contracts + v_visits + v_users > 0 THEN
    RAISE EXCEPTION 'ลบทีม % ไม่ได้ เพราะยังมีงานผูกอยู่ (สัญญา % · การเข้าบริการ % · ผู้ใช้ %)',
                    v_code, v_contracts, v_visits, v_users
      USING ERRCODE = 'TM001',
            DETAIL  = jsonb_build_object('contracts', v_contracts, 'visits', v_visits, 'users', v_users)::text;
  END IF;

  BEGIN
    DELETE FROM teams t WHERE t.id = p_team_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  EXCEPTION WHEN foreign_key_violation THEN
    -- มีตารางที่ผูกทีมซึ่งการนับข้างบนไม่เห็น (เช่น ตารางที่เพิ่มภายหลัง) — FK กันไว้
    RAISE EXCEPTION 'ลบทีม % ไม่ได้ เพราะยังมีงานผูกอยู่', v_code USING ERRCODE = 'TM001';
  END;
  IF v_deleted = 0 THEN
    RAISE EXCEPTION 'not allowed to delete teams' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- =====================================================================
-- 5. จัดเรียงประเภทลูกค้า — ส่งรหัสทุกตัวตามลำดับใหม่ในครั้งเดียว (หน้าตั้งค่า · host)
-- =====================================================================
CREATE FUNCTION public.reorder_customer_types(p_codes text[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total   int;
  v_updated int;
BEGIN
  IF NOT is_host() THEN
    RAISE EXCEPTION 'not allowed to reorder customer types' USING ERRCODE = '42501';
  END IF;
  IF p_codes IS NULL OR cardinality(p_codes) = 0 THEN
    RAISE EXCEPTION 'the full ordered list of customer type codes is required' USING ERRCODE = '22004';
  END IF;
  IF cardinality(p_codes) > 500 THEN
    RAISE EXCEPTION 'too many items in one save' USING ERRCODE = '22023';
  END IF;

  -- อ่านได้ตามปกติ แต่ห้ามเพิ่ม/ลบ/แก้ประเภทพร้อมกันจนจบ transaction → ตรวจรายการแล้วผลไม่เพี้ยน
  LOCK TABLE customer_types IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO v_total FROM customer_types;
  IF cardinality(p_codes) <> v_total
     OR EXISTS (SELECT 1 FROM unnest(p_codes) c WHERE c IS NULL)
     OR (SELECT count(DISTINCT c) FROM unnest(p_codes) c) <> cardinality(p_codes)
     OR EXISTS (SELECT 1 FROM unnest(p_codes) c
                 WHERE NOT EXISTS (SELECT 1 FROM customer_types ct WHERE ct.code = c)) THEN
    RAISE EXCEPTION 'รายการจัดเรียงไม่ตรงกับประเภทลูกค้าปัจจุบัน (ขาด ซ้ำ หรือมีรหัสที่ไม่มีอยู่) — โหลดหน้าใหม่แล้วลองอีกครั้ง'
      USING ERRCODE = 'CT001';
  END IF;

  -- ขั้น 1: ลำดับใหม่แบบติดลบ (ค่าเดิมเป็นบวกทั้งหมด จึงไม่ชนกันระหว่างทาง)
  UPDATE customer_types ct SET sort_order = -x.ord::int
    FROM unnest(p_codes) WITH ORDINALITY AS x(code, ord)
   WHERE ct.code = x.code;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_total THEN
    RAISE EXCEPTION 'not allowed to reorder customer types' USING ERRCODE = '42501';
  END IF;
  -- ขั้น 2: กลับเป็นบวก = 1..n ตามลำดับที่ส่งมา
  UPDATE customer_types ct SET sort_order = -ct.sort_order WHERE ct.sort_order < 0;
END;
$$;

-- =====================================================================
-- 6. สิทธิ์
-- =====================================================================
REVOKE ALL ON FUNCTION public.teams_system_guard() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.delete_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_team(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.reorder_customer_types(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_customer_types(text[]) TO authenticated;

-- แทนที่ด้วย OR REPLACE คงสิทธิ์เดิม — ย้ำอีกครั้งกันพลาด
REVOKE ALL ON FUNCTION public.save_service_visit(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_service_visit(jsonb) TO authenticated;
