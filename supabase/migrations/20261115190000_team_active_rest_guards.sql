-- M26/33 (DECISIONS M26 · M33 · 2.48 ① · L2 — เจ้าของอนุมัติ 15–16 พ.ย. 2026): เปิด/ปิดทีม + ปิดช่อง REST
--
-- ⚠ M30 (สัญญาสั้น) ต้องต่อ `save_job_opening` จากไฟล์นี้ (ไม่ใช่ 20261115180000) — signature เดิม 23 พารามิเตอร์
--   (เนื้อนี้เพิ่ม: ด่านทีมที่ "เพิ่มใหม่" (TM004/TM005) · ใส่ id สัญญาเองตอน INSERT + GUC `aga.job_opening`)
--   ส่วน `save_service_visit` ตัวล่าสุดก็อยู่ในไฟล์นี้ (ไม่ใช่ 20261115110000)
--
-- Logic summary:
--   1. M33 `teams.is_active` (ค่าเริ่มต้น true) = พักทีมชั่วคราว ไม่ลบ
--      * เปลี่ยนได้เฉพาะ host — RLS `teams_host_write` กรองอยู่แล้ว (admin/recorder PATCH ได้ 0 แถว ไม่มี error)
--        + trigger `teams_active_guard` ย้ำอีกชั้น (TM006) · หน้าจอเรียก `set_team_active()` ได้ error ชัด (TM006 ภาษาไทย)
--      * ทีมระบบ (is_system · ตอนนี้ Sup) ปิดไม่ได้ → TM002 (ตระกูลเดิม "ทีมระบบ") + CHECK `teams_system_always_active`
--        เป็นตาข่ายสุดท้ายทุก role (รวม postgres / service_role)
--      * ลง audit ผ่าน `audit_teams` (M25) ที่มีอยู่แล้ว — ไม่แตะ audit_trigger
--   2. ทีมที่ปิด เลือกให้ "งานใหม่" ไม่ได้ (TM004) — ตรวจเฉพาะทีมที่ "เพิ่ม" เทียบกับที่เก็บอยู่
--      * งานเก่าที่ผูกทีมซึ่งปิดภายหลัง แก้/บันทึกซ้ำได้ (ส่งรายการทีมเดิมครบชุด = ไม่ใช่การเพิ่ม)
--      * `save_service_visit` (เนื้อจาก 20261115110000 M22) · `save_job_opening` (เนื้อจาก 20261115180000 M28)
--        - อ่านทีมเดิมของการเข้า/สัญญา → ทีมที่เพิ่ม = รายการใหม่ − ทีมเดิม → ปิดอยู่ = TM004
--        - INSERT เฉพาะทีมที่เพิ่ม (NOT EXISTS) + ON CONFLICT DO NOTHING เดิม (กันกดพร้อมกัน)
--        - RPC อื่นที่ผูกทีม: `save_makeup_service_visit` (M18) เรียก save_service_visit → ได้ด่านไปเอง ·
--          `ig_collection_apply` (M24 เก็บ/ไม่เก็บ IG — stations.collected_team_id) แทนที่ด้วย: ทีมปิด → TM004 (ข้อ 5b)
--      * `save_job_opening` ปฏิเสธทีมหัวหน้างาน (kind = supervisor) ที่ "เพิ่มใหม่" ด้วย (TM005 · L2) — เดิมไม่เช็ก kind เลย
--        (ทีมหัวหน้างานที่ผูกอยู่แล้วจากข้อมูลเก่า บันทึกซ้ำได้) · save_service_visit คง SV006 (ตรวจทุกทีม) ตาม M22
--   3. L2: ด่าน REST ตรงที่ `contract_teams` / `visit_teams` — trigger `team_links_guard` (BEFORE INSERT / UPDATE)
--      * ผูกทีมหัวหน้างาน → TM005 · ผูกทีมที่ปิดเป็น "ลิงก์ใหม่" → TM004
--      * ลิงก์ที่มีอยู่แล้ว (คู่เดิม · เช่น upsert ซ้ำ / ON CONFLICT DO NOTHING) ไม่ถือว่าใหม่ → ผ่าน
--      * ⚠ ต่างจาก brief: **ไม่เปิดช่อง GUC ให้ RPC ข้าม** — กฎของ trigger = กฎเดียวกับ RPC ทุกข้อ (ไม่มีหัวหน้างาน ·
--        ไม่มีทีมปิดเป็นลิงก์ใหม่) จึงให้ trigger ตรวจทุกทาง (defense in depth) · ปัญหาที่ GUC จะแก้ (บันทึกซ้ำทีมเดิม)
--        แก้ด้วยกฎ "คู่เดิมไม่ใช่ลิงก์ใหม่" แทน · ถ้าเปิด GUC ให้ข้าม save_job_opening จะผูก Sup ได้ (L2 ไม่ปิด)
--      * ใช้กับผู้ใช้ที่ล็อกอิน (current_user = 'authenticated') เท่านั้น — postgres / service_role / นำเข้า ผ่าน (แบบ M12/M23)
--      * contract_teams: admin มี policy UPDATE → ตรวจ UPDATE OF contract_id, team_id ด้วย (คู่เปลี่ยน = ลิงก์ใหม่)
--        visit_teams: authenticated ไม่มีสิทธิ์ UPDATE (GRANT SELECT, INSERT, DELETE) → ใส่ UPDATE ไว้ด้วยกันพลาดในอนาคต
--      * ชื่อ trigger `team_links_guard` เรียงหลัง `contract_teams_closed_guard` (AG007 ยังชนะก่อน)
--   4. M26: INSERT สัญญาที่มี `renewed_from_contract_id` ต้องผ่าน `save_job_opening` เท่านั้น → AG015
--      * กัน admin ลบสัญญา (ที่ยังไม่มี visit) แล้ว INSERT ใหม่ผ่าน REST เพื่อชี้ลิงก์ต่อสัญญาไปที่อื่น
--      * `save_job_opening` สร้าง id สัญญาเอง (gen_random_uuid) → ตั้ง GUC `aga.job_opening` = id นั้น (is_local) ก่อน INSERT
--        แล้วล้างหลัง INSERT · trigger `contracts_renewed_rpc_only` ผ่านเมื่อ GUC = NEW.id เท่านั้น
--        (ผู้ใช้ REST เรียก set_config ไม่ได้ — PostgREST เปิดเฉพาะ schema public · แบบเดียวกับ aga.service_visit M15)
--      * current_user <> 'authenticated' (service_role นำเข้าข้อมูลเก่า / postgres / migration) ผ่าน — ตาม M28
--      * UPDATE ไม่เกี่ยว: M23 AG009 + M28 `aga.renewal_link` (link_renewal_contract) ทำงานเหมือนเดิม
--      * ⚠ ลำดับ BEFORE trigger (Postgres เรียงตามชื่อ): `contracts_renewed_rpc_only` ('rp') เรียงหลัง
--        contracts_renewal_same_customer (P0001) · contracts_renewed_from_lock (AG009) · contracts_renewed_gap_guard
--        (AG010/AG011) → INSERT ผ่าน REST ที่ผิดกฎอื่นได้ error เดิม (เทส 43 ไม่ต้องแก้) · ที่ถูกกฎอื่นหมด → AG015
--   * error ใหม่:
--       TM004 ทีมปิดใช้งาน เลือกให้งานใหม่ไม่ได้ (MESSAGE ภาษาไทย · DETAIL = รหัสทีม คั่นด้วย ,)
--       TM005 ผูกทีมหัวหน้างานกับสัญญา/การเข้าบริการไม่ได้ (MESSAGE ภาษาไทย · DETAIL = รหัสทีม)
--       TM006 เปิด/ปิดทีมได้เฉพาะ host (MESSAGE ภาษาไทย)
--       AG015 สัญญาที่ต่อจากสัญญาเก่าต้องเปิดผ่านหน้าเปิดงาน (MESSAGE อังกฤษ + HINT ภาษาไทย แบบตระกูล AG)
--     TM002 ความหมายเดิม (ทีมระบบ) + กรณีปิดทีมระบบ
--   * ⚠ ด่านทั้ง 3 (team_links_guard / teams_active_guard / contracts_renewed_rpc_only) ยกเว้นทุก current_user ที่ไม่ใช่
--     'authenticated' → function SECURITY DEFINER (เจ้าของ postgres) ในอนาคตที่เขียนตารางเหล่านี้แทนผู้ใช้ ต้องตรวจกฎเองในตัว
--   * ข้อจำกัดที่รู้ (ไม่แก้ในรอบนี้): ปิดทีม กับ ผูกงานใหม่กับทีมนั้น "พร้อมกันพอดี" อาจหลุด 1 รายการ
--     (FK ถือ KEY SHARE ไม่ชนกับ UPDATE ที่ไม่แตะ key · ใช้ FOR SHARE ใน trigger SECURITY INVOKER ไม่ได้เพราะ RLS ซ่อนแถว)
--     ผลกระทบต่ำ: ลิงก์เดิมยังใช้ได้อยู่แล้วตามกฎข้อ 2
--     · ทำนองเดียวกัน: ลบคู่ทีมเดิมที่ยังไม่ commit พร้อมกับ INSERT คู่เดิมซ้ำ → EXISTS ยังเห็นแถวเก่า ผ่าน (ได้คู่เดิมกลับมา ไม่ใช่งานใหม่)
--     · profiles.team_id ชี้ทีมที่ปิดได้ (ไม่ใช่การผูกงาน — นอกขอบเขต M33)

