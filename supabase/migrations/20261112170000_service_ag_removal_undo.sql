-- M14: ลบ/แก้การเข้าบริการที่เคยถอดกล่อง AG → ย้อนสถานะกล่องกลับเป็นค่าก่อนถอด
-- เจ้าของตัดสิน 12 พ.ย. 2026 (DECISIONS 2.22 ก: "เหมือนไม่เคยถอด") · ทำที่ฐานข้อมูล
--
-- Logic summary:
--   * ปัญหา: `station_statuses` ของ save_service_visit เปลี่ยนกล่อง AG เป็น removed แต่ไม่จำค่าเดิม →
--     ลบการเข้านั้นแล้วกล่องยังเป็น removed · และแก้การเข้าเดิมเพื่อเอาติ๊กถอดออกก็ไม่ได้ เพราะเงื่อนไข
--     "ไม่ปลุกกล่องที่ถอด/กำจัดแล้ว" (s.status IN ('active','pending_removal')) กันไว้
--   * วิธีเก็บค่าก่อนถอด: ตารางใหม่ `station_ag_removals` (1 แถวต่อกล่องที่ถอดอยู่ · ผูกการเข้าที่ถอด)
--     เหตุผลที่ไม่ใช้ทางอื่น:
--       - คอลัมน์ใหม่ใน stations: trigger `stations_recorder_guard` ล็อกเฉพาะคอลัมน์ที่ระบุชื่อ →
--         คอลัมน์ใหม่หัวหน้างานเขียนตรงผ่าน REST ได้ → ปลอมว่า "การเข้า X เป็นคนถอด" แล้วลบ X เพื่อปลุกกล่องใดก็ได้
--         (ช่องโหว่แบบเดียวกับที่ station_works.effects ถูกออกแบบมากัน)
--       - อ่านจาก audit_log: แถว INSERT ไม่ถูกเก็บ (20261111090100) และต้องแกะ JSON ประวัติ → เปราะ
--     ตารางนี้ผู้ใช้ **อ่านอย่างเดียว** · เขียนผ่านฟังก์ชันภายใน (SECURITY DEFINER) ที่ผ่านด่าน
--     `service_work_gate` (aga.service_visit = visit id + host / recorder ในขอบเขต) เท่านั้น
--   * บันทึก (save_service_visit): จุดที่การเข้านี้กำลังถอด (`v_removing` = AG ที่ active/pending_removal และ
--     payload สั่ง removed) → จำ prev_status + prev_removed_at + removed_at ที่ตั้งให้ ก่อนเปลี่ยนสถานะท้ายฟังก์ชัน
--     บันทึกซ้ำ/แก้ที่ยังสั่ง removed → กล่องเป็น removed อยู่แล้ว ไม่อยู่ใน v_removing → ค่าก่อนถอดเดิมไม่ถูกทับ
--   * ลบการเข้า (delete_service_visit): ย้อนงานซ่อมก่อน (ลบกล่องที่ฝังใหม่ที่อาจใช้เลขเดิม) แล้วค่อยคืนกล่องที่
--     การเข้านี้ถอด แล้วลบการเข้า (แถวบันทึกหายตาม CASCADE)
--   * แก้การเข้าเดิมแล้วเอาติ๊กถอดออก: payload ส่งสถานะ active / pending_removal ให้กล่องที่ **การเข้านี้** ถอด
--     → คืนค่าก่อนถอด (หลังวงงานซ่อม ก่อนตรวจผล) แล้วสถานะจาก payload ทำงานตามปกติท้ายฟังก์ชัน
--     กล่องที่คืนแล้วเป็นกล่องใช้งานปกติของการเข้านี้ → ต้องมีแถวผล/"ไม่ได้ตรวจ" ตามกันลืมกล่อง (D10)
--     กล่องที่ถอดใน **การเข้าอื่น** ยังปลุกไม่ได้ (ไม่มีแถวบันทึกของการเข้านี้ → เงื่อนไขเดิมกันไว้)
--   * กันย้อนทับ: คืนเฉพาะเมื่อกล่องยังเป็น removed และ removed_at ยังเท่ากับที่การเข้านี้ตั้ง
--       - ถ้ามีคนเปลี่ยนหลังจากนั้นแล้ว (เช่น host แก้สถานะ/วันถอดเอง) → ไม่แตะกล่อง ลบแถวบันทึกทิ้งเฉยๆ
--         (การเข้าอื่นผ่าน RPC แตะกล่องที่ถอดแล้วไม่ได้อยู่แล้ว)
--       - ถ้าเลขกล่องถูกใช้กับกล่องใหม่ที่ยังใช้งานอยู่ (ฝังใหม่เลขเดิม DECISIONS 2.20) → SV002 ยกเลิกทั้งหมด
--         (ข้อความเดียวกับการย้อนงานซ่อม · ต้องลบ/แก้การเข้าที่ฝังกล่องใหม่ก่อน) ไม่ปล่อย 23505
--   * การคืนสถานะเป็น UPDATE ของ stations → ลง audit_log ด้วย trigger เดิม (changed_by = ผู้ลบ/แก้)
--   * ขอบเขต: จำเฉพาะการ "ถอด" (removed) ตาม 2.22 — การเปลี่ยน active ↔ pending_removal ในการเข้า ไม่ย้อนตอนลบ
--   * `save_service_visit` / `delete_service_visit` แทนที่ทั้งตัว (CREATE OR REPLACE · signature เดิม · สิทธิ์เดิม)
--     เนื้อเดิมจาก 20261112160000 · เพิ่มเฉพาะ 3 จุดที่ติดป้าย "M14"

