-- M19b: เปลี่ยนไม้รายสถานี (DECISIONS 2.43) + เก็บสถานี IG คืนรายสถานี (2.42 · mockup #collect FINAL `a65699a`)
-- (เจ้าของอนุมัติ M19 ทั้งหมด 15 พ.ย. 2026 — DECISIONS แถว M19)
--
-- Logic summary:
--   A. เปลี่ยนไม้ (2.43) — **ไม่เปลี่ยน schema ของผลตรวจ และไม่แทนที่ save_service_visit**
--      - ข้อมูลรายสถานีมีอยู่แล้ว: `station_checks.timber_replaced` (1 แถว = 1 สถานีต่อการเข้า 1 ครั้ง)
--      - หน้าจอ (/service) แปลงเลขที่พิมพ์ เช่น `1 2 23 25` แยกชนิด IG/IC → station_id ของสถานีที่ใช้งาน
--        แล้วตั้ง timber_replaced = true ในแถวผลตรวจของสถานีนั้น (components/service/buildPayload.ts)
--      - ฐานข้อมูลตรวจซ้ำแล้วใน save_service_visit (M22): สถานีไม่ใช่ของสัญญานี้ / ไม่ได้ใช้งาน → SV001
--      - **ช่องโหว่ที่ปิดในไฟล์นี้:** เดิมตั้ง timber_replaced ให้กล่อง AG ได้ (ทั้ง RPC และ REST ตรง)
--        → trigger `station_checks_timber_type_guard` ปฏิเสธ (SV011) — เปลี่ยนไม้มีเฉพาะ IG / IC
--      - view `v_contract_monthly_timber` = สรุปรายเดือนรายสัญญาให้กราฟหน้ารายละเอียดลูกค้า
--        นับ "จุด" = สถานีไม่ซ้ำในเดือน (เข้า 2 ครั้งในเดือนเดียว เปลี่ยนจุดเดิม = 1 จุด) · ชิ้น = IG×2 + IC×1
--        เดือน = เดือนของ visit_date (การเข้าชดเชยนับในเดือนที่ไปทำจริง) · สัญญา = สัญญาของการเข้า
--   B. เก็บ IG คืนหลังหมดสัญญา (2.42) — ช่องใหม่ใน `stations` (audit ได้จาก trigger audit_stations เดิม ·
--      ไม่ต้องแตะ audit_trigger)
--      - เก็บแล้ว: `collected_at` (วันที่เก็บ — เวลาเที่ยงคืนไทย) + `collected_by` (ผู้กด) + `collected_team_id`
--      - ไม่เก็บ: `not_collected_on` (วันที่เข้าไป) + `not_collected_reason` (บังคับ ≤ 300 ตัวอักษร)
--        + `not_collected_by` (ผู้กด) + `not_collected_team_id`
--      - 1 สถานีมีได้อย่างใดอย่างหนึ่ง (CHECK) · IC ไม่ต้องเก็บ (มอบลูกค้า) · กล่อง AG ไม่ต้องเก็บ
--      - RPC (SECURITY DEFINER · ตรวจสิทธิ์เอง): host หรือ recorder ในขอบเขต · admin อ่านอย่างเดียว (mockup)
--          `collect_ig_stations(p_contract_id, p_count, p_on, p_team_id, p_station_nos)`
--          `skip_ig_collection(p_contract_id, p_count, p_on, p_team_id, p_reason, p_station_nos)`
--        · หน้าจอ #collect ส่ง "จำนวน" → ระบบเลือก IG ที่ยังค้าง เลขน้อยสุดก่อน · ส่ง `p_station_nos` แทนได้
--          (ระบุเลข IG เอง — ต้องเป็น IG ที่ค้างของสัญญานี้ทุกเลข)
--        · IG ที่ "ค้าง" = ชนิด IG · ไม่ใช่ หาย/ถอนออก · ยังไม่เก็บ และยังไม่กด "ไม่เก็บ"
--        · สัญญาต้องจบแล้ว: status ไม่ใช่ active หรือ วันสิ้นสุด (end_date / เริ่ม + N ปี − 1 วัน) < วันนี้ (ไทย)
--          (สัญญายกเลิกนับว่าจบ — รอเจ้าของยืนยัน)
--        · วันที่ไม่เกินวันนี้ (Asia/Bangkok) และไม่ก่อนวันที่สัญญาจบ (วันถัดจากวันสิ้นสุด / วันยกเลิก / วันปิด ที่เร็วสุด)
--        · ทีม: ประเภท service / install (teams.kind — M22 · แบบเดียวกับ SV006) ไม่เช็กจากรหัส
--        · ล็อกต่อสัญญา (advisory) + FOR UPDATE ที่สถานี → กดพร้อมกัน 2 คนไม่เลือกสถานีซ้ำ
--      - ด่าน `stations_collection_guard`: ผู้ใช้ผ่าน API (authenticated) ที่ไม่ใช่ host **เขียน 7 ช่องนี้ตรงไม่ได้**
--        (กันปลอม collected_by / ข้าม RPC) → 42501 · host แก้ตรงได้ (แบบ M14) · ฟังก์ชัน SECURITY DEFINER ไม่ติด
--        ⚠ เปลี่ยนพฤติกรรมเดิม: recorder / admin เคยตั้ง collected_at ตรงได้ (เทส 30/31/32 ปรับตาม)
--      - view `v_contract_ig_collection` (ค้างทั้งหมด ต่อสัญญา) · `v_ig_collection_monthly` (ทำในเดือนไหน ทีมไหน)
--        → หน้าจอแยก "ทำเดือนนี้" (กรองเดือน) จาก "ค้างทั้งหมด" (remaining)
--   C. view ทั้ง 3 ตัวเป็น security_invoker → RLS ของตารางต้นทางทำงาน: viewer / anon ไม่เห็น (PDPA กฎข้อ 2)
--   D. Renew (`initialize_contract_stations` · DECISIONS 2.50):
--      ① IG เก็บแล้ว → ไม่ย้าย (ข้ามเฉพาะตัวนั้นเงียบๆ ที่เหลือย้ายตามปกติ · ค่าที่คืน = จำนวนสถานีใช้งานของสัญญาใหม่)
--      ② IG ไม่เก็บ → ย้ายได้ · ล้างช่องไม่เก็บ · สัญญาเก่าแสดง "ย้ายไปสัญญาใหม่" จาก station_transfers (M15 เดิม ·
--         ไม่เพิ่มช่องใหม่) → view นับเป็น moved_to_renewal ไม่ใช่ not_collected · ③ ยังไม่บันทึก → ย้ายตามเดิม
--      ล็อกแถวที่จะย้ายก่อนตรวจ กันชนกับการกดเก็บพร้อมกัน
--      ⚠ ตัวถัดไปที่แทน `initialize_contract_stations` (M28) ต้องต่อจากเนื้อในไฟล์นี้ (M19b)
--   * ไม่แตะ: save_service_visit (M22) · delete_service_visit · audit_trigger (M21 กำลังแก้) ·
--     stations_recorder_guard · stations_finished_status_guard · customers / customer_phones (M19a)
--   * error ใหม่ (MESSAGE ภาษาไทย แสดงผู้ใช้ได้ตรง):
--     SV011 เปลี่ยนไม้ได้เฉพาะ IG/IC · CL001 สัญญายังไม่หมด · CL002 จำนวน/เลขสถานีไม่ถูกต้องหรือเกินที่ค้าง ·
--     CL003 ทีมไม่ถูกต้อง · CL004 ต้องมีเหตุผล · CL005 วันที่ไม่ถูกต้อง · AG004 ไม่พบสัญญา · 42501 ไม่มีสิทธิ์
--   * เทส: supabase/tests/41_service_timber_collect.test.sql

-- =====================================================================
-- A1. กันเปลี่ยนไม้ที่กล่อง AG (ทุกทาง: RPC / REST)
-- =====================================================================
CREATE FUNCTION public.station_checks_timber_type_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER   -- อ่านชนิดสถานีได้เสมอ ไม่ขึ้นกับ RLS ของผู้เรียก
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.timber_replaced
     AND EXISTS (SELECT 1 FROM public.stations s WHERE s.id = NEW.station_id AND s.type = 'AG') THEN
    RAISE EXCEPTION 'เปลี่ยนไม้ได้เฉพาะสถานี IG / IC (กล่อง AG ไม่มีไม้ล่อ)' USING ERRCODE = 'SV011';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER station_checks_timber_type_guard
  BEFORE INSERT OR UPDATE OF timber_replaced, station_id ON public.station_checks
  FOR EACH ROW EXECUTE FUNCTION public.station_checks_timber_type_guard();

-- =====================================================================
-- A2. สรุปเปลี่ยนไม้รายเดือนรายสัญญา (กราฟหน้ารายละเอียดลูกค้า)
-- =====================================================================
CREATE VIEW public.v_contract_monthly_timber
WITH (security_invoker = true) AS
SELECT
  d.contract_id,
  d.month,                                                          -- วันแรกของเดือน
  count(*) FILTER (WHERE d.type = 'IG')::int                        AS ig_points,
  count(*) FILTER (WHERE d.type = 'IC')::int                        AS ic_points,
  count(*)::int                                                     AS total_points,
  (2 * count(*) FILTER (WHERE d.type = 'IG')
     + count(*) FILTER (WHERE d.type = 'IC'))::int                  AS timber_pieces,
  coalesce(array_agg(d.station_no ORDER BY d.station_no)
             FILTER (WHERE d.type = 'IG' AND d.station_no IS NOT NULL), '{}')  AS ig_station_nos,
  coalesce(array_agg(d.station_no ORDER BY d.station_no)
             FILTER (WHERE d.type = 'IC' AND d.station_no IS NOT NULL), '{}')  AS ic_station_nos
FROM (
  -- สถานีไม่ซ้ำต่อ (สัญญา, เดือน)
  SELECT DISTINCT v.contract_id, date_trunc('month', v.visit_date)::date AS month,
         s.id AS station_id, s.type, s.station_no
    FROM public.station_checks sc
    JOIN public.visits v   ON v.id = sc.visit_id
    JOIN public.stations s ON s.id = sc.station_id
   WHERE sc.timber_replaced AND sc.checked AND s.type IN ('IG', 'IC')
) d
GROUP BY d.contract_id, d.month;

COMMENT ON VIEW public.v_contract_monthly_timber IS
  'M19b: เปลี่ยนไม้รายเดือนรายสัญญา (จุด = สถานีไม่ซ้ำในเดือน · ชิ้น = IG×2 + IC×1) · security_invoker';

-- =====================================================================
-- B1. ช่องเก็บสถานี IG
-- =====================================================================
ALTER TABLE public.stations
  ADD COLUMN collected_by          uuid REFERENCES auth.users(id),
  ADD COLUMN collected_team_id     uuid REFERENCES public.teams(id),
  ADD COLUMN not_collected_on      date,
  ADD COLUMN not_collected_reason  text,
  ADD COLUMN not_collected_by      uuid REFERENCES auth.users(id),
  ADD COLUMN not_collected_team_id uuid REFERENCES public.teams(id);

ALTER TABLE public.stations
  ADD CONSTRAINT stations_collect_xor_skip CHECK (collected_at IS NULL OR not_collected_on IS NULL),
  ADD CONSTRAINT stations_collected_detail CHECK (
    collected_at IS NOT NULL OR (collected_by IS NULL AND collected_team_id IS NULL)),
  ADD CONSTRAINT stations_not_collected_detail CHECK (
    (not_collected_on IS NULL
       AND not_collected_reason IS NULL AND not_collected_by IS NULL AND not_collected_team_id IS NULL)
    OR (not_collected_on IS NOT NULL
       AND coalesce(length(btrim(not_collected_reason)), 0) BETWEEN 1 AND 300));

CREATE INDEX stations_collected_team_id_idx     ON public.stations (collected_team_id)     WHERE collected_team_id IS NOT NULL;
CREATE INDEX stations_not_collected_team_id_idx ON public.stations (not_collected_team_id) WHERE not_collected_team_id IS NOT NULL;
-- รายการ IG ที่ค้างเก็บ
CREATE INDEX stations_ig_pending_collect_idx ON public.stations (contract_id, station_no)
  WHERE type = 'IG' AND collected_at IS NULL AND not_collected_on IS NULL;

-- =====================================================================
-- B2. ด่าน: ช่องเก็บสถานีเขียนผ่าน RPC เท่านั้น (ยกเว้น host)
-- =====================================================================
CREATE FUNCTION public.stations_collection_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ฟังก์ชันระบบ SECURITY DEFINER (current_user = เจ้าของตาราง) / service_role / postgres / host ผ่าน
  IF current_user <> 'authenticated' OR public.is_host() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.collected_at IS NOT NULL OR NEW.collected_by IS NOT NULL OR NEW.collected_team_id IS NOT NULL
       OR NEW.not_collected_on IS NOT NULL OR NEW.not_collected_reason IS NOT NULL
       OR NEW.not_collected_by IS NOT NULL OR NEW.not_collected_team_id IS NOT NULL THEN
      RAISE EXCEPTION 'บันทึกการเก็บสถานีผ่านหน้า "ลูกค้ารอเก็บสถานี" เท่านั้น' USING ERRCODE = '42501';
    END IF;
  ELSIF (NEW.collected_at, NEW.collected_by, NEW.collected_team_id, NEW.not_collected_on,
         NEW.not_collected_reason, NEW.not_collected_by, NEW.not_collected_team_id)
        IS DISTINCT FROM
        (OLD.collected_at, OLD.collected_by, OLD.collected_team_id, OLD.not_collected_on,
         OLD.not_collected_reason, OLD.not_collected_by, OLD.not_collected_team_id) THEN
    RAISE EXCEPTION 'บันทึกการเก็บสถานีผ่านหน้า "ลูกค้ารอเก็บสถานี" เท่านั้น' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stations_collection_guard
  BEFORE INSERT OR UPDATE ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.stations_collection_guard();

-- =====================================================================
-- B3. ตัวทำงานกลาง (ผู้ใช้เรียกตรงไม่ได้) — เลือก IG ที่ค้าง แล้วบันทึก เก็บแล้ว / ไม่เก็บ
-- =====================================================================
CREATE FUNCTION public.ig_collection_apply(
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
-- B4. RPC ที่หน้าจอเรียก
-- =====================================================================
CREATE FUNCTION public.collect_ig_stations(
  p_contract_id uuid,
  p_count       int,
  p_on          date,
  p_team_id     uuid,
  p_station_nos int[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER   -- ตัวกลางตรวจสิทธิ์เองทุกข้อ (auth.uid() ยังเป็นผู้เรียก)
SET search_path = public, pg_temp
AS $$
  SELECT public.ig_collection_apply('collected', p_contract_id, p_count, p_on, p_team_id, NULL, p_station_nos);
$$;

CREATE FUNCTION public.skip_ig_collection(
  p_contract_id uuid,
  p_count       int,
  p_on          date,
  p_team_id     uuid,
  p_reason      text,
  p_station_nos int[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.ig_collection_apply('not_collected', p_contract_id, p_count, p_on, p_team_id, p_reason, p_station_nos);
$$;

-- =====================================================================
-- B5. view สรุปการเก็บ IG
-- =====================================================================
-- ค้างทั้งหมด ต่อสัญญา (ทุกสัญญาที่มี IG — หน้าจอกรองสัญญาที่จบแล้วเอง)
-- ig_total = IG ที่อยู่กับสัญญานี้ (ไม่นับหาย/ถอน) + IG ที่ย้ายออกไปสัญญา Renew (station_transfers)
--   → ตัวเลขของสัญญาเก่าคงที่หลัง Renew · moved_to_renewal ไม่นับเป็น ไม่เก็บ / ค้าง (DECISIONS 2.50)
CREATE VIEW public.v_contract_ig_collection
WITH (security_invoker = true) AS
SELECT
  x.contract_id,
  count(*)::int                                                                     AS ig_total,
  count(*) FILTER (WHERE x.state = 'collected')::int                                AS collected,
  count(*) FILTER (WHERE x.state = 'not_collected')::int                            AS not_collected,
  count(*) FILTER (WHERE x.state = 'moved_to_renewal')::int                         AS moved_to_renewal,
  count(*) FILTER (WHERE x.state = 'remaining')::int                                AS remaining,
  max(x.collected_on)                                                               AS last_collected_on,
  max(x.not_collected_on)                                                           AS last_not_collected_on
FROM (
  SELECT s.contract_id,
         CASE WHEN s.collected_at IS NOT NULL THEN 'collected'
              WHEN s.not_collected_on IS NOT NULL THEN 'not_collected'
              ELSE 'remaining' END AS state,
         (s.collected_at AT TIME ZONE 'Asia/Bangkok')::date AS collected_on,
         s.not_collected_on
    FROM public.stations s
   WHERE s.type = 'IG' AND s.status NOT IN ('lost', 'withdrawn')
  UNION ALL
  SELECT t.from_contract_id, 'moved_to_renewal', NULL::date, NULL::date
    FROM public.station_transfers t
    JOIN public.stations s ON s.id = t.station_id
   WHERE s.type = 'IG'
) x
GROUP BY x.contract_id;

COMMENT ON VIEW public.v_contract_ig_collection IS
  'M19b: IG ต่อสัญญา — เก็บแล้ว / ไม่เก็บ / ย้ายไปสัญญาใหม่ / ค้าง (ค้างทั้งหมด) · security_invoker';

-- ทำในเดือนไหน ทีมไหน (ทำเดือนนี้ = กรอง month) · reasons = เหตุผลไม่เก็บที่ต่างกันในกลุ่มนั้น
CREATE VIEW public.v_ig_collection_monthly
WITH (security_invoker = true) AS
SELECT x.contract_id, x.month, x.kind, x.team_id,
       count(*)::int AS stations,
       max(x.on_date) AS last_on,
       coalesce(array_agg(DISTINCT x.reason) FILTER (WHERE x.reason IS NOT NULL), '{}') AS reasons
FROM (
  SELECT s.contract_id, 'collected'::text AS kind, s.collected_team_id AS team_id,
         (s.collected_at AT TIME ZONE 'Asia/Bangkok')::date AS on_date,
         date_trunc('month', s.collected_at AT TIME ZONE 'Asia/Bangkok')::date AS month,
         NULL::text AS reason
    FROM public.stations s
   WHERE s.type = 'IG' AND s.status NOT IN ('lost', 'withdrawn') AND s.collected_at IS NOT NULL
  UNION ALL
  SELECT s.contract_id, 'not_collected', s.not_collected_team_id,
         s.not_collected_on,
         date_trunc('month', s.not_collected_on)::date,
         s.not_collected_reason
    FROM public.stations s
   WHERE s.type = 'IG' AND s.status NOT IN ('lost', 'withdrawn') AND s.not_collected_on IS NOT NULL
  UNION ALL
  -- ย้ายไปสัญญา Renew (2.50) — เดือนที่ย้าย · ไม่มีทีม
  SELECT t.from_contract_id, 'moved_to_renewal', NULL::uuid,
         (t.transferred_at AT TIME ZONE 'Asia/Bangkok')::date,
         date_trunc('month', t.transferred_at AT TIME ZONE 'Asia/Bangkok')::date,
         NULL::text
    FROM public.station_transfers t
    JOIN public.stations s ON s.id = t.station_id
   WHERE s.type = 'IG'
) x
GROUP BY x.contract_id, x.month, x.kind, x.team_id;

COMMENT ON VIEW public.v_ig_collection_monthly IS
  'M19b: การเก็บ IG รายเดือน รายทีม (collected / not_collected / moved_to_renewal) · security_invoker';

-- =====================================================================
-- C. สิทธิ์
-- =====================================================================
REVOKE ALL ON FUNCTION public.station_checks_timber_type_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stations_collection_guard() FROM PUBLIC, anon, authenticated;
-- ตัวกลาง: ผู้ใช้เรียกตรงไม่ได้ (ไปทาง RPC 2 ตัวข้างล่างเท่านั้น)
REVOKE ALL ON FUNCTION public.ig_collection_apply(text, uuid, int, date, uuid, text, int[]) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.collect_ig_stations(uuid, int, date, uuid, int[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collect_ig_stations(uuid, int, date, uuid, int[]) TO authenticated;
REVOKE ALL ON FUNCTION public.skip_ig_collection(uuid, int, date, uuid, text, int[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.skip_ig_collection(uuid, int, date, uuid, text, int[]) TO authenticated;

REVOKE ALL ON public.v_contract_monthly_timber FROM PUBLIC, anon;
REVOKE ALL ON public.v_contract_ig_collection  FROM PUBLIC, anon;
REVOKE ALL ON public.v_ig_collection_monthly   FROM PUBLIC, anon;
GRANT SELECT ON public.v_contract_monthly_timber TO authenticated, service_role;
GRANT SELECT ON public.v_contract_ig_collection  TO authenticated, service_role;
GRANT SELECT ON public.v_ig_collection_monthly   TO authenticated, service_role;

-- =====================================================================
-- D. Renew กับ IG ที่บันทึกเก็บแล้ว (เจ้าของตัดสิน DECISIONS 2.50 · 16 พ.ย. 2026)
--    ① เก็บแล้ว → ไม่ย้าย (ข้ามเฉพาะตัวนั้น) · ② ไม่เก็บ → ย้ายได้ ล้างช่องไม่เก็บ · ③ ยังไม่บันทึก → ย้ายตามเดิม
--    เนื้อเดิมจาก 20261112130100 (นิยามเดียว — ไม่มี migration อื่นแทนที่) แก้เฉพาะจุดที่ติดป้าย "M19b"
--    ⚠ ตัวถัดไปที่แทน `initialize_contract_stations` (เช่น M28) ต้องต่อจากเนื้อในไฟล์นี้ (M19b) ไม่ใช่ 20261112130100
-- =====================================================================
CREATE OR REPLACE FUNCTION public.initialize_contract_stations(
  p_contract_id          uuid,
  p_ig_nos               int[]  DEFAULT '{}',
  p_ic_nos               int[]  DEFAULT '{}',
  p_transfer_station_ids uuid[] DEFAULT '{}'
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role        public.user_role := public.current_app_role();
  v_initialized timestamptz;
  v_old         uuid;
  v_status      public.contract_status;
  v_ig          int[] := coalesce(p_ig_nos, '{}');
  v_ic          int[] := coalesce(p_ic_nos, '{}');
  v_moves       uuid[] := ARRAY(SELECT DISTINCT s FROM unnest(coalesce(p_transfer_station_ids, '{}')) s
                                 WHERE s IS NOT NULL);
  v_count       int;
BEGIN
  -- สิทธิ์ (function นี้ข้าม RLS จึงตรวจเองทุกข้อ)
  IF v_role IS NULL OR v_role NOT IN ('host', 'recorder') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT c.stations_initialized_at, c.renewed_from_contract_id, c.status
    INTO v_initialized, v_old, v_status
    FROM public.contracts c WHERE c.id = p_contract_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;
  IF v_role <> 'host' AND NOT public.contract_in_scope(p_contract_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  -- สัญญาปิด/ยกเลิก: เฉพาะ host (สอดคล้อง DECISIONS 3.11)
  IF v_status IN ('closed', 'cancelled') AND v_role <> 'host' THEN
    RAISE EXCEPTION 'a closed or cancelled contract can be changed by host only' USING ERRCODE = 'AG007';
  END IF;
  IF v_initialized IS NOT NULL THEN
    RAISE EXCEPTION 'stations of this contract are already set' USING ERRCODE = 'SV007';
  END IF;

  -- เลขสถานีใหม่: บวก · ไม่ซ้ำในชุดเดียวกัน
  IF EXISTS (SELECT 1 FROM unnest(v_ig) n WHERE n IS NULL OR n <= 0)
     OR EXISTS (SELECT 1 FROM unnest(v_ic) n WHERE n IS NULL OR n <= 0)
     OR cardinality(v_ig) <> (SELECT count(DISTINCT n) FROM unnest(v_ig) n)
     OR cardinality(v_ic) <> (SELECT count(DISTINCT n) FROM unnest(v_ic) n) THEN
    RAISE EXCEPTION 'invalid or duplicate station numbers' USING ERRCODE = 'SV009';
  END IF;

  -- สถานีที่จะย้ายต้องเป็นของสัญญาเก่าที่ผูกไว้ (Renew) และยังใช้งาน — ตรวจก่อนเรื่องเลขชน
  IF cardinality(v_moves) > 0 THEN
    -- M19b: ล็อกแถวที่จะย้ายก่อนตรวจ → กด "เก็บ/ไม่เก็บ" (ig_collection_apply · FOR UPDATE) พร้อมกันไม่หลุดผ่าน
    PERFORM 1 FROM public.stations s WHERE s.id = ANY (v_moves) ORDER BY s.id FOR UPDATE;
    IF v_old IS NULL
       OR (SELECT count(*) FROM public.stations s
            WHERE s.id = ANY (v_moves) AND s.contract_id = v_old
              AND s.status IN ('active', 'eliminated', 'pending_removal')) <> cardinality(v_moves) THEN
      RAISE EXCEPTION 'station cannot be moved to this contract' USING ERRCODE = 'SV008';
    END IF;
    -- M19b (DECISIONS 2.50 ①): สถานีที่ "เก็บแล้ว" ในสัญญาเก่า ไม่ย้าย — ข้ามเฉพาะตัวนั้น ที่เหลือย้ายตามปกติ
    -- (อยู่กับสัญญาเก่าเป็น "เก็บแล้ว" · สัญญาใหม่ตั้งสถานีใหม่เอง · หน้าจอควรไม่เสนอ IG ที่เก็บแล้วให้ติ๊กย้าย)
    v_moves := ARRAY(SELECT s.id FROM public.stations s
                      WHERE s.id = ANY (v_moves) AND s.collected_at IS NULL);
  END IF;

  -- เลขใหม่/เลขที่ย้ายมา ต้องไม่ชนกับสถานีที่ใช้งานอยู่แล้วในสัญญาปลายทาง (แจ้ง SV009 แทน 23505)
  IF EXISTS (SELECT 1 FROM public.stations s
              WHERE s.contract_id = p_contract_id
                AND s.status IN ('active', 'eliminated', 'pending_removal')
                AND NOT (s.id = ANY (v_moves))
                AND ((s.type = 'IG' AND s.station_no = ANY (v_ig))
                  OR (s.type = 'IC' AND s.station_no = ANY (v_ic))
                  OR EXISTS (SELECT 1 FROM public.stations m
                              WHERE m.id = ANY (v_moves) AND m.type = s.type AND m.station_no = s.station_no))) THEN
    RAISE EXCEPTION 'station number already used on this contract' USING ERRCODE = 'SV009';
  END IF;

  -- ย้ายสถานีจากสัญญาเก่า (Renew): ต้องเป็นของสัญญาเก่าที่ผูกไว้ และยังใช้งาน
  IF cardinality(v_moves) > 0 THEN

    -- เลขที่ย้ายมาต้องไม่ชนกับเลขใหม่ที่จะสร้าง
    IF EXISTS (SELECT 1 FROM public.stations s
                WHERE s.id = ANY (v_moves)
                  AND ((s.type = 'IG' AND s.station_no = ANY (v_ig))
                    OR (s.type = 'IC' AND s.station_no = ANY (v_ic)))) THEN
      RAISE EXCEPTION 'station number already used by a moved station' USING ERRCODE = 'SV009';
    END IF;

    -- M19b (2.50 ②): IG ที่ "ไม่เก็บ" (ทิ้งไว้หน้างาน) ย้ายไปใช้ต่อได้ → ล้างช่องไม่เก็บ (กลับเป็นสถานีใช้งานของสัญญาใหม่)
    -- สัญญาเก่าเห็นเป็น "ย้ายไปสัญญาใหม่" จาก station_transfers (ไม่นับเป็นไม่เก็บ) · ค่าเดิมอยู่ใน audit_log
    UPDATE public.stations s
       SET contract_id           = p_contract_id,
           not_collected_on      = NULL,
           not_collected_reason  = NULL,
           not_collected_by      = NULL,
           not_collected_team_id = NULL,
           updated_at            = now()
     WHERE s.id = ANY (v_moves);

    INSERT INTO public.station_transfers (station_id, from_contract_id, to_contract_id)
    SELECT m, v_old, p_contract_id FROM unnest(v_moves) m;
  END IF;

  INSERT INTO public.stations (contract_id, type, station_no, status)
  SELECT p_contract_id, 'IG'::public.station_type, n, 'active'::public.station_status FROM unnest(v_ig) n
  UNION ALL
  SELECT p_contract_id, 'IC'::public.station_type, n, 'active'::public.station_status FROM unnest(v_ic) n;

  UPDATE public.contracts c SET stations_initialized_at = now() WHERE c.id = p_contract_id;

  SELECT count(*) INTO v_count FROM public.stations s
   WHERE s.contract_id = p_contract_id AND s.status IN ('active', 'eliminated', 'pending_removal');
  RETURN v_count;
END;
$$;

-- แทนที่ด้วย OR REPLACE คงสิทธิ์เดิม — ย้ำอีกครั้งกันพลาด
REVOKE ALL ON FUNCTION public.initialize_contract_stations(uuid, int[], int[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initialize_contract_stations(uuid, int[], int[], uuid[]) TO authenticated;