-- =====================================================================
-- 1. M33 teams.is_active
-- =====================================================================
ALTER TABLE public.teams ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_system_always_active CHECK (is_active OR NOT is_system);

COMMENT ON COLUMN public.teams.is_active IS
  'M33: เปิดใช้งานทีม (false = พักทีม ไม่ขึ้นให้เลือกในงานใหม่ · งานเก่ายังแสดง/แก้ได้) · host เท่านั้น · ทีมระบบปิดไม่ได้';

CREATE FUNCTION public.teams_active_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ระบบ (migration / service_role) ผ่าน · CHECK teams_system_always_active ยังกันทีมระบบให้ทุก role
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  -- ไม่ได้เปลี่ยนสถานะ (UPDATE) / สร้างทีมที่เปิดอยู่ (INSERT ค่าเริ่มต้น) → ไม่ใช่เรื่องของด่านนี้ (RLS teams_host_write ตัดสินเอง)
  IF (TG_OP = 'UPDATE' AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active)
     OR (TG_OP = 'INSERT' AND NEW.is_active) THEN
    RETURN NEW;
  END IF;
  IF NOT public.is_host() THEN
    RAISE EXCEPTION 'เปิด/ปิดทีมได้เฉพาะผู้ดูแลระบบ (host)' USING ERRCODE = 'TM006';
  END IF;
  IF NEW.is_system AND NOT NEW.is_active THEN
    RAISE EXCEPTION 'ทีม % เป็นทีมระบบ ปิดใช้งานไม่ได้', NEW.code USING ERRCODE = 'TM002';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER teams_active_guard
  BEFORE INSERT OR UPDATE OF is_active ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.teams_active_guard();

