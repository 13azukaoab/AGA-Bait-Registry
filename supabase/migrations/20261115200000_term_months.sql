-- =====================================================================
-- M30 — ระยะสัญญาเป็นเดือน 1–36 + สัญญาสั้น / Custom (DECISIONS 2.53 · เจ้าของอนุมัติ 16 พ.ย. 2026)
--
-- สรุป logic (ทีมอ่านตรงนี้ก่อน):
--   * contracts.term_months (1–36) = แหล่งข้อมูลเดียวของระยะสัญญา (แบบ ก ของหมวด 2)
--       12 = 1 ปี · 36 = 3 ปี · ความยาวอื่นทั้งหมด = "Custom"
--   * contracts.term_years = กระจกชั่วคราว (1 เมื่อ 12 · 3 เมื่อ 36 · NULL เมื่อ Custom) — ลบใน M30b หลัง FE ย้ายเสร็จ
--       CHECK contracts_term_years_mirror_check บังคับให้ตรงกันเสมอ
--   * trigger contracts_00_term_sync (ชื่อขึ้นต้น 00 → รันก่อน BEFORE trigger อื่นของ contracts ที่เรียงตามชื่อ)
--       ลำดับความสำคัญ: ส่ง term_months → term_years ตามมาเอง · ส่งแต่ term_years (ผู้เขียนแบบเดิม) → term_months = ปี × 12
--       ส่งทั้งคู่แต่ไม่ตรงกัน → AG016 · term_years อื่นที่ไม่ใช่ 1/3 (เช่น 2) → CHECK เดิมปฏิเสธ (23514)
--       UPDATE: คอลัมน์ที่ค่าเท่าเดิม (IS NOT DISTINCT FROM OLD) = ถือว่า "ไม่ได้ส่ง" → เปลี่ยนเดือนพร้อมส่งปีค่าเดิมซ้ำ
--         = เดือนชนะ ปีตามเป็นกระจกเอง (ไม่ error) · AG016 เฉพาะเมื่อเปลี่ยนทั้งสองคอลัมน์แล้วขัดกัน
--   * ลำดับ migration: ต้องมาหลัง 20261115190000 (M26/33) — ไฟล์นั้นมี save_job_opening / ig_collection_apply แบบปี
--       ถ้ารันทีหลังจะได้ function ซ้อน/สูตรปีกลับมา · เทส 45 มีด่านตรวจว่าไม่มี function ไหนคิดเลขจาก term_years เหลือ
--   * สูตร (ตรงกับ lib/rules/term.ts + date.ts — แก้ฝั่งหนึ่งต้องแก้อีกฝั่ง):
--       เดือนบริการ = เดือนเริ่ม ต่อเนื่อง term_months เดือน (แทน term_years × 12)
--       วันจบอัตโนมัติ = เริ่ม + term_months เดือน − 1 วัน ชนปลายเดือน (contract_default_end_date)
--         เช่น 31 ม.ค. + 1 เดือน → 28 ก.พ. · 15 ม.ค. + 5 → 14 มิ.ย. · 29 ก.พ. 2028 + 12 → 28 ก.พ. 2029 (เท่าสูตรปีเดิม)
--   * ทุกฟังก์ชันที่เคยใช้ term_years ถูกสร้างใหม่จากเนื้อ "ล่าสุด" แก้เฉพาะจุด (ดูหัวข้อ 5–13)
--   * ไม่แตะ audit_trigger · RLS เดิมทั้งหมดคงเดิม · ไม่มีการเปลี่ยนรูปแบบ dashboard_data.json
--   * มูลค่าจัด Tier (< 12 เดือน = มูลค่าจริง) และ snapshot คำนวณใน lib/rules (ไม่มีสูตร Tier ใน SQL)
-- =====================================================================

-- =====================================================================
-- 1. คอลัมน์ + backfill
-- =====================================================================
ALTER TABLE public.contracts ADD COLUMN term_months smallint;

-- backfill แบบกลไก (ค่าเดิมทุกแถว 1/3 ปี → 12/36 เดือน · ความหมายข้อมูลไม่เปลี่ยน)
--   ปิดเฉพาะ contracts_set_updated_at ชั่วคราว: ไม่ให้ updated_at ขยับทุกสัญญา (หน้าจอที่เปิดค้างจะโดน AG008 ทั้งระบบ)
--   audit_contracts ยังทำงาน (กฎ CLAUDE ข้อ 7: ทุกการแก้ลง audit_log) · trigger อื่นไม่ฟัง term_months / ข้ามเมื่อไม่ใช่ authenticated
--   ปิด/เปิดอยู่ใน transaction เดียวกับ migration
ALTER TABLE public.contracts DISABLE TRIGGER contracts_set_updated_at;
UPDATE public.contracts SET term_months = term_years * 12;
ALTER TABLE public.contracts ENABLE TRIGGER contracts_set_updated_at;

ALTER TABLE public.contracts
  ALTER COLUMN term_months SET NOT NULL,
  ALTER COLUMN term_years DROP NOT NULL,                   -- Custom = NULL (CHECK เดิม term_years IN (1, 3) ยังคุมค่าที่ไม่ NULL)
  ADD CONSTRAINT contracts_term_months_check CHECK (term_months BETWEEN 1 AND 36),
  ADD CONSTRAINT contracts_term_years_mirror_check
    CHECK (term_years IS NOT DISTINCT FROM (CASE term_months WHEN 12 THEN 1 WHEN 36 THEN 3 END));

COMMENT ON COLUMN public.contracts.term_months IS
  'M30: ระยะสัญญา (เดือน 1–36) แหล่งข้อมูลหลัก · 12 = 1 ปี · 36 = 3 ปี · อื่น = Custom';
