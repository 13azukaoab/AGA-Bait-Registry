-- M24: ฐานข้อมูลของหน้าหลัก #todo (mockup FINAL 220adf8 · เจ้าของอนุมัติ 15 พ.ย. 2026 — DECISIONS M24)
--
-- Logic summary:
--   1. ตาราง `missed_service_notes` — หมายเหตุตกบริการรายเดือน: 1 แถว = 1 สัญญา × 1 เดือนที่ตก
--      (note ≤ 200 ตัวอักษร ตาม maxlength ใน mockup · recorded_by / recorded_at = ผู้บันทึกล่าสุด)
--      · แยกจาก `missed_service_resolutions` (M18) เพราะตารางนั้นมีแถวเฉพาะตอนตัดสินแล้ว
--        → เรื่องที่ "รอตัดสิน" ไม่มีที่เก็บหมายเหตุ
--      · เขียนผ่าน RPC `save_missed_service_note(p jsonb)` เท่านั้น (ผู้ใช้ไม่มี GRANT INSERT/UPDATE/DELETE)
--        - host หรือ recorder ในขอบเขต (admin อ่านอย่างเดียว · viewer/anon ไม่เห็นอะไรเลย — PDPA)
--        - ใส่/แก้หมายเหตุได้เฉพาะเดือนที่ "ตกจริงและยังรอตัดสิน" — เกณฑ์เดียวกับ
--          `list_pending_missed_services` (M18): ตั้งแต่เดือนตั้งสถานี (2.46) · เดือนบริการที่ผ่านไปแล้ว ·
--          ไม่มี routine ในเดือนนั้น · ยังไม่ชดเชย · ยังไม่ "ไม่ชดเชย" · สัญญาไม่ถูกยกเลิก · ยังไม่ต่อสัญญา (2.47)
--          ใช้รหัส error ชุดเดียวกับ M18 (MS001 / MS002 / MS005 / MS009 / MS010 / MS011) → หน้าจอใช้ตารางแปลชุดเดียว
--        - note ว่าง / null = ลบหมายเหตุ (mockup: ลบข้อความแล้วกดบันทึก) · ลบได้ทุกสถานะ (ตามสิทธิ์เขียนเท่านั้น)
--        - หมายเหตุที่บันทึกไว้แล้วคงอยู่เมื่อเรื่องถูกตัดสินภายหลัง (เป็นประวัติ) — แต่แก้ข้อความไม่ได้แล้ว
--        - advisory lock ต่อสัญญาเดียวกับ save_service_visit / resolve_missed_service (ไม่ชนกับการตัดสิน)
--      · อ่าน (RLS): host / admin ทุกสาขา · recorder เฉพาะสัญญาในขอบเขต (ตรงกับ list_pending_missed_services)
--      · audit: trigger `audit_missed_service_notes` เรียก `public.audit_trigger()` ตัวเดิม
--        **ไม่แทนที่ audit_trigger** (M21 กำลังแก้เนื้อ) → ตอนนี้ audit_log ของตารางนี้ไม่มี contract_id / month_key
--        (เข้า ELSE ของ CASE) · ขอ M21/BE เพิ่ม `WHEN 'missed_service_notes'` แบบเดียวกับ missed_service_resolutions
--      · `list_pending_missed_services` **ไม่แก้** — เพิ่มคอลัมน์ใน RETURNS TABLE ด้วย CREATE OR REPLACE ไม่ได้
--        (ต้อง DROP = เปลี่ยน signature) → หน้าจออ่าน `missed_service_notes` แล้วจับคู่ด้วย (contract_id, missed_month)
--   2. `oldest_open_month()` — เดือนที่ยังไม่ปิดเก่าสุด 1 แถวต่อส่วน (scope) ที่ผู้เรียกมองเห็น
--      · host เห็นทั้ง central + province · admin / recorder เห็นส่วนที่ตรงกับ division_scope ของตัวเอง
--      · กฎ "ยังไม่ปิด" (SPEC §7.7 + §9.1 + mockup #todo `TM_VIEW`):
--          เดือนเริ่มนับ (floor) = เดือนถัดจากแถว snapshot `legacy` เดือนล่าสุด (= เดือน go-live · SPEC §9.1:
--            legacy = เดือนก่อน go-live) · ยังไม่มีแถว legacy → เดือนแรกที่เคยปิดของส่วนนั้น ·
--            ยังไม่เคยปิดเลย → เดือนปัจจุบัน (ยังไม่มีอะไรให้ปิด = ไม่เตือน)
--          คำตอบ = เดือนแรกใน [floor, เดือนปัจจุบัน − 1] ที่ไม่มีแถว month_closures ของส่วนนั้น
--            (เดือนที่ข้ามไปไม่ได้ปิดก็นับ) · ปิดครบแล้ว → เดือนปัจจุบัน (ยังไม่จบ ปิดไม่ได้) · ไม่คืน NULL
--          เดือนก่อน go-live ไม่นับว่า "ค้างปิด" (เป็นข้อมูล legacy ปิดไม่ได้/ไม่ต้องปิด)
--      · `is_behind` = คำตอบเก่ากว่าเดือนปัจจุบัน (หน้าจอเปิดกล่องเตือน "ยังปิดงานเดือนก่อนไม่เสร็จ")
--      · SECURITY INVOKER — อ่านตาม RLS ของ month_closures / monthly_branch_snapshots
--   3. `list_team_new_renew(p_month date)` — สรุป New / Renew รายทีม แยกรายสาขา ของเดือนที่เลือก
--      · New = `renewed_from_contract_id` ว่าง · Renew = มีค่า (DECISIONS 2.38 ค — ไม่ใช้ sale_type)
--      · เดือน = เดือนของ `start_date` · ไม่นับสัญญายกเลิก
--      · ทีมจาก `contract_teams` (สัญญาที่มีหลายทีม นับให้ทุกทีม) · สัญญาที่ไม่มีทีม → แถว team_id = NULL
--        (ยอดรวมทั้งเดือนจะได้ตรงกับจำนวนสัญญา)
--      · **สาขา = สาขาของลูกค้า** (ทีมข้ามเขต นับตามสาขาลูกค้า — เจ้าของ 15 พ.ย.) · หน้าจอรวมแถวของทีมเป็นยอดทีม
--        แล้วแสดงแถวย่อยรายสาขาใต้ทีม
--      · คืน contract id ของแต่ละกลุ่ม (หน้าจอแสดงชื่อลูกค้า — อ่านจาก contracts/customers ตาม RLS)
--      · SECURITY INVOKER + recorder เห็นเฉพาะสาขาในขอบเขต (RLS ของ contracts ให้ recorder อ่านทุกสาขา
--        จึงกรองเพิ่มเอง — แพทเทิร์นเดียวกับ list_pending_missed_services) · บทบาทอื่น → 42501
--   * error ใหม่: ไม่มี — ใช้ 42501 / 22004 / 22001 / AG004 / MS0xx ของเดิม

-- =====================================================================
-- 1. ตารางหมายเหตุตกบริการรายเดือน
-- =====================================================================
CREATE TABLE public.missed_service_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  uuid NOT NULL REFERENCES public.contracts (id) ON DELETE CASCADE,
  missed_month date NOT NULL,
  note         text NOT NULL,
  recorded_by  uuid REFERENCES auth.users (id),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missed_service_notes_contract_month_key UNIQUE (contract_id, missed_month),
  CONSTRAINT missed_service_notes_month_first_day CHECK (missed_month = date_trunc('month', missed_month)::date),
  CONSTRAINT missed_service_notes_note_not_blank CHECK (btrim(note) <> ''),
  CONSTRAINT missed_service_notes_note_length CHECK (char_length(note) <= 200)
);

