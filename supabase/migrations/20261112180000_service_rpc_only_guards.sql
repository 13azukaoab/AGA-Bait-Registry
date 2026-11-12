-- M15: ปิดช่องโหว่สิทธิ์ + กติกาลบการเข้า (เจ้าของอนุมัติ 12 พ.ย. 2026 — DECISIONS 2.24, 2.25 ข, X9 ค่าชั่วคราว)
--
-- Logic summary:
--   1. (2.24) หัวหน้างาน (recorder) เปลี่ยน `status` / `removed_at` ของสถานีที่ "ถอดแล้ว" (removed) หรือ
--      "กำจัดแล้ว" (eliminated) ตรงผ่าน REST ไม่ได้ → 42501 · trigger `stations_finished_status_guard`
--      - ทางที่ถูกต้องทุกทาง (คืนกล่องตอนลบ/แก้การเข้า M14, ย้อนงานซ่อม, Renew) ทำในฟังก์ชัน SECURITY DEFINER
--        (current_user ไม่ใช่ authenticated) จึงไม่ติดด่านนี้ · `save_service_visit` ขั้นท้ายไม่แตะกล่องที่ถอดแล้วอยู่แล้ว
--      - แก้ป้ายจุด / collected_at ของสถานีเหล่านั้นยังทำได้ตามเดิม
--      - ขอบเขต: เฉพาะ recorder ตามที่อนุมัติ · admin (policy `stations_admin_update`) และสถานะ lost/withdrawn
--        ยังเปลี่ยนตรงได้ → ส่งเป็นตัวเลือกให้หมวด 2 ตัดสิน (ไม่เดาเอง) · host คงสิทธิ์แก้ตรง (ออกแบบ M14 รองรับ)
--   2. (2.24) ลบ `visits` ตรงผ่าน REST ไม่ได้ทุกบทบาท (รวม host) → 42501 · trigger `visits_delete_rpc_only`
--      - ลบได้เฉพาะใน `delete_service_visit` (ด่าน `aga.service_visit` = id ของการเข้าที่ลบ · ผู้ใช้ตั้งค่านี้เองผ่าน
--        API ไม่ได้) → งานซ่อม/กล่อง AG ถูกย้อนครบก่อนลบทุกครั้ง
--      - เลือก trigger แทนการถอด policy: `delete_service_visit` เป็น SECURITY INVOKER ยังต้องใช้ policy ลบเดิม
--        และ host มี policy `FOR ALL` · trigger ให้ error ชัด (ไม่ใช่ "ลบได้ 0 แถว" เงียบๆ)
--      - service_role / postgres (นำเข้าข้อมูล, ระบบ) ไม่ติด · ลบสัญญาเปล่า (DECISIONS 1.5) ไม่กระทบ เพราะ
--        FK visits → contracts เป็น RESTRICT (สัญญาที่มีการเข้าลบไม่ได้อยู่แล้ว)
--      - `station_works` ผู้ใช้มีแค่สิทธิ์ SELECT อยู่แล้ว (20261112150000) ช่องเดียวที่เหลือคือ CASCADE จาก visits
--        ซึ่งปิดด้วยข้อนี้
--   3. (2.25 ข) ลบการเข้าที่ถอดกล่อง AG (หรือแก้การเข้าเพื่อเอาติ๊กถอดออก) ไม่ได้ ถ้าสัญญานั้นมี
--      **การเข้าครั้งหลัง** แล้ว → SV005 "ให้ลบ/แก้ครั้งหลังก่อน"
--      - "ครั้งหลัง" นับทั้งสัญญา ไม่ใช่ต่อกล่อง: หลังถอด กล่องนั้นไม่มีผลตรวจในการเข้าถัดไปได้ (SV001/D10 ตัดออก)
--        → เช็กต่อกล่องจะไม่เคยเจอ · ปัญหาจริงคือการเข้าครั้งหลังของสัญญาบันทึกไว้ตอนกล่องถอดแล้ว จึงไม่มีแถวผล
--        ของกล่องนั้น → คืนกล่องแล้วการเข้าครั้งหลังขาดแถว (D10 / SV004 ตอนแก้) และตกบริการ/F เดือนหลังเปลี่ยน
--      - ครั้งหลัง = วันที่เข้าหลังกว่า หรือวันเดียวกันแต่บันทึกทีหลัง (created_at) · ใช้วันที่ "ก่อนแก้" และ "หลังแก้"
--        ทั้งคู่ (ตรวจก่อน UPDATE visits และอีกครั้งตอนคืนกล่อง) → แก้วันที่พร้อมเอาติ๊กออกในครั้งเดียวก็เลี่ยงไม่ได้
--      - เช็กเฉพาะเมื่อจะคืนกล่องจริง (ยังเป็น removed และ removed_at ตรงกับที่การเข้านี้ตั้ง — กติกา M14)
--      - อยู่ใน `service_ag_removal_restore` (ทางเดียวที่คืนกล่อง) → ครอบทั้งลบและ "เอาติ๊กออกแล้วค่อยลบ"
--   4. payload ส่ง station id ซ้ำใน `station_statuses` / `station_labels` / `checks` → 22023 (เดิม: แถวค้าง / 21000)
--   5. ค่าปลอดภัยชั่วคราวระหว่างรอเจ้าของเลือก X9 (docs/plans/2026-11-12-ag-across-renew.md):
--      **สัญญาที่ถูก Renew แล้ว (มีสัญญาใหม่ `renewed_from_contract_id` ชี้มา) ลบการเข้าบริการไม่ได้** → SV010
--      ทุกบทบาท (host ด้วย) · และเอาติ๊กถอดกล่อง AG ออกในสัญญานั้นไม่ได้ (SV010) · แก้ผลอื่นของการเข้าเก่ายังทำได้
--   * error ใหม่: SV010 (สัญญา Renew แล้ว) · SV005 ใช้ซ้ำกับความหมายเดิม "การเข้าครั้งอื่น/ครั้งหลังใช้ข้อมูลนี้แล้ว"
--     ข้อความไม่บอกวันที่/id ของการเข้าอื่น
--   * `save_service_visit` / `delete_service_visit` / `service_ag_removal_restore` แทนที่ทั้งตัว (CREATE OR REPLACE ·
--     signature เดิม · สิทธิ์เดิม) เนื้อเดิมจาก 20261112170000 · เพิ่มเฉพาะจุดที่ติดป้าย "M15"
--     advisory lock ต่อสัญญา / F / ด่าน / REVOKE anon / audit_log คงเดิม