-- =====================================================================
-- 1. ตารางบันทึกค่าก่อนถอด
-- =====================================================================
CREATE TABLE public.station_ag_removals (
  station_id      uuid PRIMARY KEY REFERENCES public.stations (id) ON DELETE CASCADE,
  visit_id        uuid NOT NULL REFERENCES public.visits (id) ON DELETE CASCADE,
  prev_status     public.station_status NOT NULL
                    CONSTRAINT station_ag_removals_prev_in_use CHECK (prev_status IN ('active', 'pending_removal')),
  prev_removed_at timestamptz,
  removed_at_set  timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX station_ag_removals_visit_id_idx ON public.station_ag_removals (visit_id);

ALTER TABLE public.station_ag_removals ENABLE ROW LEVEL SECURITY;
CREATE POLICY station_ag_removals_select ON public.station_ag_removals FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));
-- ไม่มี policy เขียน: เขียนผ่านฟังก์ชันภายในที่ RPC เรียกเท่านั้น (ดูหัวไฟล์)

-- =====================================================================
-- 2. ฟังก์ชันภายใน (SECURITY DEFINER · ด่านเดียวกับงานซ่อม)
-- =====================================================================
-- จำค่าก่อนถอดของกล่องที่การเข้านี้กำลังถอด (เรียกก่อน UPDATE สถานะ)
CREATE FUNCTION public.service_ag_removal_capture(p_visit_id uuid, p_station_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract uuid := service_work_gate(p_visit_id);
BEGIN
  -- กรองซ้ำที่นี่ (ไม่เชื่อรายการจากผู้เรียก): AG ของสัญญานี้ที่ยังใช้งาน/รอถอด
  -- แถวเก่าของกล่องเดียวกัน (ค้างจากการเปลี่ยนนอก RPC) ถูกแทนที่ — กล่องกลับมาใช้งานแล้ว แถวนั้นจึงหมดความหมาย
  INSERT INTO station_ag_removals AS r (station_id, visit_id, prev_status, prev_removed_at, removed_at_set)
  SELECT s.id, p_visit_id, s.status, s.removed_at, coalesce(s.removed_at, now())
    FROM stations s
   WHERE s.id = ANY (coalesce(p_station_ids, '{}'))
     AND s.contract_id = v_contract AND s.type = 'AG'
     AND s.status IN ('active', 'pending_removal')
  ON CONFLICT (station_id) DO UPDATE SET
    visit_id        = EXCLUDED.visit_id,
    prev_status     = EXCLUDED.prev_status,
    prev_removed_at = EXCLUDED.prev_removed_at,
    removed_at_set  = EXCLUDED.removed_at_set,
    created_at      = now();
END;
$$;

-- คืนค่าก่อนถอดของกล่องที่การเข้านี้ถอด (p_station_ids = NULL → ทุกกล่องของการเข้านี้)
CREATE FUNCTION public.service_ag_removal_restore(p_visit_id uuid, p_station_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract uuid := service_work_gate(p_visit_id);
  r          record;
BEGIN
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
-- 3. save_service_visit (เนื้อเดิมจาก 20261112160000 + จุด M14)
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
-- 4. delete_service_visit (เนื้อเดิมจาก 20261112160000 + คืนกล่อง AG ที่การเข้านี้ถอด)
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
-- 5. สิทธิ์ (ตาราง/function ใหม่ต้องกำหนดในไฟล์นี้ — CLAUDE.md)
-- =====================================================================
REVOKE ALL ON public.station_ag_removals FROM PUBLIC;
REVOKE ALL ON public.station_ag_removals FROM anon;
REVOKE ALL ON public.station_ag_removals FROM authenticated;
GRANT SELECT ON public.station_ag_removals TO authenticated;          -- เขียนผ่าน RPC เท่านั้น
GRANT SELECT, INSERT, UPDATE, DELETE ON public.station_ag_removals TO service_role;

-- ฟังก์ชันภายใน: RPC (SECURITY INVOKER) เรียกในนามผู้ใช้จึงต้องมี EXECUTE · ทำงานได้เฉพาะในด่าน aga.service_visit
REVOKE ALL ON FUNCTION public.service_ag_removal_capture(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.service_ag_removal_restore(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_ag_removal_capture(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_ag_removal_restore(uuid, uuid[]) TO authenticated;

-- RPC แทนที่ด้วย OR REPLACE คงสิทธิ์เดิม — ย้ำอีกครั้งกันพลาด
REVOKE ALL ON FUNCTION public.save_service_visit(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_service_visit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_service_visit(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_service_visit(uuid) TO authenticated;
