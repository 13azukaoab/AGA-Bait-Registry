-- M13: ข้อมูลติดตั้งของกล่อง AG ที่ติดใหม่ในการเข้าเดียวกัน (เหยื่อที่ใส่ + ป้ายจุด) — ไม่นับเป็นรอบ F
-- เจ้าของตัดสิน 12 พ.ย. 2026 (DECISIONS 2.21) · ศูนย์กลางยืนยันแบบ
--
-- Logic summary:
--   * ปัญหา: กล่องที่ติดใหม่ถูกสร้างฝั่งฐานข้อมูลตอนบันทึก หน้าจอจึงไม่มี id ไปผูกผลตรวจ/ป้ายในการบันทึก
--     เดียวกัน (SV001) · และตาม SPEC §7.5 การติดตั้ง = S ไม่ใช่ F → ไม่ควรเป็นแถว station_checks อยู่แล้ว
--   * payload: ในรายการ `works` ที่ kind = "added" และ station_type = "AG" ส่ง
--       "installs": [{ "station_no": 3, "bait_added_g": 100, "point_label": "ห้องครัว" }, ...]
--     อ้างกล่องด้วยเลขสถานี (ต้องอยู่ใน station_nos ของรายการนั้น ไม่งั้น SV001) · ไม่รับ % กิน ·
--     ไม่ส่ง "installs" = ไม่แตะข้อมูลติดตั้ง · ส่ง = รายการเต็มของงานนั้น (กล่องที่ไม่อยู่ในรายการ เหยื่อติดตั้ง = ว่าง ·
--     ป้ายเปลี่ยนเฉพาะรายการที่มี key "point_label")
--   * ที่เก็บ: `stations.install_bait_g` (หาร 50 ลงตัว 0–5,000 · ใช้กับ AG เท่านั้น) + ป้ายใช้ `point_label` เดิม →
--     ไม่มีแถว station_checks → ไม่กระทบ F1–F10 / กันลืมกล่อง (D10) / Dashboard · การติดตามครั้งแรกยังเป็น F1
--   * งานอื่นที่ไม่ใช่ "ฝังใหม่ AG" ส่ง installs มา → 22023 (บั๊กหน้าจอ)
--   * สรุปวัสดุ: `v_service_materials.bait_inside_g` รวมเหยื่อตอนติดตั้งของกล่องที่ฝังในการเข้านั้นด้วย (เหยื่อที่ใช้จริง —
--     ศูนย์กลางตกลง) + คอลัมน์ใหม่ `install_bait_g` แยกให้ดู
--   * แก้/ลบ: ย้อนงานฝังใหม่ = ลบสถานี (ข้อมูลติดตั้งหายไปด้วย) · งานเดิมที่เลขไม่เปลี่ยนแต่แก้ installs → อัปเดต
--     ผ่านฟังก์ชันภายใน `service_work_set_installs` (ด่าน aga.service_visit เดียวกับ 20261112150000)
--   * ผู้ใช้แก้ `install_bait_g` ตรงไม่ได้ (ยกเว้น host) — trigger `stations_install_bait_guard` (42501)
--   * บั๊ก SV001 (ศูนย์กลางเพิ่มเข้า M13): กรอกผลตรวจจุด AG + เลือก "ถอดแล้ว" ในการเข้าเดียวกัน เดิมเปลี่ยนสถานะ
--     ก่อนตรวจผล → SV001 · แก้: ตรวจ/บันทึกผลตามสถานะเดิมก่อน แล้วค่อยเปลี่ยนสถานะท้ายฟังก์ชัน ·
--     จุดที่กำลังถอดไม่บังคับมีแถวผล (D10) เหมือนเดิม
--   * `save_service_visit` แทนที่ทั้งตัว (CREATE OR REPLACE · signature เดิม · สิทธิ์เดิมคงอยู่) —
--     เนื้อเดิมจาก 20261112150000 แก้เฉพาะวงงานซ่อม