COMMENT ON COLUMN public.contracts.term_years IS
  'M30: กระจกชั่วคราวของ term_months (12 → 1 · 36 → 3 · Custom → NULL) · trigger contracts_00_term_sync ดูแล · ลบใน M30b';

-- =====================================================================
-- 2. ตัวช่วย (pure — ไม่อ่านตาราง)
-- =====================================================================
-- กระจกปี: 12 → 1 · 36 → 3 · อื่น → NULL
CREATE FUNCTION public.contract_term_years_of(p_term_months integer)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT (CASE p_term_months WHEN 12 THEN 1 WHEN 36 THEN 3 END)::smallint
$$;

-- วันจบอัตโนมัติ = เริ่ม + N เดือน − 1 วัน ชนปลายเดือน (= lib/rules addMonthsMinusDay)
--   Postgres `date + N months` ชนปลายเดือนให้อยู่แล้ว (31 ม.ค. + 1 เดือน = 28 ก.พ.) → วันที่ของผลน้อยกว่าวันเริ่ม
--   = เดือนปลายทางสั้นกว่า → จบวันนั้นเลย (ไม่ลบ 1 วัน) · ไม่งั้น − 1 วัน (15 ม.ค. + 5 → 15 มิ.ย. − 1 = 14 มิ.ย.)
--   (ห้ามใช้ `date + interval - 1 day` ตรงๆ: 31 ม.ค. + 1 เดือน − 1 วัน = 27 ก.พ.)
CREATE FUNCTION public.contract_default_end_date(p_start_date date, p_term_months integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
           WHEN extract(day FROM p_start_date + make_interval(months => p_term_months))
                < extract(day FROM p_start_date)
             THEN (p_start_date + make_interval(months => p_term_months))::date
           ELSE (p_start_date + make_interval(months => p_term_months) - interval '1 day')::date
         END
$$;

REVOKE ALL ON FUNCTION public.contract_term_years_of(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contract_default_end_date(date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_term_years_of(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contract_default_end_date(date, integer) TO authenticated, service_role;

-- =====================================================================
-- 3. ตัวช่วย M28 รับ "เดือน" แทน "ปี" — ชื่อพารามิเตอร์เปลี่ยน (CREATE OR REPLACE เปลี่ยนชื่อไม่ได้)
--    → DROP + CREATE + สิทธิ์เดิม · ชนิดพารามิเตอร์เดิม (date, date, integer) — ผู้เรียกทุกตัวในระบบถูกแก้ให้ส่ง
--    term_months ในไฟล์นี้แล้ว (contracts_renewed_gap_guard · contract_is_renewed · save_job_opening · ig_collection_apply)
-- =====================================================================
DROP FUNCTION public.renewal_gap_ok(date, date, integer, date);
DROP FUNCTION public.renewal_latest_start_month(date, date, integer);
DROP FUNCTION public.contract_effective_end_date(date, date, integer);

-- วันจบที่ใช้จริง = end_date · ว่าง = contract_default_end_date (เริ่ม + N เดือน − 1 วัน ชนปลายเดือน)
CREATE FUNCTION public.contract_effective_end_date(p_start_date date, p_end_date date, p_term_months integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(p_end_date, public.contract_default_end_date(p_start_date, p_term_months))
$$;

-- เดือนสุดท้ายที่สัญญาใหม่ยังเริ่มแบบ Renew ได้ (วันที่ 1 ของเดือน) — เนื้อเดิม M28 · เปลี่ยนชื่อพารามิเตอร์
CREATE FUNCTION public.renewal_latest_start_month(p_old_start date, p_old_end date, p_old_term_months integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT (date_trunc('month', public.contract_effective_end_date(p_old_start, p_old_end, p_old_term_months))
          + interval '2 months')::date
$$;

-- สัญญาใหม่ที่เริ่ม p_new_start นับเป็น Renew ของสัญญาเก่าได้ไหม (NULL เข้า → false) — เนื้อเดิม M28
CREATE FUNCTION public.renewal_gap_ok(p_old_start date, p_old_end date, p_old_term_months integer, p_new_start date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    p_new_start > p_old_start
    AND date_trunc('month', p_new_start)::date
        <= public.renewal_latest_start_month(p_old_start, p_old_end, p_old_term_months),
    false)
$$;

REVOKE ALL ON FUNCTION public.contract_effective_end_date(date, date, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.renewal_latest_start_month(date, date, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.renewal_gap_ok(date, date, integer, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_effective_end_date(date, date, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.renewal_latest_start_month(date, date, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.renewal_gap_ok(date, date, integer, date) TO authenticated, service_role;

-- =====================================================================
-- 4. trigger กระจก term_years ↔ term_months (ทุกทาง: RPC, REST, service_role, migration ภายหลัง)
--    ชื่อ contracts_00_… → รันก่อน BEFORE trigger อื่นของ contracts (เรียงตามชื่อ) เช่น contracts_renewed_gap_guard
--    UPDATE: ดูว่าคอลัมน์ไหน "ถูกเปลี่ยน" (IS DISTINCT FROM OLD) — ผู้เขียนแบบเดิมที่ส่งแต่ term_years ยังใช้ได้
-- =====================================================================
CREATE FUNCTION public.contracts_term_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_months_changed boolean;
  v_years_changed  boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_months_changed := NEW.term_months IS NOT NULL;
    v_years_changed  := NEW.term_years IS NOT NULL;
  ELSE
    v_months_changed := NEW.term_months IS DISTINCT FROM OLD.term_months;
    v_years_changed  := NEW.term_years IS DISTINCT FROM OLD.term_years;
  END IF;

  IF v_months_changed AND v_years_changed THEN
    IF NEW.term_years IS DISTINCT FROM public.contract_term_years_of(NEW.term_months) THEN
      RAISE EXCEPTION 'term_years does not match term_months'
        USING ERRCODE = 'AG016',
              HINT = 'ส่งระยะสัญญาเป็นเดือน (term_months) อย่างเดียว — term_years ระบบตั้งให้เอง';
    END IF;
  ELSIF v_months_changed THEN
    NEW.term_years := public.contract_term_years_of(NEW.term_months);
  ELSIF v_years_changed THEN
    -- ผู้เขียนแบบเดิม (ส่งแต่ปี) · term_years ไม่ถูกเขียนทับ → ค่าผิด (เช่น 2) ยังโดน CHECK เดิม (23514)
    NEW.term_months := NEW.term_years * 12;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.contracts_term_sync() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER contracts_00_term_sync
  BEFORE INSERT OR UPDATE OF term_years, term_months ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_term_sync();

-- =====================================================================
-- 5. visits_makeup_link_guard — เนื้อเดิม 20261114200000 · แก้: อ่าน term_months · เดือนสุดท้าย = เริ่ม + เดือน − 1
--    (signature เดิม · CREATE OR REPLACE คง trigger/สิทธิ์เดิม)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.visits_makeup_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_missed      date := NEW.makeup_for_month;
  v_visit_month date := date_trunc('month', NEW.visit_date)::date;
  v_today       date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_now_month   date := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
  v_link_change boolean;
  v_start_date  date;
  v_initialized timestamptz;
  v_start_month date;
  v_term        int;
  v_cancelled   boolean;
  v_last_month  date;
  v_track_from  date;
  v_kind        public.missed_resolution_kind;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_link_change := NEW.makeup_for_month IS NOT NULL;
  ELSE
    v_link_change := NEW.makeup_for_month IS DISTINCT FROM OLD.makeup_for_month
                     OR (OLD.makeup_for_month IS NOT NULL AND NEW.contract_id IS DISTINCT FROM OLD.contract_id);
  END IF;
  -- ผู้ใช้ (มี auth.uid) เปลี่ยนการผูกได้เฉพาะผ่าน RPC · service_role / ระบบไม่ติด
  IF v_link_change AND auth.uid() IS NOT NULL
     AND coalesce(current_setting('aga.makeup_link', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'make-up links are changed through save_makeup_service_visit' USING ERRCODE = '42501';
  END IF;

  -- เลิกผูก / ย้ายการผูกของการเข้าเดิม: สัญญายกเลิก (MS009) / ต่อแล้ว (MS011) ห้าม — ผลที่บันทึกไว้ต้องคงไว้ (2.47)
  IF TG_OP = 'UPDATE' AND v_link_change AND OLD.makeup_for_month IS NOT NULL THEN
    -- FOR SHARE: กันแข่งกับการยกเลิกสัญญาที่กำลังเกิดพร้อมกัน (การยกเลิกไม่ถือ advisory lock)
    IF EXISTS (SELECT 1 FROM contracts c WHERE c.id = OLD.contract_id
                AND (c.status = 'cancelled' OR c.cancelled_at IS NOT NULL) FOR SHARE) THEN
      RAISE EXCEPTION 'the contract is cancelled' USING ERRCODE = 'MS009';
    END IF;
    IF contract_is_renewed(OLD.contract_id) THEN
      RAISE EXCEPTION 'the contract has been renewed; recorded outcomes are kept' USING ERRCODE = 'MS011';
    END IF;
  END IF;

  IF v_missed IS NULL THEN
    RETURN NEW;
  END IF;
  -- แก้ช่องอื่นของการเข้าที่ผูกอยู่ (การผูก/สัญญา/ชนิด/เดือนเดิม) → ไม่ตรวจซ้ำ
  IF TG_OP = 'UPDATE' AND NOT v_link_change
     AND NEW.visit_type IS NOT DISTINCT FROM OLD.visit_type
     AND date_trunc('month', NEW.visit_date) = date_trunc('month', OLD.visit_date)
     AND NEW.visit_date <= v_today THEN
    RETURN NEW;
  END IF;
  -- ผู้ใช้ต้องเป็น host หรือ recorder ในขอบเขตของสัญญา (ก่อนอ่านข้อมูลใดๆ)
  IF auth.uid() IS NOT NULL
     AND NOT (is_host() OR (current_app_role() = 'recorder' AND contract_in_scope(NEW.contract_id))) THEN
    RAISE EXCEPTION 'not allowed to record service for this contract' USING ERRCODE = '42501';
  END IF;
  -- คิวเดียวกับ resolve_missed_service / save_service_visit ของสัญญานี้
  PERFORM pg_advisory_xact_lock(hashtextextended('public.save_service_visit:' || NEW.contract_id::text, 0));

  SELECT c.start_date, c.stations_initialized_at, c.term_months,
         (c.status = 'cancelled' OR c.cancelled_at IS NOT NULL)
    INTO v_start_date, v_initialized, v_term, v_cancelled
    FROM contracts c WHERE c.id = NEW.contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;
  IF v_cancelled THEN
    RAISE EXCEPTION 'the contract is cancelled' USING ERRCODE = 'MS009';
  END IF;
  -- 2.47: ลูกค้าต่อสัญญาแล้ว → ตกบริการที่ค้างเป็นโมฆะ ผูกการเข้าชดเชยใหม่ไม่ได้
  --   (การเข้าชดเชยที่ผูกไว้ก่อนต่อสัญญา = ผลที่คงไว้ แก้วันที่/ข้ามเดือนได้ตามด่านอื่น)
  IF v_link_change AND contract_is_renewed(NEW.contract_id) THEN
    RAISE EXCEPTION 'the contract has been renewed; its open missed months are void' USING ERRCODE = 'MS011';
  END IF;
  v_start_month := date_trunc('month', v_start_date)::date;
  v_last_month  := (v_start_month + make_interval(months => v_term - 1))::date;
  v_track_from  := missed_tracking_start_month(v_start_date, v_initialized);

  -- เดือนที่ตก: เดือนบริการ (กฎข้อ 5) ที่ผ่านไปแล้ว · ตั้งแต่เดือนเริ่มนับ (ตั้งสถานี) · และตกจริง
  IF v_track_from IS NULL OR v_missed < v_track_from
     OR v_missed < v_start_month OR v_missed > v_last_month OR v_missed >= v_now_month THEN
    RAISE EXCEPTION 'makeup_for_month must be a past, tracked service month of this contract' USING ERRCODE = 'MS001';
  END IF;
  IF EXISTS (SELECT 1 FROM visits vi
              WHERE vi.contract_id = NEW.contract_id AND vi.id <> NEW.id
                AND vi.visit_type = 'routine' AND vi.makeup_for_month IS NULL
                AND date_trunc('month', vi.visit_date)::date = v_missed) THEN
    RAISE EXCEPTION 'this month has a routine visit; it was not missed' USING ERRCODE = 'MS002';
  END IF;

  -- การเข้าชดเชย: routine · อยู่หลังเดือนที่ตก · ไม่ลงวันที่ล่วงหน้า
  IF NEW.visit_type <> 'routine' THEN
    RAISE EXCEPTION 'a make-up visit must be a routine visit' USING ERRCODE = 'MS006';
  END IF;
  IF v_visit_month <= v_missed THEN
    RAISE EXCEPTION 'a make-up visit must be after the missed month' USING ERRCODE = 'MS006';
  END IF;
  IF NEW.visit_date > v_today THEN
    RAISE EXCEPTION 'a make-up visit cannot be dated in the future' USING ERRCODE = 'MS006';
  END IF;
  -- เพดานเวลา (เจ้าของยืนยัน 14 พ.ย. 2026 (DECISIONS 2.45)): recorder เท่านั้นที่ติด · host บันทึกได้
  IF current_app_role() = 'recorder'
     AND greatest(v_visit_month, v_now_month)
         > (v_last_month + make_interval(months => missed_makeup_deadline_months()))::date THEN
    RAISE EXCEPTION 'the make-up deadline has passed; mark it as waived or ask host' USING ERRCODE = 'MS008';
  END IF;

  SELECT r.kind INTO v_kind FROM missed_service_resolutions r
   WHERE r.contract_id = NEW.contract_id AND r.missed_month = v_missed
     FOR UPDATE;
  IF FOUND AND v_kind = 'waived' THEN
    RAISE EXCEPTION 'this month is already marked as waived' USING ERRCODE = 'MS010';
  END IF;

  INSERT INTO missed_service_resolutions AS r (contract_id, missed_month, kind, makeup_month, decided_by, decided_at)
  VALUES (NEW.contract_id, v_missed, 'makeup', v_visit_month, auth.uid(), now())
  ON CONFLICT (contract_id, missed_month) DO UPDATE
     SET makeup_month = EXCLUDED.makeup_month,
         decided_by   = EXCLUDED.decided_by,
         decided_at   = EXCLUDED.decided_at
   WHERE r.makeup_month IS DISTINCT FROM EXCLUDED.makeup_month;
  RETURN NEW;
END;
$$;


-- =====================================================================
-- 6. resolve_missed_service — เนื้อเดิม 20261114200000 · แก้: term_months แทน term_years × 12
-- =====================================================================
CREATE OR REPLACE FUNCTION public.resolve_missed_service(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contract    uuid;
  v_missed      date;
  v_reason      text := nullif(btrim(p ->> 'reason'), '');
  v_evidence    text := nullif(btrim(p ->> 'evidence_path'), '');
  v_role        text := current_app_role();
  v_is_host     boolean := is_host();
  v_now_month   date := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
  v_start_month date;
  v_term        int;
  v_cancelled   boolean;
  v_track_from  date;
  v_row         missed_service_resolutions%ROWTYPE;
BEGIN
  -- สิทธิ์ก่อน (คนไม่มีสิทธิ์ไม่ได้ถือ lock / ลองว่ามี id จริงไหม)
  IF NOT (v_is_host OR v_role = 'recorder') THEN
    RAISE EXCEPTION 'not allowed to resolve missed service' USING ERRCODE = '42501';
  END IF;

  IF p IS NULL OR jsonb_typeof(p) <> 'object'
     OR nullif(p ->> 'contract_id', '') IS NULL OR nullif(p ->> 'missed_month', '') IS NULL THEN
    RAISE EXCEPTION 'contract_id and missed_month are required' USING ERRCODE = '22004';
  END IF;
  IF p ? 'kind' AND (p ->> 'kind') IS DISTINCT FROM 'waived' THEN
    RAISE EXCEPTION 'only waived can be decided here; a make-up is recorded as a visit' USING ERRCODE = '22023';
  END IF;
  v_contract := (p ->> 'contract_id')::uuid;
  v_missed   := (p ->> 'missed_month')::date;

  -- ---------- สัญญา + ขอบเขต (ก่อนถือ lock — คนนอกขอบเขตไม่ได้ถือคิวของสาขาอื่น) ----------
  IF NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = v_contract) THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;
  IF NOT (v_is_host OR contract_in_scope(v_contract)) THEN
    RAISE EXCEPTION 'not allowed to resolve missed service for this contract' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.save_service_visit:' || v_contract::text, 0));

  SELECT date_trunc('month', c.start_date)::date, c.term_months,
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

  -- ---------- เดือนที่ตก (ตั้งแต่เดือนเริ่มนับ = ตั้งสถานี · 2.46 — เกณฑ์เดียวกับรายการรอตัดสิน) ----------
  IF v_missed <> date_trunc('month', v_missed)::date
     OR v_track_from IS NULL OR v_missed < v_track_from
     OR v_missed < v_start_month
     OR v_missed >= (v_start_month + make_interval(months => v_term))::date
     OR v_missed >= v_now_month THEN
    RAISE EXCEPTION 'missed_month must be the 1st day of a past service month of this contract'
      USING ERRCODE = 'MS001';
  END IF;
  IF EXISTS (SELECT 1 FROM visits vi
              WHERE vi.contract_id = v_contract AND vi.visit_type = 'routine'
                AND vi.makeup_for_month IS NULL
                AND date_trunc('month', vi.visit_date)::date = v_missed) THEN
    RAISE EXCEPTION 'this month has a routine visit; it was not missed' USING ERRCODE = 'MS002';
  END IF;

  -- ---------- ชดเชยแล้ว → เปลี่ยนเป็นไม่ชดเชยไม่ได้ ----------
  IF EXISTS (SELECT 1 FROM visits vi
              WHERE vi.contract_id = v_contract AND vi.makeup_for_month = v_missed) THEN
    RAISE EXCEPTION 'a make-up visit is linked to this month; unlink or delete that visit first'
      USING ERRCODE = 'MS005';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'a reason is required when no make-up is given' USING ERRCODE = 'MS004';
  END IF;
  IF char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'reason is too long' USING ERRCODE = '22001';
  END IF;

  -- ---------- หลักฐาน ----------
  IF v_evidence IS NOT NULL THEN
    IF char_length(v_evidence) > 300
       OR v_evidence !~* ('^' || v_contract::text || '/[^/]+$')
       OR NOT EXISTS (SELECT 1 FROM storage.objects o
                       WHERE o.bucket_id = 'missed-service-evidence' AND o.name = v_evidence)
       OR EXISTS (SELECT 1 FROM storage_deletion_queue q
                   WHERE q.bucket = 'missed-service-evidence' AND q.path = v_evidence AND q.done_at IS NULL) THEN
      RAISE EXCEPTION 'evidence file not found for this contract' USING ERRCODE = 'MS007';
    END IF;
  END IF;

  -- ---------- บันทึก (แถว makeup ที่ค้างโดยไม่มีการเข้าผูก ถูกเขียนทับเป็น waived ได้) ----------
  INSERT INTO missed_service_resolutions AS r
         (contract_id, missed_month, kind, makeup_month, reason, evidence_path, decided_by, decided_at)
  VALUES (v_contract, v_missed, 'waived', NULL, v_reason, v_evidence, auth.uid(), now())
  ON CONFLICT (contract_id, missed_month) DO UPDATE
     SET kind          = EXCLUDED.kind,
         makeup_month  = NULL,
         reason        = EXCLUDED.reason,
         evidence_path = EXCLUDED.evidence_path,
         decided_by    = EXCLUDED.decided_by,
         decided_at    = EXCLUDED.decided_at
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;


-- =====================================================================
-- 7. save_missed_service_note — เนื้อเดิม 20261115140000 · แก้: term_months แทน term_years × 12
-- =====================================================================
CREATE OR REPLACE FUNCTION public.save_missed_service_note(p jsonb)
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
     OR nullif(p ->> 'contract_id', '') IS NULL OR nullif(p ->> 'missed_month', '') IS NULL
     OR NOT (p ? 'note') THEN
    -- key note บังคับ (ลบ = ส่ง "" หรือ null มาเองชัดๆ) — กัน client ลืมส่งแล้วหมายเหตุหายเงียบ
    RAISE EXCEPTION 'contract_id, missed_month and note are required' USING ERRCODE = '22004';
  END IF;
  v_contract := (p ->> 'contract_id')::uuid;
  v_missed   := (p ->> 'missed_month')::date;
  -- ตัดช่องว่าง/tab/ขึ้นบรรทัด/NBSP/zero-width space หัวท้าย (ชุดเดียวกับ CHECK ของตาราง)
  v_note     := nullif(btrim(p ->> 'note', E' \t\r\n\u00a0\u200b'), '');

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
  SELECT date_trunc('month', c.start_date)::date, c.term_months,
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
     OR v_missed >= (v_start_month + make_interval(months => v_term))::date
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
-- 8. list_pending_missed_services — เนื้อเดิม 20261115180000 (M28) · แก้: เดือนสุดท้าย = เริ่ม + term_months − 1
--    (เพดานชดเชย makeup_deadline = เดือนสุดท้าย + missed_makeup_deadline_months() — จึงใช้วันจบจริงของสัญญาสั้นเอง)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.list_pending_missed_services(p_branch_id uuid DEFAULT NULL, p_month date DEFAULT NULL)
RETURNS TABLE (
  contract_id           uuid,
  customer_id           uuid,
  branch_id             uuid,
  missed_month          date,
  last_service_month    date,
  makeup_deadline_month date,
  past_deadline         boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role      text := current_app_role();
  v_now_month date := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
  v_upto      date;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'not allowed to read missed services' USING ERRCODE = '42501';
  END IF;
  v_upto := least(coalesce(date_trunc('month', p_month)::date, v_now_month), v_now_month);

  RETURN QUERY
  WITH c AS (
    SELECT ct.id AS contract_id, cu.id AS customer_id, cu.branch_id,
           missed_tracking_start_month(ct.start_date, ct.stations_initialized_at) AS track_from,
           (date_trunc('month', ct.start_date) + make_interval(months => ct.term_months - 1))::date AS last_month
      FROM contracts ct
      JOIN customers cu ON cu.id = ct.customer_id
     WHERE ct.status <> 'cancelled' AND ct.cancelled_at IS NULL
       AND NOT contract_is_renewed(ct.id)                         -- 2.47 + 2.51 ถูกแทนแล้ว (Renew / New ที่ใหม่กว่า)
       AND ct.stations_initialized_at IS NOT NULL
       AND (p_branch_id IS NULL OR cu.branch_id = p_branch_id)
       AND (v_role <> 'recorder' OR contract_in_scope(ct.id))
  ), m AS (
    SELECT c.*, gs::date AS missed_month
      FROM c,
           generate_series(c.track_from, least(c.last_month, (v_upto - interval '1 month')::date),
                           interval '1 month') gs
  )
  SELECT m.contract_id, m.customer_id, m.branch_id, m.missed_month, m.last_month,
         (m.last_month + make_interval(months => missed_makeup_deadline_months()))::date,
         v_now_month > (m.last_month + make_interval(months => missed_makeup_deadline_months()))::date
    FROM m
   WHERE NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = m.contract_id AND vi.visit_type = 'routine'
                        AND vi.makeup_for_month IS NULL
                        AND vi.visit_date >= m.missed_month
                        AND vi.visit_date < (m.missed_month + interval '1 month')::date)
     AND NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = m.contract_id AND vi.makeup_for_month = m.missed_month)
     AND NOT EXISTS (SELECT 1 FROM missed_service_resolutions r
                      WHERE r.contract_id = m.contract_id AND r.missed_month = m.missed_month
                        AND r.kind = 'waived')
   ORDER BY m.branch_id, m.customer_id, m.contract_id, m.missed_month;
END;
$$;


-- =====================================================================
-- 9. ig_collection_apply — เนื้อเดิม 20261115190000_team_active_rest_guards.sql (M26/33) · แก้: วันจบ = contract_effective_end_date (term_months · ชนปลายเดือน)
--    เดิมใช้ start + interval N ปี − 1 วัน (29 ก.พ. + 1 ปี − 1 = 27 ก.พ. ไม่ตรง lib/rules) · ตอนนี้ตรงกฎเดียวกันทั้งระบบ
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

  SELECT c.id, c.status, c.start_date, c.end_date, c.term_months, c.cancelled_at, c.closed_at INTO v_ct
    FROM public.contracts c WHERE c.id = p_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบสัญญา' USING ERRCODE = 'AG004';
  END IF;
  IF NOT coalesce(public.is_host()
                  OR (public.current_app_role() = 'recorder' AND public.contract_in_scope(p_contract_id)), false) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์บันทึกการเก็บสถานีของสัญญานี้' USING ERRCODE = '42501';
  END IF;

  -- สัญญาต้องจบแล้ว (วันสิ้นสุด = end_date หรือ เริ่ม + N เดือน − 1 วัน ชนปลายเดือน · M30 defaultEndDateForTerm)
  v_end := public.contract_effective_end_date(v_ct.start_date, v_ct.end_date, v_ct.term_months);
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
-- 10. contract_is_renewed — เนื้อเดิม 20261115180000 (M28) · แก้: ส่ง term_months ให้ contract_effective_end_date
-- =====================================================================
CREATE OR REPLACE FUNCTION public.contract_is_renewed(p_contract_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM contracts o
      JOIN contracts n ON n.id <> o.id
     WHERE o.id = p_contract_id
       AND n.status <> 'cancelled' AND n.cancelled_at IS NULL
       AND (n.renewed_from_contract_id = o.id
            OR (n.renewed_from_contract_id IS NULL
                AND n.customer_id = o.customer_id
                AND n.start_date > contract_effective_end_date(o.start_date, o.end_date, o.term_months))))
$$;


-- =====================================================================
-- 11. contracts_renewed_gap_guard — เนื้อเดิม 20261115180000 (M28) · แก้: อ่าน/เทียบ term_months
--     (trigger contracts_00_term_sync รันก่อน [ชื่อเรียงก่อน] → NEW.term_months ตรงกับ term_years แล้วเสมอ)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.contracts_renewed_gap_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_start date;
  v_old_end   date;
  v_old_term  integer;
  v_latest    date;
  v_was_unlinked boolean := false;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- ---------- รอบ 2: Renew ไม่ผูกสัญญาเก่า (ข้ามกฎ 2 เดือน · ต้องมีเหตุผล · เปิดได้ถึงวันที่กำหนด) ----------
  IF NEW.sale_type = 'renew' AND NEW.renewed_from_contract_id IS NULL THEN
    IF TG_OP = 'UPDATE' THEN
      -- ยกเลิกแล้วกลับมาใช้ (un-cancel) = นับเหมือนเพิ่ง "กลายเป็น" Renew ไม่ผูก → ตรวจเหตุผล + วันกำหนดใหม่ (ผลตรวจ Opus รอบ 2)
      v_was_unlinked := coalesce(OLD.sale_type = 'renew' AND OLD.renewed_from_contract_id IS NULL
                                 AND NOT (OLD.status = 'cancelled' AND NEW.status <> 'cancelled'), false);
    END IF;
    IF (NOT v_was_unlinked OR NEW.renew_unlinked_reason IS DISTINCT FROM OLD.renew_unlinked_reason)
       AND coalesce(btrim(NEW.renew_unlinked_reason), '') = '' THEN
      RAISE EXCEPTION 'a renewal without a link to the old contract needs a reason'
        USING ERRCODE = 'AG012',
              HINT = 'Renew ที่ไม่ผูกสัญญาเก่า ต้องระบุเหตุผล (เช่น สัญญาเก่าไม่อยู่ในระบบ)';
    END IF;
    IF NOT v_was_unlinked AND NOT public.unlinked_renew_open() THEN
      RAISE EXCEPTION 'renewals without a link to the old contract are no longer allowed'
        USING ERRCODE = 'AG013', DETAIL = to_char(public.allow_unlinked_renew_until(), 'YYYY-MM-DD'),
              HINT = 'เลยช่วงที่เปิด Renew แบบไม่ผูกสัญญาเก่าได้แล้ว — เลือกสัญญาเก่าที่ต่อ หรือเปิดเป็นลูกค้าใหม่ (New)';
    END IF;
  END IF;

  -- ---------- ฝั่งสัญญาใหม่ (สัญญานี้ผูกสัญญาเก่า) ----------
  IF NEW.renewed_from_contract_id IS NOT NULL
     AND NEW.renewed_from_contract_id IS DISTINCT FROM NEW.id          -- ชี้ตัวเอง → CHECK constraint ปฏิเสธเอง
     AND (TG_OP = 'INSERT'
          OR NEW.start_date IS DISTINCT FROM OLD.start_date
          OR NEW.sale_type IS DISTINCT FROM OLD.sale_type
          OR NEW.renewed_from_contract_id IS DISTINCT FROM OLD.renewed_from_contract_id
          OR (OLD.status = 'cancelled' AND NEW.status <> 'cancelled')) THEN
    IF NEW.sale_type IS DISTINCT FROM 'renew' THEN
      RAISE EXCEPTION 'a contract linked to an old contract must have sale_type renew'
        USING ERRCODE = 'AG011',
              HINT = 'สัญญาที่ผูกกับสัญญาเก่าต้องเป็นประเภท Renew — ถ้าเป็นลูกค้าใหม่ (New) ไม่ต้องผูกสัญญาเก่า';
    END IF;
    -- คิวเดียวกับฝั่งสัญญาเก่า (ด้านล่าง) — อ่านวันที่หลังได้ lock (READ COMMITTED: snapshot ใหม่ต่อคำสั่ง)
    PERFORM pg_advisory_xact_lock(hashtextextended('public.contracts.renewal:' || NEW.renewed_from_contract_id::text, 0));
    SELECT o.start_date, o.end_date, o.term_months
      INTO v_old_start, v_old_end, v_old_term
      FROM public.contracts o
     WHERE o.id = NEW.renewed_from_contract_id;
    IF FOUND AND NOT public.renewal_gap_ok(v_old_start, v_old_end, v_old_term, NEW.start_date) THEN
      v_latest := public.renewal_latest_start_month(v_old_start, v_old_end, v_old_term);
      IF NEW.start_date <= v_old_start THEN
        RAISE EXCEPTION 'a renewal must start after the old contract starts'
          USING ERRCODE = 'AG010', DETAIL = to_char(v_latest, 'YYYY-MM'),
                HINT = 'วันเริ่มสัญญาใหม่ต้องอยู่หลังวันเริ่มสัญญาเก่า — ตรวจวันที่ หรือเปิดเป็นลูกค้าใหม่ (New)';
      END IF;
      RAISE EXCEPTION 'a renewal must start within 2 months after the old contract ends; open it as New'
        USING ERRCODE = 'AG010', DETAIL = to_char(v_latest, 'YYYY-MM'),
              HINT = 'สัญญาใหม่เริ่มเกิน 2 เดือนหลังสัญญาเก่าจบ (กฎบริษัท) — ให้เปิดงานเป็นลูกค้าใหม่ (New) ไม่ผูกสัญญาเก่า';
    END IF;
  END IF;

  -- ---------- ฝั่งสัญญาเก่า (มีสัญญา Renew ผูกอยู่) แก้วันที่/ระยะเวลา ----------
  IF TG_OP = 'UPDATE'
     AND (NEW.start_date IS DISTINCT FROM OLD.start_date
          OR NEW.end_date IS DISTINCT FROM OLD.end_date
          OR NEW.term_months IS DISTINCT FROM OLD.term_months) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('public.contracts.renewal:' || NEW.id::text, 0));
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.start_date IS DISTINCT FROM OLD.start_date
          OR NEW.end_date IS DISTINCT FROM OLD.end_date
          OR NEW.term_months IS DISTINCT FROM OLD.term_months)
     AND EXISTS (SELECT 1 FROM public.contracts r
                  WHERE r.renewed_from_contract_id = NEW.id AND r.id <> NEW.id
                    AND r.status <> 'cancelled' AND r.cancelled_at IS NULL
                    AND NOT public.renewal_gap_ok(NEW.start_date, NEW.end_date, NEW.term_months, r.start_date)) THEN
    RAISE EXCEPTION 'this change would put a linked renewal outside the 2-month window'
      USING ERRCODE = 'AG010',
            DETAIL = to_char(public.renewal_latest_start_month(NEW.start_date, NEW.end_date, NEW.term_months), 'YYYY-MM'),
            HINT = 'แก้วันที่ของสัญญานี้แล้ว สัญญาที่ต่อ (Renew) จากสัญญานี้จะเริ่มเกิน 2 เดือนหลังวันจบ — แก้ไม่ได้';
  END IF;

  RETURN NEW;
END;
$$;

-- trigger เดิมฟังเฉพาะ term_years → เพิ่ม term_months (แก้ระยะผ่านคอลัมน์ใหม่อย่างเดียวต้องโดนตรวจด้วย)
DROP TRIGGER contracts_renewed_gap_guard ON public.contracts;
CREATE TRIGGER contracts_renewed_gap_guard
  BEFORE INSERT OR UPDATE OF start_date, end_date, term_years, term_months, sale_type, renewed_from_contract_id,
                             status, cancelled_at, renew_unlinked_reason
  ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_renewed_gap_guard();


-- =====================================================================
-- 12. list_unlinked_renewals — เนื้อเดิม 20261115180000 (M28) · เพิ่มคอลัมน์ term_months ท้ายผลลัพธ์
--     (term_years = NULL สำหรับ Custom) · return type เปลี่ยน → DROP + CREATE + สิทธิ์ใหม่ (เหมือนเดิม)
-- =====================================================================
DROP FUNCTION public.list_unlinked_renewals(uuid);

CREATE FUNCTION public.list_unlinked_renewals(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  contract_id           uuid,
  contract_no           text,
  customer_id           uuid,
  customer_name         text,
  branch_id             uuid,
  start_date            date,
  end_date              date,
  term_years            integer,
  status                public.contract_status,
  renew_unlinked_reason text,
  created_at            timestamptz,
  updated_at            timestamptz,
  term_months           integer                      -- M30
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role text := current_app_role();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin') THEN
    RAISE EXCEPTION 'not allowed to read unlinked renewals' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.contract_no, cu.id, cu.name, cu.branch_id, c.start_date, c.end_date, c.term_years::int,
         c.status, c.renew_unlinked_reason, c.created_at, c.updated_at, c.term_months::int
    FROM contracts c
    JOIN customers cu ON cu.id = c.customer_id
   WHERE c.sale_type = 'renew' AND c.renewed_from_contract_id IS NULL
     AND (p_branch_id IS NULL OR cu.branch_id = p_branch_id)
     AND (v_role = 'host' OR branch_in_scope(cu.branch_id))
   ORDER BY c.created_at, c.id;
END;
$$;
REVOKE ALL ON FUNCTION public.list_unlinked_renewals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_unlinked_renewals(uuid) TO authenticated;


-- =====================================================================
-- 13. save_job_opening — เนื้อเดิม 20261115190000_team_active_rest_guards.sql (M26/33) · แก้เฉพาะจุดติดป้าย "M30":
--     p_term_months (ใหม่) · p_term_years ย้ายไปท้ายสุด DEFAULT NULL (ผู้เรียกด้วยชื่อพารามิเตอร์ใช้ต่อได้)
--     กติกา: ต้องส่งอย่างน้อย 1 ตัว · ส่งทั้งคู่ต้องตรงกัน (AG016) · แก้สัญญา Custom ต้องส่ง p_term_months (AG017)
--     เขียนเฉพาะ term_months — term_years ให้ trigger contracts_00_term_sync สะท้อนเอง
--     signature เปลี่ยน → DROP + CREATE + สิทธิ์ใหม่ (เหมือนเดิม: authenticated เท่านั้น)
-- =====================================================================
DROP FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, integer, numeric, public.sale_type, uuid[], uuid, uuid, boolean, text, text, boolean, uuid, date, date, time, text, timestamptz, text);

CREATE FUNCTION public.save_job_opening(
  p_branch_id                uuid,
  p_customer_name            text,
  p_customer_type            text,
  p_contract_no              text,
  p_start_date               date,
  p_end_date                 date,
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
  p_renew_unlinked_reason    text    DEFAULT NULL,           -- M28 รอบ 2
  p_term_months              integer DEFAULT NULL,           -- M30: ระยะสัญญา (เดือน 1–36) แหล่งหลัก
  p_term_years               integer DEFAULT NULL            -- M30: ค่าเดิม (1/3) ช่วงเปลี่ยนผ่าน · ลบใน M30b
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
  v_term_months   integer := coalesce(p_term_months, p_term_years * 12);   -- M30
  v_cur_term      integer;                                  -- M30
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
           c.start_date, c.sale_type, c.renewed_from_contract_id, c.renew_unlinked_reason,  -- M28
           c.term_months                                                                  -- M30
      INTO v_old_customer, v_old_branch, v_status, v_updated_at,
           v_cur_start, v_cur_sale, v_cur_link, v_cur_reason, v_cur_term
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

  -- ---------- M30 / DECISIONS 2.53: ระยะสัญญา (เดือน) ----------
  IF v_term_months IS NULL THEN
    RAISE EXCEPTION 'contract term is required (p_term_months)' USING ERRCODE = '22004';
  END IF;
  IF p_term_years IS NOT NULL AND p_term_years NOT IN (1, 3) THEN
    RAISE EXCEPTION 'p_term_years must be 1 or 3' USING ERRCODE = '23514';
  END IF;
  IF p_term_months IS NOT NULL AND p_term_years IS NOT NULL
     AND p_term_years IS DISTINCT FROM public.contract_term_years_of(p_term_months) THEN
    RAISE EXCEPTION 'p_term_years does not match p_term_months' USING ERRCODE = 'AG016',
      HINT = 'ส่งระยะสัญญาเป็นเดือน (p_term_months) อย่างเดียว';
  END IF;
  -- ผู้เรียกแบบเดิม (ส่งแต่ปี) แก้สัญญา Custom ไม่ได้ — กันระยะ 5 เดือนถูกบันทึกทับเป็น 12 เดือนเงียบๆ
  IF p_contract_id IS NOT NULL AND p_term_months IS NULL AND v_cur_term NOT IN (12, 36) THEN
    RAISE EXCEPTION 'this contract has a custom term; send p_term_months' USING ERRCODE = 'AG017',
      HINT = 'สัญญานี้มีระยะแบบ Custom (ไม่ใช่ 1/3 ปี) — หน้าจอต้องส่งจำนวนเดือน';
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
    SELECT o.start_date, o.end_date, o.term_months INTO v_o_start, v_o_end, v_o_term
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
      id, customer_id, contract_no, start_date, end_date, term_months, value_total, sale_type,
      sale_name, am_name, is_urgent, renewed_from_contract_id, mail_received_date,
      first_service_date, first_service_time, note, renew_unlinked_reason)
    VALUES (
      v_contract_id, v_customer_id, p_contract_no, p_start_date, p_end_date, v_term_months, p_value_total,
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
      term_months              = v_term_months,             -- M30 (term_years: trigger สะท้อนเอง)
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
REVOKE ALL ON FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, numeric, public.sale_type, uuid[], uuid, uuid, boolean, text, text, boolean, uuid, date, date, time, text, timestamptz, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, numeric, public.sale_type, uuid[], uuid, uuid, boolean, text, text, boolean, uuid, date, date, time, text, timestamptz, text, integer, integer) TO authenticated;