COMMENT ON TABLE public.missed_service_notes IS
  'M24: free-text note per contract per missed service month (#todo). Written through save_missed_service_note() only while the month is missed and pending.';

ALTER TABLE public.missed_service_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY missed_service_notes_select ON public.missed_service_notes
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() IN ('host', 'admin')
    OR (public.current_app_role() = 'recorder' AND public.contract_in_scope(contract_id))
  );

REVOKE ALL ON public.missed_service_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.missed_service_notes TO authenticated;
GRANT ALL ON public.missed_service_notes TO service_role;

CREATE TRIGGER audit_missed_service_notes
  AFTER INSERT OR UPDATE OR DELETE ON public.missed_service_notes
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- =====================================================================
-- 1b. RPC: บันทึก / แก้ / ลบ หมายเหตุ
-- payload: { contract_id, missed_month 'YYYY-MM-01', note (ว่าง/null = ลบ) }
-- คืน: แถวที่บันทึก (jsonb) · ลบ → { "deleted": true|false, contract_id, missed_month }
-- =====================================================================
CREATE FUNCTION public.save_missed_service_note(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contract    uuid;
  v_missed      date;
  v_note        text;
  v_is_host     boolean := is_host();
  v_now_month   date := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
  v_start_month date;
  v_term        int;
  v_cancelled   boolean;
  v_track_from  date;
  v_row         missed_service_notes%ROWTYPE;
BEGIN
  -- สิทธิ์ก่อน (คนไม่มีสิทธิ์ไม่ได้ถือ lock / ลองว่ามี id จริงไหม)
  IF NOT (v_is_host OR current_app_role() = 'recorder') THEN
    RAISE EXCEPTION 'not allowed to write missed service notes' USING ERRCODE = '42501';
  END IF;

  IF p IS NULL OR jsonb_typeof(p) <> 'object'
     OR nullif(p ->> 'contract_id', '') IS NULL OR nullif(p ->> 'missed_month', '') IS NULL THEN
    RAISE EXCEPTION 'contract_id and missed_month are required' USING ERRCODE = '22004';
  END IF;
  v_contract := (p ->> 'contract_id')::uuid;
  v_missed   := (p ->> 'missed_month')::date;
  v_note     := nullif(btrim(p ->> 'note'), '');

  -- ---------- สัญญา + ขอบเขต (ก่อนถือ lock) ----------
  IF NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = v_contract) THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;
  IF NOT (v_is_host OR contract_in_scope(v_contract)) THEN
    RAISE EXCEPTION 'not allowed to write missed service notes for this contract' USING ERRCODE = '42501';
  END IF;

  -- คิวเดียวกับ save_service_visit / resolve_missed_service ของสัญญานี้
  PERFORM pg_advisory_xact_lock(hashtextextended('public.save_service_visit:' || v_contract::text, 0));

  -- ---------- ลบหมายเหตุ (ไม่ตรวจสถานะเดือน) ----------
  IF v_note IS NULL THEN
    DELETE FROM missed_service_notes n
     WHERE n.contract_id = v_contract AND n.missed_month = v_missed;
    RETURN jsonb_build_object('deleted', FOUND, 'contract_id', v_contract, 'missed_month', v_missed);
  END IF;

  IF char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'note is too long (max 200 characters)' USING ERRCODE = '22001';
  END IF;

  -- ---------- เดือนต้อง "ตกจริงและรอตัดสิน" (เกณฑ์เดียวกับ list_pending_missed_services) ----------
  SELECT date_trunc('month', c.start_date)::date, c.term_years,
         (c.status = 'cancelled' OR c.cancelled_at IS NOT NULL),
         missed_tracking_start_month(c.start_date, c.stations_initialized_at)
    INTO v_start_month, v_term, v_cancelled, v_track_from
    FROM contracts c WHERE c.id = v_contract;
  IF v_cancelled THEN
    RAISE EXCEPTION 'the contract is cancelled' USING ERRCODE = 'MS009';
  END IF;
  IF contract_is_renewed(v_contract) THEN
    RAISE EXCEPTION 'the contract has been renewed; its open missed months are void' USING ERRCODE = 'MS011';
  END IF;
  IF v_missed <> date_trunc('month', v_missed)::date
     OR v_track_from IS NULL OR v_missed < v_track_from
     OR v_missed < v_start_month
     OR v_missed >= (v_start_month + make_interval(months => v_term * 12))::date
     OR v_missed >= v_now_month THEN
    RAISE EXCEPTION 'missed_month must be the 1st day of a past, tracked service month of this contract'
      USING ERRCODE = 'MS001';
  END IF;
  IF EXISTS (SELECT 1 FROM visits vi
              WHERE vi.contract_id = v_contract AND vi.visit_type = 'routine'
                AND vi.makeup_for_month IS NULL
                AND vi.visit_date >= v_missed
                AND vi.visit_date < (v_missed + interval '1 month')::date) THEN
    RAISE EXCEPTION 'this month has a routine visit; it was not missed' USING ERRCODE = 'MS002';
  END IF;
  IF EXISTS (SELECT 1 FROM visits vi
              WHERE vi.contract_id = v_contract AND vi.makeup_for_month = v_missed) THEN
    RAISE EXCEPTION 'this month has been made up' USING ERRCODE = 'MS005';
  END IF;
  IF EXISTS (SELECT 1 FROM missed_service_resolutions r
              WHERE r.contract_id = v_contract AND r.missed_month = v_missed AND r.kind = 'waived') THEN
    RAISE EXCEPTION 'this month is already marked as waived' USING ERRCODE = 'MS010';
  END IF;

  -- ---------- บันทึก (ผู้บันทึก = ผู้แก้ล่าสุด · ประวัติเต็มอยู่ใน audit_log) ----------
  INSERT INTO missed_service_notes AS n (contract_id, missed_month, note, recorded_by, recorded_at)
  VALUES (v_contract, v_missed, v_note, auth.uid(), now())
  ON CONFLICT (contract_id, missed_month) DO UPDATE
     SET note        = EXCLUDED.note,
         recorded_by = EXCLUDED.recorded_by,
         recorded_at = EXCLUDED.recorded_at
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