-- =====================================================================
-- 1. คอลัมน์ข้อมูลติดตั้ง
-- =====================================================================
ALTER TABLE public.stations
  ADD COLUMN install_bait_g int
    CONSTRAINT stations_install_bait_step CHECK (install_bait_g % 50 = 0 AND install_bait_g BETWEEN 0 AND 5000),
  ADD CONSTRAINT stations_install_bait_ag_only CHECK (install_bait_g IS NULL OR type = 'AG');

CREATE FUNCTION public.stations_install_bait_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated' AND NOT public.is_host()
     AND ((TG_OP = 'INSERT' AND NEW.install_bait_g IS NOT NULL)
          OR (TG_OP = 'UPDATE' AND NEW.install_bait_g IS DISTINCT FROM OLD.install_bait_g)) THEN
    RAISE EXCEPTION 'install bait is recorded through save_service_visit' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stations_install_bait_guard
  BEFORE INSERT OR UPDATE ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.stations_install_bait_guard();

-- =====================================================================
-- 2. ฟังก์ชันภายใน: ใส่ข้อมูลติดตั้งให้กล่องที่งาน "ฝังใหม่" สร้าง
-- =====================================================================
CREATE FUNCTION public.service_work_set_installs(p_work_id uuid, p_installs jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w        record;
  v_ids    uuid[];
BEGIN
  -- ด่านก่อนค้นหา (เหมือน service_work_undo)
  IF coalesce(current_setting('aga.service_visit', true), '') = '' THEN
    RAISE EXCEPTION 'service works can only be changed through save_service_visit / delete_service_visit'
      USING ERRCODE = '42501';
  END IF;
  IF p_installs IS NULL OR jsonb_typeof(p_installs) = 'null' THEN
    RETURN;   -- ไม่ส่ง installs = ไม่แตะข้อมูลติดตั้ง
  END IF;
  IF jsonb_typeof(p_installs) <> 'array' OR jsonb_array_length(p_installs) > 500 THEN
    RAISE EXCEPTION 'installs must be a list' USING ERRCODE = '22023';
  END IF;

  SELECT sw.id, sw.visit_id, sw.kind, sw.station_type, sw.station_nos, sw.effects INTO w
    FROM station_works sw WHERE sw.id = p_work_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work not found' USING ERRCODE = 'AG004';
  END IF;
  PERFORM service_work_gate(w.visit_id);

  IF jsonb_array_length(p_installs) > 0 AND NOT (w.kind = 'added' AND w.station_type = 'AG') THEN
    RAISE EXCEPTION 'installs are only for newly added AG boxes' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_installs) e
              WHERE jsonb_typeof(e) <> 'object' OR (e ->> 'station_no') IS NULL)
     OR (SELECT count(*) <> count(DISTINCT e ->> 'station_no') FROM jsonb_array_elements(p_installs) e) THEN
    RAISE EXCEPTION 'each install needs a unique station_no' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_installs) e
              WHERE NOT ((e ->> 'station_no')::int = ANY (w.station_nos))) THEN
    RAISE EXCEPTION 'install refers to a station number outside this work' USING ERRCODE = 'SV001';
  END IF;

  v_ids := ARRAY(SELECT jsonb_array_elements_text(coalesce(w.effects -> 'created', '[]'))::uuid);

  -- กล่องในรายการ: เหยื่อ (+ ป้ายถ้าส่ง key มา) · แก้เฉพาะที่เปลี่ยน
  UPDATE stations s
     SET install_bait_g = nullif(e ->> 'bait_added_g', '')::int,
         point_label    = CASE WHEN e ? 'point_label' THEN nullif(btrim(e ->> 'point_label'), '')
                               ELSE s.point_label END,
         updated_at     = now()
    FROM jsonb_array_elements(p_installs) e
   WHERE s.id = ANY (v_ids) AND s.station_no = (e ->> 'station_no')::int
     AND (s.install_bait_g IS DISTINCT FROM nullif(e ->> 'bait_added_g', '')::int
          OR (e ? 'point_label' AND s.point_label IS DISTINCT FROM nullif(btrim(e ->> 'point_label'), '')));

  -- กล่องที่ไม่อยู่ในรายการ: ไม่มีเหยื่อติดตั้ง
  UPDATE stations s SET install_bait_g = NULL, updated_at = now()
   WHERE s.id = ANY (v_ids) AND s.install_bait_g IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_installs) e
                      WHERE (e ->> 'station_no')::int = s.station_no);