-- =====================================================================
-- 1. stations: recorder เปลี่ยนสถานะกล่องที่ถอด/กำจัดแล้วตรงไม่ได้ (2.24)
-- =====================================================================
CREATE FUNCTION public.stations_finished_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- ฟังก์ชันระบบแบบ SECURITY DEFINER (current_user = เจ้าของตาราง) ผ่าน · ตรวจเฉพาะ recorder ที่เรียกตรง
  IF current_user = 'authenticated' AND public.current_app_role() = 'recorder'
     AND OLD.status IN ('removed', 'eliminated')
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.removed_at IS DISTINCT FROM OLD.removed_at) THEN
    RAISE EXCEPTION 'the status of a removed or eliminated station is changed through save_service_visit / delete_service_visit'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stations_finished_status_guard
  BEFORE UPDATE ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.stations_finished_status_guard();

-- =====================================================================
-- 2. visits: ลบได้เฉพาะใน delete_service_visit (2.24)
-- =====================================================================
CREATE FUNCTION public.visits_delete_rpc_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND coalesce(current_setting('aga.service_visit', true), '') <> OLD.id::text THEN
    RAISE EXCEPTION 'visits can only be deleted through delete_service_visit' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER visits_delete_rpc_only
  BEFORE DELETE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.visits_delete_rpc_only();