-- =====================================================================
-- 2. เดือนที่ยังไม่ปิดเก่าสุด (ต่อส่วน central / province ที่ผู้เรียกมองเห็น)
-- =====================================================================
CREATE FUNCTION public.oldest_open_month()
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

  -- go-live = เดือนถัดจาก legacy เดือนล่าสุด (SPEC §9.1) · month_key อาจเป็น 'MMM.YY' หรือ 'YYYY-MM'
  SELECT (max(to_date(normalize_month_key(s.month_key) || '-01', 'YYYY-MM-DD')) + interval '1 month')::date
    INTO v_go_live
    FROM monthly_branch_snapshots s
   WHERE s.source = 'legacy'
     AND normalize_month_key(s.month_key) ~ '^\d{4}-(0[1-9]|1[0-2])$';

  RETURN QUERY
  WITH sc AS (
    SELECT e AS scope
      FROM unnest(enum_range(NULL::closure_scope)) e
     WHERE v_role = 'host' OR e::text = ANY (coalesce(v_divs, '{}'))
  ), closed AS (
    SELECT mc.scope, to_date(mc.month_key || '-01', 'YYYY-MM-DD') AS m
      FROM month_closures mc
     WHERE mc.month_key ~ '^\d{4}-(0[1-9]|1[0-2])$'
  ), fl AS (
    SELECT sc.scope,
           least(coalesce(v_go_live, (SELECT min(cl.m) FROM closed cl WHERE cl.scope = sc.scope), v_now_month),
                 v_now_month) AS floor_month
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
-- 3. สรุป New / Renew รายทีม แยกรายสาขา (สาขาของลูกค้า) ของเดือนที่เลือก
--   p_month: วันใดก็ได้ในเดือน · NULL = เดือนปัจจุบัน (เวลาไทย)
-- =====================================================================
CREATE FUNCTION public.list_team_new_renew(p_month date DEFAULT NULL)
RETURNS TABLE (
  team_id            uuid,
  branch_id          uuid,
  new_count          int,
  renew_count        int,
  new_contract_ids   uuid[],
  renew_contract_ids uuid[]
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role  text := current_app_role();
  v_month date;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'not allowed to read team summaries' USING ERRCODE = '42501';
  END IF;
  v_month := date_trunc('month', coalesce(p_month, (now() AT TIME ZONE 'Asia/Bangkok')::date))::date;

  RETURN QUERY
  SELECT t.team_id,
         cu.branch_id,
         (count(*) FILTER (WHERE c.renewed_from_contract_id IS NULL))::int,
         (count(*) FILTER (WHERE c.renewed_from_contract_id IS NOT NULL))::int,
         coalesce(array_agg(c.id ORDER BY c.start_date, c.id) FILTER (WHERE c.renewed_from_contract_id IS NULL),
                  '{}'::uuid[]),
         coalesce(array_agg(c.id ORDER BY c.start_date, c.id) FILTER (WHERE c.renewed_from_contract_id IS NOT NULL),
                  '{}'::uuid[])
    FROM contracts c
    JOIN customers cu ON cu.id = c.customer_id
    LEFT JOIN contract_teams t ON t.contract_id = c.id
   WHERE c.start_date >= v_month
     AND c.start_date < (v_month + interval '1 month')::date
     AND c.status <> 'cancelled' AND c.cancelled_at IS NULL
     AND (v_role <> 'recorder' OR branch_in_scope(cu.branch_id))
   GROUP BY t.team_id, cu.branch_id
   ORDER BY t.team_id NULLS LAST, cu.branch_id;
END;
$$;

-- =====================================================================
-- 4. สิทธิ์ function (ทุกตัวในไฟล์นี้)
-- =====================================================================
REVOKE ALL ON FUNCTION public.save_missed_service_note(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_missed_service_note(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.oldest_open_month() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.oldest_open_month() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_team_new_renew(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_team_new_renew(date) TO authenticated, service_role;