END;
$$;

-- =====================================================================
-- 3. save_service_visit: ส่ง installs ต่อให้ฟังก์ชันภายใน (เนื้อเดิมจาก 20261112150000)
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
    SELECT x.id, x.kind, x.station_type, x.station_nos, x.detail, x.installs,
           (sw.id IS NOT NULL) AS existing
      FROM jsonb_to_recordset(coalesce(p -> 'works', '[]'))
           AS x(id uuid, kind public.station_work_kind, station_type public.station_type,
                station_nos int[], detail text, installs jsonb)
      LEFT JOIN station_works sw ON sw.id = x.id AND sw.visit_id = v_visit_id
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

  -- ---------- สถานะจุด AG (ติดตามต่อ / รอถอด / ถอดแล้ว) — หลังบันทึกผลตรวจ (M13 บั๊ก SV001) ----------
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

  PERFORM set_config('aga.service_visit', '', true);
  RETURN jsonb_build_object('visit_id', v_visit_id, 'contract_id', v_contract, 'edited', v_is_edit);
END;
$$;

-- =====================================================================
-- 4. สรุปวัสดุ: เหยื่อใน (AG) รวมเหยื่อตอนติดตั้ง + คอลัมน์ install_bait_g (ต่อท้าย)
-- =====================================================================
CREATE OR REPLACE VIEW public.v_service_materials WITH (security_invoker = true) AS
WITH installs AS (
  SELECT sw.visit_id, sum(s.install_bait_g)::int AS install_bait_g
    FROM public.station_works sw
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(sw.effects -> 'created', '[]')) AS c(station_id)
    JOIN public.stations s ON s.id = c.station_id::uuid
   WHERE sw.kind = 'added' AND sw.station_type = 'AG'
   GROUP BY sw.visit_id
)
SELECT v.id          AS visit_id,
       v.contract_id,
       v.visit_date,
       v.visit_type,
       coalesce(sum(sc.bait_added_g) FILTER (WHERE s.type IN ('IG', 'IC')), 0)::int AS bait_outside_g,
       (coalesce(sum(sc.bait_added_g) FILTER (WHERE s.type = 'AG'), 0)
          + coalesce(max(i.install_bait_g), 0))::int                                AS bait_inside_g,
       coalesce(sum(sc.powder_points), 0)::int                                       AS powder_points,
       round(coalesce(sum(sc.powder_points), 0) * 0.3, 1)                            AS powder_g,
       coalesce(sum(CASE WHEN sc.timber_replaced AND s.type = 'IG' THEN 2
                         WHEN sc.timber_replaced AND s.type = 'IC' THEN 1
                         ELSE 0 END), 0)::int                                        AS timber_pcs,
       coalesce(max(i.install_bait_g), 0)::int                                       AS install_bait_g
  FROM public.visits v
  LEFT JOIN public.station_checks sc ON sc.visit_id = v.id
  LEFT JOIN public.stations s ON s.id = sc.station_id
  LEFT JOIN installs i ON i.visit_id = v.id
 GROUP BY v.id, v.contract_id, v.visit_date, v.visit_type;

-- =====================================================================
-- 5. สิทธิ์ (function ใหม่ต้องกำหนดในไฟล์นี้ — CLAUDE.md)
-- =====================================================================
REVOKE ALL ON FUNCTION public.stations_install_bait_guard() FROM PUBLIC, anon, authenticated;

-- ฟังก์ชันภายใน: RPC (INVOKER) เรียกในนามผู้ใช้จึงต้องมี EXECUTE · ทำงานได้เฉพาะในด่าน aga.service_visit
REVOKE ALL ON FUNCTION public.service_work_set_installs(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_work_set_installs(uuid, jsonb) TO authenticated;

-- view แทนที่ด้วย OR REPLACE คงสิทธิ์เดิม (authenticated/service_role อ่าน · anon ไม่ได้) — ย้ำอีกครั้งกันพลาด
REVOKE ALL ON public.v_service_materials FROM anon;