-- =====================================================================
-- 3. ด่านก่อนคืนกล่อง AG (2.25 ข + X9 ชั่วคราว) — SECURITY DEFINER · ผ่าน service_work_gate
-- =====================================================================
-- p_station_ids = NULL → ทุกกล่องที่การเข้านี้ถอด · ไม่มีกล่องที่จะคืนจริง = ไม่ทำอะไร
CREATE FUNCTION public.service_ag_removal_guard(p_visit_id uuid, p_station_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract uuid := service_work_gate(p_visit_id);
  v_date     date;
  v_created  timestamptz;
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM station_ag_removals ar
         JOIN stations s ON s.id = ar.station_id
        WHERE ar.visit_id = p_visit_id
          AND s.contract_id = v_contract
          AND (p_station_ids IS NULL OR ar.station_id = ANY (p_station_ids))
          AND s.status = 'removed' AND s.removed_at IS NOT DISTINCT FROM ar.removed_at_set) THEN
    RETURN;
  END IF;

  -- X9 ค่าชั่วคราว: สัญญาเก่าที่ Renew แล้ว ไม่คืนกล่อง (รอเจ้าของเลือกแบบ)
  IF EXISTS (SELECT 1 FROM contracts c WHERE c.renewed_from_contract_id = v_contract) THEN
    RAISE EXCEPTION 'this contract has been renewed; its visits cannot be deleted and AG removals cannot be undone'
      USING ERRCODE = 'SV010';
  END IF;

  -- 2.25 ข: มีการเข้าครั้งหลังในสัญญานี้แล้ว
  SELECT vi.visit_date, vi.created_at INTO v_date, v_created FROM visits vi WHERE vi.id = p_visit_id;
  IF EXISTS (SELECT 1 FROM visits w
              WHERE w.contract_id = v_contract AND w.id <> p_visit_id
                AND (w.visit_date > v_date OR (w.visit_date = v_date AND w.created_at > v_created))) THEN
    RAISE EXCEPTION 'a later visit of this contract exists; delete or edit the later visit first'
      USING ERRCODE = 'SV005';
  END IF;
END;
$$;