-- หน้าตั้งค่า: เปิด/ปิดทีม (host) — SECURITY INVOKER: RLS teams_host_write + trigger ด้านบน + audit_teams ทำงานตามปกติ
CREATE FUNCTION public.set_team_active(p_team_id uuid, p_active boolean)
RETURNS TABLE (team_id uuid, is_active boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_code   text;
  v_system boolean;
BEGIN
  IF NOT is_host() THEN
    RAISE EXCEPTION 'เปิด/ปิดทีมได้เฉพาะผู้ดูแลระบบ (host)' USING ERRCODE = 'TM006';
  END IF;
  IF p_team_id IS NULL OR p_active IS NULL THEN
    RAISE EXCEPTION 'team id and active flag are required' USING ERRCODE = '22004';
  END IF;
  SELECT t.code, t.is_system INTO v_code, v_system FROM teams t WHERE t.id = p_team_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'team not found' USING ERRCODE = 'AG004';
  END IF;
  IF v_system AND NOT p_active THEN
    RAISE EXCEPTION 'ทีม % เป็นทีมระบบ ปิดใช้งานไม่ได้', v_code USING ERRCODE = 'TM002';
  END IF;
  UPDATE teams t SET is_active = p_active WHERE t.id = p_team_id AND t.is_active IS DISTINCT FROM p_active;
  RETURN QUERY SELECT t.id, t.is_active FROM teams t WHERE t.id = p_team_id;
END;
$$;

-- =====================================================================
-- 2. L2 + M33: ด่านผูกทีม (REST ตรง และทุก RPC) บน contract_teams / visit_teams
-- =====================================================================
CREATE FUNCTION public.team_links_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind   text;
  v_active boolean;
  v_code   text;
  v_exists boolean;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- คู่เดิม (UPDATE ที่ไม่เปลี่ยนคู่ / INSERT ซ้ำคู่ที่มีอยู่แล้ว) = ไม่ใช่ลิงก์ใหม่ → ผ่าน
  IF TG_TABLE_NAME = 'contract_teams' THEN
    IF TG_OP = 'UPDATE' AND (NEW.contract_id, NEW.team_id) IS NOT DISTINCT FROM (OLD.contract_id, OLD.team_id) THEN
      RETURN NEW;
    END IF;
    SELECT EXISTS (SELECT 1 FROM public.contract_teams ct
                    WHERE ct.contract_id = NEW.contract_id AND ct.team_id = NEW.team_id) INTO v_exists;
  ELSE
    IF TG_OP = 'UPDATE' AND (NEW.visit_id, NEW.team_id) IS NOT DISTINCT FROM (OLD.visit_id, OLD.team_id) THEN
      RETURN NEW;
    END IF;
    SELECT EXISTS (SELECT 1 FROM public.visit_teams vt
                    WHERE vt.visit_id = NEW.visit_id AND vt.team_id = NEW.team_id) INTO v_exists;
  END IF;
  IF v_exists THEN
    RETURN NEW;
  END IF;

  SELECT t.kind, t.is_active, t.code INTO v_kind, v_active, v_code FROM public.teams t WHERE t.id = NEW.team_id;
  IF NOT FOUND THEN
    RETURN NEW;   -- ไม่มีทีมนี้ → FK (23503) ปฏิเสธเอง
  END IF;
  IF v_kind = 'supervisor' THEN
    RAISE EXCEPTION 'ทีม % เป็นทีมหัวหน้างาน ผูกกับสัญญาหรือการเข้าบริการไม่ได้', v_code
      USING ERRCODE = 'TM005', DETAIL = v_code;
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'ทีม % ปิดใช้งานอยู่ เลือกให้งานใหม่ไม่ได้', v_code
      USING ERRCODE = 'TM004', DETAIL = v_code;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER team_links_guard
  BEFORE INSERT OR UPDATE OF contract_id, team_id ON public.contract_teams
  FOR EACH ROW EXECUTE FUNCTION public.team_links_guard();
CREATE TRIGGER team_links_guard
  BEFORE INSERT OR UPDATE OF visit_id, team_id ON public.visit_teams
  FOR EACH ROW EXECUTE FUNCTION public.team_links_guard();

-- =====================================================================
-- 3. M26: INSERT สัญญาที่ผูกสัญญาเก่า ต้องผ่าน save_job_opening (GUC aga.job_opening = id สัญญาใหม่)
-- =====================================================================
CREATE FUNCTION public.contracts_renewed_rpc_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND NEW.renewed_from_contract_id IS NOT NULL
     AND coalesce(current_setting('aga.job_opening', true), '') IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'a renewal contract can only be created through save_job_opening'
      USING ERRCODE = 'AG015',
            HINT = 'สัญญาที่ต่อจากสัญญาเก่า ต้องเปิดผ่านหน้าเปิดงาน (ต่อสัญญา) เท่านั้น';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contracts_renewed_rpc_only
  BEFORE INSERT ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_renewed_rpc_only();

-- =====================================================================
-- 4. save_service_visit — เนื้อเดิม 20261115110000 (M22) · แก้เฉพาะจุดติดป้าย "M33":
--    ทีมที่เพิ่ม (เทียบ visit_teams เดิมของการเข้านี้) ต้องเปิดใช้งาน (TM004) · INSERT เฉพาะทีมที่เพิ่ม
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
  v_added       uuid[];                                     -- M33: ทีมที่เพิ่มเทียบกับที่เก็บอยู่
  v_inactive    text;                                       -- M33
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

  -- ---------- M33: ทีมที่ "เพิ่ม" (ไม่อยู่ใน visit_teams เดิมของการเข้านี้) ต้องเปิดใช้งาน ----------
  --   ส่งรายการทีมเดิมครบชุดซ้ำ = ไม่มีทีมเพิ่ม → ผ่าน แม้ทีมเดิมจะปิดไปแล้ว (แก้งานเก่าได้)
  v_added := ARRAY(SELECT t FROM unnest(v_team_ids) t
                    WHERE NOT EXISTS (SELECT 1 FROM visit_teams vt WHERE vt.visit_id = v_visit_id AND vt.team_id = t));
  SELECT string_agg(tm.code, ',' ORDER BY tm.code) INTO v_inactive
    FROM teams tm WHERE tm.id = ANY (v_added) AND NOT tm.is_active;
  IF v_inactive IS NOT NULL THEN
    RAISE EXCEPTION 'ทีม % ปิดใช้งานอยู่ เลือกให้งานใหม่ไม่ได้', v_inactive
      USING ERRCODE = 'TM004', DETAIL = v_inactive;
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
  SELECT v_visit_id, t FROM unnest(v_added) t                -- M33: เฉพาะทีมที่เพิ่ม (trigger team_links_guard ตรวจซ้ำ)
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
-- 5. save_job_opening — เนื้อเดิม 20261115180000 (M28) · signature เดิม → CREATE OR REPLACE (คงสิทธิ์) · แก้เฉพาะจุดติดป้าย "M26/33":
--    ทีมที่เพิ่ม: หัวหน้างาน (TM005) / ปิดใช้งาน (TM004) · INSERT เฉพาะทีมที่เพิ่ม · id สัญญาใหม่สร้างเอง + GUC aga.job_opening
-- =====================================================================
CREATE OR REPLACE FUNCTION public.save_job_opening(
  p_branch_id                uuid,
  p_customer_name            text,
  p_customer_type            text,
  p_contract_no              text,
  p_start_date               date,
  p_end_date                 date,
  p_term_years               integer,
  p_value_total              numeric,
  p_sale_type                public.sale_type,
  p_team_ids                 uuid[]  DEFAULT '{}',
  p_contract_id              uuid    DEFAULT NULL,
  p_customer_id              uuid    DEFAULT NULL,
  p_confirm_new_customer     boolean DEFAULT false,
  p_sale_name                text    DEFAULT NULL,
  p_am_name                  text    DEFAULT NULL,
  p_is_urgent                boolean DEFAULT false,
  p_renewed_from_contract_id uuid    DEFAULT NULL,
  p_mail_received_date       date    DEFAULT NULL,
  p_first_service_date       date    DEFAULT NULL,
  p_first_service_time       time    DEFAULT NULL,
  p_note                     text    DEFAULT NULL,
  p_expected_updated_at      timestamptz DEFAULT NULL,
  p_renew_unlinked_reason    text    DEFAULT NULL            -- M28 รอบ 2
)
RETURNS TABLE (
  contract_id            uuid,
  customer_id            uuid,
  reused_customer        boolean,
  existing_customer_type text,
  updated_at             timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_customer_id   uuid;
  v_customer_type text;
  v_old_customer  uuid;
  v_old_branch    uuid;
  v_status        public.contract_status;
  v_updated_at    timestamptz;
  v_reused        boolean := false;
  v_contract_id   uuid;
  v_key           text;
  v_matches       jsonb;
  v_team_ids      uuid[] := ARRAY(SELECT DISTINCT t FROM unnest(coalesce(p_team_ids, '{}')) t
                                   WHERE t IS NOT NULL);
  -- M28: ค่าเดิมของสัญญา (โหมดแก้) + วันที่ของสัญญาเก่าที่ผูก
  v_cur_start     date;
  v_cur_sale      public.sale_type;
  v_cur_link      uuid;
  v_o_start       date;
  v_o_end         date;
  v_o_term        integer;
  v_cur_reason    text;                                     -- M28 รอบ 2
  v_was_unlinked  boolean := false;
  v_reason        text := nullif(btrim(p_renew_unlinked_reason), '');
  v_added         uuid[];                                   -- M26/33: ทีมที่เพิ่มเทียบกับ contract_teams เดิม
  v_bad_teams     text;                                     -- M26/33
BEGIN
  -- ---------- ล้มเร็ว: admin นอกขอบเขตหน่วยงาน (RLS ปฏิเสธอยู่แล้ว นี่แค่ไม่ต้องทำงานเปล่า) ----------
  --   host ข้ามได้: policy ของ host ไม่ขึ้นกับ division_scope
  IF NOT is_host() AND NOT branch_in_scope(p_branch_id) THEN
    RAISE EXCEPTION 'branch is outside your division' USING ERRCODE = '42501';
  END IF;

  -- ---------- โหมดแก้: สัญญาต้องมีอยู่และมองเห็น · ห้ามย้ายสาขา ----------
  IF p_contract_id IS NOT NULL THEN
    SELECT c.customer_id, cu.branch_id, c.status, c.updated_at,
           c.start_date, c.sale_type, c.renewed_from_contract_id, c.renew_unlinked_reason  -- M28
      INTO v_old_customer, v_old_branch, v_status, v_updated_at,
           v_cur_start, v_cur_sale, v_cur_link, v_cur_reason
      FROM contracts c JOIN customers cu ON cu.id = c.customer_id
     WHERE c.id = p_contract_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
    END IF;
    -- สาขาของสัญญา = สาขาของลูกค้าเดิม · เปลี่ยนสาขาผ่านหน้าเปิดงานไม่ได้ (กันย้ายสัญญาข้ามสาขา)
    IF p_branch_id IS DISTINCT FROM v_old_branch THEN
      RAISE EXCEPTION 'the branch of a saved contract cannot be changed' USING ERRCODE = 'AG006';
    END IF;
    -- M12 / DECISIONS 3.11: สัญญาปิด/ยกเลิก แก้ได้เฉพาะ host (trigger contracts_closed_guard กันซ้ำอีกชั้น)
    IF v_status IN ('closed', 'cancelled') AND NOT is_host() THEN
      RAISE EXCEPTION 'a closed or cancelled contract can be edited by host only' USING ERRCODE = 'AG007';
    END IF;
    -- M12 / DECISIONS 3.12: กันเขียนทับ — ต้องส่งเวลาแก้ล่าสุดที่หน้าจอเห็นมาด้วย
    IF p_expected_updated_at IS NULL THEN
      RAISE EXCEPTION 'p_expected_updated_at is required when editing' USING ERRCODE = '22004';
    END IF;
    IF date_trunc('milliseconds', v_updated_at) IS DISTINCT FROM date_trunc('milliseconds', p_expected_updated_at) THEN
      RAISE EXCEPTION 'this contract was changed by someone else' USING ERRCODE = 'AG008';
    END IF;
  END IF;

  -- ---------- M28 / DECISIONS 2.51: Renew ต้องเริ่มไม่เกิน 2 เดือนหลังสัญญาเก่าจบ ----------
  --   ตรวจเมื่อเปิดงานใหม่ที่ผูกสัญญาเก่า หรือโหมดแก้ที่เปลี่ยนวันเริ่ม/sale_type (ลิงก์เดิม) — เปลี่ยนลิงก์ในโหมดแก้
  --   ปล่อยให้ AG009 (M23) ปฏิเสธเอง · trigger contracts_renewed_gap_guard กันซ้ำทุกทาง (รวม REST)
  IF p_renewed_from_contract_id IS NOT NULL
     AND (p_contract_id IS NULL
          OR (p_renewed_from_contract_id IS NOT DISTINCT FROM v_cur_link
              AND (p_start_date IS DISTINCT FROM v_cur_start OR p_sale_type IS DISTINCT FROM v_cur_sale))) THEN
    IF p_sale_type IS DISTINCT FROM 'renew' THEN
      RAISE EXCEPTION 'a contract linked to an old contract must have sale_type renew'
        USING ERRCODE = 'AG011',
              HINT = 'สัญญาที่ผูกกับสัญญาเก่าต้องเป็นประเภท Renew — ถ้าเป็นลูกค้าใหม่ (New) ไม่ต้องผูกสัญญาเก่า';
    END IF;
    SELECT o.start_date, o.end_date, o.term_years INTO v_o_start, v_o_end, v_o_term
      FROM contracts o WHERE o.id = p_renewed_from_contract_id;
    -- ไม่พบ (ไม่มีจริง/มองไม่เห็น) → ปล่อยให้ FK (23503) / M9 (P0001) ปฏิเสธตามเดิม
    IF FOUND AND NOT renewal_gap_ok(v_o_start, v_o_end, v_o_term, p_start_date) THEN
      IF p_start_date <= v_o_start THEN
        RAISE EXCEPTION 'a renewal must start after the old contract starts'
          USING ERRCODE = 'AG010',
                DETAIL = to_char(renewal_latest_start_month(v_o_start, v_o_end, v_o_term), 'YYYY-MM'),
                HINT = 'วันเริ่มสัญญาใหม่ต้องอยู่หลังวันเริ่มสัญญาเก่า — ตรวจวันที่ หรือเปิดเป็นลูกค้าใหม่ (New)';
      END IF;
      RAISE EXCEPTION 'a renewal must start within 2 months after the old contract ends; open it as New'
        USING ERRCODE = 'AG010',
              DETAIL = to_char(renewal_latest_start_month(v_o_start, v_o_end, v_o_term), 'YYYY-MM'),
              HINT = 'สัญญาใหม่เริ่มเกิน 2 เดือนหลังสัญญาเก่าจบ (กฎบริษัท) — ให้เปิดงานเป็นลูกค้าใหม่ (New) ไม่ผูกสัญญาเก่า';
    END IF;
  END IF;

  -- ---------- M28 รอบ 2: Renew ไม่ผูกสัญญาเก่า — ต้องมีเหตุผล (AG012) · เปิดได้ถึงวันที่กำหนด (AG013) ----------
  --   ตรวจเมื่อ "กลายเป็น" Renew ไม่ผูก (เปิดงานใหม่ / เดิมไม่ใช่) หรือแก้เหตุผลจนว่าง — แบบเดียวกับ trigger
  --   New / ผูกแล้ว → ไม่เก็บเหตุผล (NULL · CHECK contracts_renew_unlinked_reason_check)
  --   โหมดแก้ที่ล้างลิงก์เดิม (มีค่า → NULL) ไม่ตรวจที่นี่ — ปล่อยให้ AG009 (M23) ปฏิเสธก่อน
  IF p_sale_type = 'renew' AND p_renewed_from_contract_id IS NULL
     AND (p_contract_id IS NULL OR v_cur_link IS NULL) THEN
    v_was_unlinked := p_contract_id IS NOT NULL AND coalesce(v_cur_sale = 'renew' AND v_cur_link IS NULL, false);
    IF v_reason IS NULL AND (NOT v_was_unlinked OR v_cur_reason IS NOT NULL) THEN
      RAISE EXCEPTION 'a renewal without a link to the old contract needs a reason'
        USING ERRCODE = 'AG012',
              HINT = 'Renew ที่ไม่ผูกสัญญาเก่า ต้องระบุเหตุผล (เช่น สัญญาเก่าไม่อยู่ในระบบ)';
    END IF;
    IF NOT v_was_unlinked AND NOT unlinked_renew_open() THEN
      RAISE EXCEPTION 'renewals without a link to the old contract are no longer allowed'
        USING ERRCODE = 'AG013', DETAIL = to_char(allow_unlinked_renew_until(), 'YYYY-MM-DD'),
              HINT = 'เลยช่วงที่เปิด Renew แบบไม่ผูกสัญญาเก่าได้แล้ว — เลือกสัญญาเก่าที่ต่อ หรือเปิดเป็นลูกค้าใหม่ (New)';
    END IF;
  ELSE
    v_reason := NULL;
  END IF;

  -- ---------- M26/33: ทีมที่ "เพิ่ม" (เปิดงานใหม่ = ทุกทีม · โหมดแก้ = ที่ยังไม่อยู่ใน contract_teams) ----------
  --   หัวหน้างาน → TM005 (L2) · ปิดใช้งาน → TM004 (M33) · ส่งรายการทีมเดิมครบชุดซ้ำ = ไม่มีทีมเพิ่ม → ผ่าน
  --   ทีมที่ไม่มีจริง → ปล่อยให้ FK (23503) ปฏิเสธตามเดิม · trigger team_links_guard ตรวจซ้ำตอน INSERT
  v_added := ARRAY(SELECT t FROM unnest(v_team_ids) t
                    WHERE p_contract_id IS NULL
                       OR NOT EXISTS (SELECT 1 FROM contract_teams ct
                                       WHERE ct.contract_id = p_contract_id AND ct.team_id = t));
  SELECT string_agg(tm.code, ',' ORDER BY tm.code) INTO v_bad_teams
    FROM teams tm WHERE tm.id = ANY (v_added) AND tm.kind = 'supervisor';
  IF v_bad_teams IS NOT NULL THEN
    RAISE EXCEPTION 'ทีม % เป็นทีมหัวหน้างาน ผูกกับสัญญาหรือการเข้าบริการไม่ได้', v_bad_teams
      USING ERRCODE = 'TM005', DETAIL = v_bad_teams;
  END IF;
  SELECT string_agg(tm.code, ',' ORDER BY tm.code) INTO v_bad_teams
    FROM teams tm WHERE tm.id = ANY (v_added) AND NOT tm.is_active;
  IF v_bad_teams IS NOT NULL THEN
    RAISE EXCEPTION 'ทีม % ปิดใช้งานอยู่ เลือกให้งานใหม่ไม่ได้', v_bad_teams
      USING ERRCODE = 'TM004', DETAIL = v_bad_teams;
  END IF;

  -- ---------- ลูกค้า ----------
  IF p_customer_id IS NOT NULL OR p_contract_id IS NOT NULL THEN
    -- เลือกรายเดิม (หรือคงรายเดิมของสัญญาที่แก้)
    v_customer_id := coalesce(p_customer_id, v_old_customer);
    SELECT cu.customer_type INTO v_customer_type
      FROM customers cu WHERE cu.id = v_customer_id AND cu.branch_id = p_branch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'customer is not in this branch' USING ERRCODE = 'AG002';
    END IF;
    v_reused := true;
  ELSE
    v_key := customer_name_key(p_customer_name);
    IF v_key = '' THEN
      RAISE EXCEPTION 'customer name is required' USING ERRCODE = '23514';
    END IF;

    -- กันกดพร้อมกัน: ชื่อ+สาขาเดียวกันเข้าทีละรายการ (ปลดเองเมื่อจบ transaction)
    PERFORM pg_advisory_xact_lock(
      hashtextextended('public.customers:' || p_branch_id::text || ':' || v_key, 0));

    IF NOT p_confirm_new_customer THEN
      SELECT jsonb_agg(jsonb_build_object(
               'customer_id', cu.id,
               'name', cu.name,
               'customer_type', cu.customer_type,
               'latest_contract_no', (SELECT c.contract_no FROM contracts c
                                       WHERE c.customer_id = cu.id
                                       ORDER BY c.start_date DESC LIMIT 1))
             ORDER BY cu.created_at)
        INTO v_matches
        FROM customers cu
       WHERE cu.branch_id = p_branch_id AND cu.name_key = v_key;
      IF v_matches IS NOT NULL THEN
        RAISE EXCEPTION 'a customer with this name already exists in this branch'
          USING ERRCODE = 'AG001', DETAIL = v_matches::text;
      END IF;
    END IF;

    INSERT INTO customers (branch_id, name, customer_type)
    VALUES (p_branch_id, btrim(p_customer_name), nullif(btrim(p_customer_type), ''))
    RETURNING id INTO v_customer_id;
  END IF;

  -- ---------- สัญญา ----------
  IF p_contract_id IS NULL THEN
    -- M26: สร้าง id เอง แล้วเปิดด่าน contracts_renewed_rpc_only เฉพาะแถวนี้ (is_local · ล้างทันทีหลัง INSERT)
    v_contract_id := gen_random_uuid();
    PERFORM set_config('aga.job_opening', v_contract_id::text, true);
    INSERT INTO contracts (
      id, customer_id, contract_no, start_date, end_date, term_years, value_total, sale_type,
      sale_name, am_name, is_urgent, renewed_from_contract_id, mail_received_date,
      first_service_date, first_service_time, note, renew_unlinked_reason)
    VALUES (
      v_contract_id, v_customer_id, p_contract_no, p_start_date, p_end_date, p_term_years, p_value_total,
      p_sale_type, nullif(btrim(p_sale_name), ''), nullif(btrim(p_am_name), ''),
      coalesce(p_is_urgent, false), p_renewed_from_contract_id, p_mail_received_date,
      p_first_service_date, p_first_service_time, nullif(btrim(p_note), ''), v_reason)
    RETURNING id INTO v_contract_id;
    PERFORM set_config('aga.job_opening', '', true);
  ELSE
    UPDATE contracts c SET
      customer_id              = v_customer_id,
      contract_no              = p_contract_no,
      start_date               = p_start_date,
      end_date                 = p_end_date,
      term_years               = p_term_years,
      value_total              = p_value_total,
      sale_type                = p_sale_type,
      sale_name                = nullif(btrim(p_sale_name), ''),
      am_name                  = nullif(btrim(p_am_name), ''),
      is_urgent                = coalesce(p_is_urgent, false),
      renewed_from_contract_id = p_renewed_from_contract_id,
      mail_received_date       = p_mail_received_date,
      first_service_date       = p_first_service_date,
      first_service_time       = p_first_service_time,
      note                     = nullif(btrim(p_note), ''),
      renew_unlinked_reason    = v_reason
    WHERE c.id = p_contract_id
      AND date_trunc('milliseconds', c.updated_at) = date_trunc('milliseconds', p_expected_updated_at)
          -- มีคนแก้ระหว่างอ่านกับเขียน = 0 แถว
    RETURNING c.id INTO v_contract_id;
    -- 0 แถว: มีคนแก้ไปก่อน (AG008) หรือ RLS ไม่ให้แก้ (ไม่ error แค่ 0 แถว → แปลงเป็น 42501)
    IF v_contract_id IS NULL THEN
      IF (SELECT date_trunc('milliseconds', c.updated_at) FROM contracts c WHERE c.id = p_contract_id)
         IS DISTINCT FROM date_trunc('milliseconds', p_expected_updated_at) THEN
        RAISE EXCEPTION 'this contract was changed by someone else' USING ERRCODE = 'AG008';
      END IF;
      RAISE EXCEPTION 'not allowed to update this contract' USING ERRCODE = '42501';
    END IF;

    -- ทีมที่ไม่อยู่ในรายการใหม่ → ลบ
    DELETE FROM contract_teams ct
     WHERE ct.contract_id = v_contract_id AND NOT (ct.team_id = ANY (v_team_ids));
  END IF;

  -- ---------- ทีม (เพิ่มเฉพาะที่ยังไม่มี) ----------
  INSERT INTO contract_teams (contract_id, team_id)
  SELECT v_contract_id, t FROM unnest(v_added) t             -- M26/33: เฉพาะทีมที่เพิ่ม (trigger team_links_guard ตรวจซ้ำ)
  ON CONFLICT DO NOTHING;

  -- ---------- เปลี่ยนไปใช้ลูกค้ารายอื่น: ลูกค้าเดิมที่ไม่เหลือสัญญาลบทิ้ง (ไม่ปล่อย PII ค้าง) ----------
  IF v_old_customer IS NOT NULL AND v_old_customer <> v_customer_id
     AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.customer_id = v_old_customer) THEN
    DELETE FROM customers cu WHERE cu.id = v_old_customer;
  END IF;

  RETURN QUERY SELECT v_contract_id, v_customer_id, v_reused,
                      CASE WHEN v_reused THEN v_customer_type END,
                      (SELECT c.updated_at FROM contracts c WHERE c.id = v_contract_id);
END;
$$;

-- =====================================================================
-- 5b. ig_collection_apply (เก็บ/ไม่เก็บ IG หลังหมดสัญญา) — เนื้อเดิม 20261115160000 (M24) · แก้เฉพาะจุดป้าย "M33":
--     ทีมที่ปิดใช้งาน → TM004 (ผลตรวจ Opus: RPC นี้ผูกทีมผ่าน stations.collected_team_id / not_collected_team_id)
--     SECURITY DEFINER เดิม · signature เดิม → CREATE OR REPLACE คงสิทธิ์ (REVOKE จากผู้ใช้ · เรียกผ่าน wrapper เท่านั้น)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.ig_collection_apply(
  p_kind        text,      -- 'collected' | 'not_collected'
  p_contract_id uuid,
  p_count       int,
  p_on          date,
  p_team_id     uuid,
  p_reason      text,
  p_station_nos int[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today   date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_ct      record;
  v_end     date;
  v_from    date;
  v_nos     int[];
  v_ids     uuid[];
  v_need    int;
  v_reason  text := nullif(regexp_replace(p_reason, '^\s+|\s+$', '', 'g'), '');   -- ตัดช่องว่าง/tab/ขึ้นบรรทัด
  v_uid     uuid := auth.uid();
BEGIN
  IF p_kind NOT IN ('collected', 'not_collected') OR p_contract_id IS NULL THEN
    RAISE EXCEPTION 'invalid call' USING ERRCODE = '22023';
  END IF;

  -- ตำแหน่งก่อน (ไม่ให้คนที่ไม่มีสิทธิ์ถือ lock หรือใช้ลองว่ามีสัญญาอยู่จริงไหม)
  -- coalesce: ผู้ใช้ที่ไม่มีแถว profiles (role = NULL) ต้องถูกปฏิเสธที่นี่ ไม่หลุดไปถึงด่านถัดไป
  IF NOT coalesce(public.is_host() OR public.current_app_role() = 'recorder', false) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์บันทึกการเก็บสถานี' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.ig_collection:' || p_contract_id::text, 0));

  SELECT c.id, c.status, c.start_date, c.end_date, c.term_years, c.cancelled_at, c.closed_at INTO v_ct
    FROM public.contracts c WHERE c.id = p_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบสัญญา' USING ERRCODE = 'AG004';
  END IF;
  IF NOT coalesce(public.is_host()
                  OR (public.current_app_role() = 'recorder' AND public.contract_in_scope(p_contract_id)), false) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์บันทึกการเก็บสถานีของสัญญานี้' USING ERRCODE = '42501';
  END IF;

  -- สัญญาต้องจบแล้ว (วันสิ้นสุด = end_date หรือ เริ่ม + N ปี − 1 วัน · CLAUDE.md defaultEndDate)
  v_end := coalesce(v_ct.end_date, (v_ct.start_date + make_interval(years => v_ct.term_years) - interval '1 day')::date);
  IF v_ct.status = 'active' AND v_end >= v_today THEN
    RAISE EXCEPTION 'สัญญายังไม่หมด — เก็บสถานีได้หลังหมดสัญญา' USING ERRCODE = 'CL001';
  END IF;

  -- วันที่เก็บ/เข้าไป: ไม่เกินวันนี้ และไม่ก่อนวันที่สัญญาจบ (วันถัดจากวันสิ้นสุด · หรือวันยกเลิก/ปิดถ้าเร็วกว่า)
  -- กันบันทึกย้อนไปเดือนที่สัญญายังใช้งาน (ตัวเลขรายเดือนเพี้ยน)
  v_from := v_end + 1;
  IF v_ct.cancelled_at IS NOT NULL THEN
    v_from := least(v_from, (v_ct.cancelled_at AT TIME ZONE 'Asia/Bangkok')::date);
  END IF;
  IF v_ct.closed_at IS NOT NULL THEN
    v_from := least(v_from, (v_ct.closed_at AT TIME ZONE 'Asia/Bangkok')::date);
  END IF;
  v_from := greatest(v_from, v_ct.start_date);
  IF p_on IS NULL OR p_on > v_today OR p_on < v_from THEN
    RAISE EXCEPTION 'วันที่ไม่ถูกต้อง (ต้องไม่เกินวันนี้ และไม่ก่อนวันที่สัญญาจบ)' USING ERRCODE = 'CL005';
  END IF;

  IF p_team_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = p_team_id AND t.kind IN ('service', 'install')) THEN
    RAISE EXCEPTION 'เลือกทีมบริการหรือทีมติดตั้งที่เข้าไป' USING ERRCODE = 'CL003';
  END IF;
  -- M33: ทีมที่ปิดใช้งาน บันทึกการเก็บ/ไม่เก็บใหม่ไม่ได้ (การเก็บแต่ละครั้งเป็นงานใหม่เสมอ — แตะเฉพาะ IG ที่ยังค้าง)
  IF EXISTS (SELECT 1 FROM public.teams t WHERE t.id = p_team_id AND NOT t.is_active) THEN
    RAISE EXCEPTION 'ทีม % ปิดใช้งานอยู่ เลือกให้งานใหม่ไม่ได้', (SELECT t.code FROM public.teams t WHERE t.id = p_team_id)
      USING ERRCODE = 'TM004', DETAIL = (SELECT t.code FROM public.teams t WHERE t.id = p_team_id);
  END IF;

  IF p_kind = 'not_collected' AND (v_reason IS NULL OR length(v_reason) > 300) THEN
    RAISE EXCEPTION 'กรุณาพิมพ์เหตุผลที่ไม่เก็บ (ไม่เกิน 300 ตัวอักษร)' USING ERRCODE = 'CL004';
  END IF;

  IF p_station_nos IS NOT NULL THEN
    -- ระบุเลข IG เอง: ไม่ซ้ำ · ทุกเลขต้องเป็น IG ที่ค้างของสัญญานี้
    v_nos := ARRAY(SELECT DISTINCT n FROM unnest(p_station_nos) n ORDER BY n);
    IF cardinality(v_nos) = 0 OR cardinality(v_nos) <> cardinality(p_station_nos)
       OR cardinality(v_nos) > 2000 OR array_position(v_nos, NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'เลขสถานีไม่ถูกต้องหรือซ้ำ' USING ERRCODE = 'CL002';
    END IF;
    -- ส่งทั้งจำนวนและเลข → ต้องตรงกัน (ไม่ทิ้งจำนวนเงียบๆ)
    IF p_count IS NOT NULL AND p_count <> cardinality(v_nos) THEN
      RAISE EXCEPTION 'จำนวนไม่ตรงกับเลขสถานีที่ระบุ' USING ERRCODE = 'CL002';
    END IF;
    v_need := cardinality(v_nos);
    v_ids := ARRAY(
      SELECT s.id FROM public.stations s
       WHERE s.contract_id = p_contract_id AND s.type = 'IG' AND s.station_no = ANY (v_nos)
         AND s.status NOT IN ('lost', 'withdrawn')
         AND s.collected_at IS NULL AND s.not_collected_on IS NULL
       ORDER BY s.station_no, s.id
         FOR UPDATE);
  ELSE
    -- ระบุจำนวน (หน้าจอ #collect): IG ที่ค้าง เลขน้อยสุดก่อน
    IF p_count IS NULL OR p_count < 1 OR p_count > 2000 THEN
      RAISE EXCEPTION 'จำนวนสถานีไม่ถูกต้อง' USING ERRCODE = 'CL002';
    END IF;
    v_need := p_count;
    v_ids := ARRAY(
      SELECT s.id FROM public.stations s
       WHERE s.contract_id = p_contract_id AND s.type = 'IG'
         AND s.status NOT IN ('lost', 'withdrawn')
         AND s.collected_at IS NULL AND s.not_collected_on IS NULL
       ORDER BY s.station_no NULLS LAST, s.created_at, s.id
       LIMIT p_count
         FOR UPDATE);
  END IF;

  IF cardinality(v_ids) <> v_need THEN
    RAISE EXCEPTION 'จำนวนหรือเลขสถานีเกิน IG ที่ยังค้างเก็บของสัญญานี้' USING ERRCODE = 'CL002';
  END IF;

  IF p_kind = 'collected' THEN
    UPDATE public.stations s
       SET collected_at      = (p_on::timestamp AT TIME ZONE 'Asia/Bangkok'),
           collected_by      = v_uid,
           collected_team_id = p_team_id,
           updated_at        = now()
     WHERE s.id = ANY (v_ids);
  ELSE
    UPDATE public.stations s
       SET not_collected_on      = p_on,
           not_collected_reason  = v_reason,
           not_collected_by      = v_uid,
           not_collected_team_id = p_team_id,
           updated_at            = now()
     WHERE s.id = ANY (v_ids);
  END IF;

  RETURN jsonb_build_object(
    'contract_id', p_contract_id,
    'kind', p_kind,
    'count', cardinality(v_ids),
    'station_ids', to_jsonb(v_ids),
    'station_nos', to_jsonb(ARRAY(SELECT s.station_no FROM public.stations s
                                   WHERE s.id = ANY (v_ids) ORDER BY s.station_no)),
    'remaining', (SELECT count(*)::int FROM public.stations s
                   WHERE s.contract_id = p_contract_id AND s.type = 'IG'
                     AND s.status NOT IN ('lost', 'withdrawn')
                     AND s.collected_at IS NULL AND s.not_collected_on IS NULL));
END;
$$;

-- =====================================================================
-- 6. สิทธิ์
-- =====================================================================
REVOKE ALL ON FUNCTION public.teams_active_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_links_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contracts_renewed_rpc_only() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.set_team_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_team_active(uuid, boolean) TO authenticated;

-- แทนที่ด้วย OR REPLACE คงสิทธิ์เดิม — ย้ำอีกครั้งกันพลาด
REVOKE ALL ON FUNCTION public.save_service_visit(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_service_visit(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, integer, numeric, public.sale_type, uuid[], uuid, uuid,
  boolean, text, text, boolean, uuid, date, date, time, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, integer, numeric, public.sale_type, uuid[], uuid, uuid,
  boolean, text, text, boolean, uuid, date, date, time, text, timestamptz, text) TO authenticated;