-- =====================================================================
-- 4. service_ag_removal_restore (เนื้อเดิมจาก 20261112170000 + ด่าน M15)
-- =====================================================================
-- คืนค่าก่อนถอดของกล่องที่การเข้านี้ถอด (p_station_ids = NULL → ทุกกล่องของการเข้านี้)
CREATE OR REPLACE FUNCTION public.service_ag_removal_restore(p_visit_id uuid, p_station_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract uuid := service_work_gate(p_visit_id);
  r          record;
BEGIN
  -- M15: ไม่คืนกล่องถ้ามีการเข้าครั้งหลัง (SV005) หรือสัญญา Renew แล้ว (SV010) — ใช้วันที่ปัจจุบันของการเข้า
  PERFORM service_ag_removal_guard(p_visit_id, p_station_ids);

  FOR r IN
    SELECT ar.station_id, ar.prev_status, ar.prev_removed_at, ar.removed_at_set,
           s.status, s.removed_at, s.type, s.station_no
      FROM station_ag_removals ar
      JOIN stations s ON s.id = ar.station_id
     WHERE ar.visit_id = p_visit_id
       AND s.contract_id = v_contract
       AND (p_station_ids IS NULL OR ar.station_id = ANY (p_station_ids))
     ORDER BY ar.station_id
       FOR UPDATE OF s
  LOOP
    -- คืนเฉพาะเมื่อยังเป็นผลของการเข้านี้ (ไม่มีใครเปลี่ยนต่อ) — ไม่งั้นไม่ย้อนทับ
    IF r.status = 'removed' AND r.removed_at IS NOT DISTINCT FROM r.removed_at_set THEN
      IF r.station_no IS NOT NULL AND EXISTS (
           SELECT 1 FROM stations o
            WHERE o.contract_id = v_contract AND o.type = r.type AND o.station_no = r.station_no
              AND o.id <> r.station_id AND o.status IN ('active', 'eliminated', 'pending_removal')) THEN
        RAISE EXCEPTION 'restoring this station clashes with a station number now in use' USING ERRCODE = 'SV002';
      END IF;
      BEGIN
        UPDATE stations s
           SET status     = r.prev_status,
               removed_at = r.prev_removed_at,
               updated_at = now()
         WHERE s.id = r.station_id;
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'restoring this station clashes with a station number now in use' USING ERRCODE = 'SV002';
      END;
    END IF;
    DELETE FROM station_ag_removals ar WHERE ar.station_id = r.station_id;
  END LOOP;
END;
$$;

-- =====================================================================
-- 5. save_service_visit (เนื้อเดิมจาก 20261112170000 + จุด M15)
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
-- 6. delete_service_visit (เนื้อเดิมจาก 20261112170000 + จุด M15)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.delete_service_visit(p_visit_id uuid)
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

  -- M15 (X9 ค่าชั่วคราว): สัญญาที่ Renew แล้ว ลบการเข้าบริการไม่ได้ (ทุกบทบาท) จนกว่าเจ้าของเลือกแบบ
  IF EXISTS (SELECT 1 FROM contracts c WHERE c.renewed_from_contract_id = v_contract) THEN
    RAISE EXCEPTION 'this contract has been renewed; its visits cannot be deleted and AG removals cannot be undone'
      USING ERRCODE = 'SV010';
  END IF;

  -- M13: ย้อนกลับด้านของลำดับ apply — ลบสถานีที่ฝังใหม่ก่อน แล้วค่อยคืนสถานีที่หาย/ถอน
  FOR w IN SELECT sw.id FROM station_works sw WHERE sw.visit_id = p_visit_id
            ORDER BY (sw.kind = 'added') DESC, sw.created_at DESC, sw.id LOOP
    BEGIN
      PERFORM service_work_undo(w.id);
    EXCEPTION WHEN unique_violation THEN
      -- คืนสถานีเดิมแล้วชนเลขที่ฝังใหม่ (DECISIONS 2.20) ซึ่งยังอยู่ในการเข้านี้ → บอกเป็นภาษาของระบบ
      RAISE EXCEPTION 'restoring this station clashes with a station number now in use' USING ERRCODE = 'SV002';
    END;
  END LOOP;

  -- M14: คืนกล่อง AG ที่การเข้านี้ถอด เป็นค่าก่อนถอด (DECISIONS 2.22 ก) — หลังย้อนงานฝังใหม่ (อาจใช้เลขเดิม)
  PERFORM service_ag_removal_restore(p_visit_id, NULL);

  DELETE FROM visits vi WHERE vi.id = p_visit_id RETURNING vi.id INTO v_deleted;
  IF v_deleted IS NULL THEN
    RAISE EXCEPTION 'not allowed to delete this visit' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('aga.service_visit', '', true);
END;
$$;

-- =====================================================================
-- 7. สิทธิ์ (function ใหม่ต้องกำหนดในไฟล์นี้ — CLAUDE.md)
-- =====================================================================
-- trigger function: ไม่มีใครเรียกตรงได้
REVOKE ALL ON FUNCTION public.stations_finished_status_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.visits_delete_rpc_only()         FROM PUBLIC, anon, authenticated;

-- ฟังก์ชันภายใน: RPC (SECURITY INVOKER) เรียกในนามผู้ใช้จึงต้องมี EXECUTE · ทำงานได้เฉพาะในด่าน aga.service_visit
REVOKE ALL ON FUNCTION public.service_ag_removal_guard(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_ag_removal_guard(uuid, uuid[]) TO authenticated;

-- แทนที่ด้วย OR REPLACE คงสิทธิ์เดิม — ย้ำอีกครั้งกันพลาด
REVOKE ALL ON FUNCTION public.service_ag_removal_restore(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_ag_removal_restore(uuid, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.save_service_visit(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_service_visit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_service_visit(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_service_visit(uuid) TO authenticated;
