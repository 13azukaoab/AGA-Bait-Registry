-- M18: จัดการตกบริการ ชดเชย / ไม่ชดเชย (DECISIONS 2.41 + **2.45** · แบบ docs/plans/2026-11-14-missed-service-resolution.md
--      ข้อ 0 มีผลเหนือข้ออื่น — ไม่เลือกเดือนชดเชยล่วงหน้า)
--
-- Logic summary:
--   1. ตาราง `missed_service_resolutions` — 1 แถว = ผลของ 1 เดือนที่ตกบริการของ 1 สัญญา · ไม่มีแถว = รอตัดสิน
--      · kind = 'waived' (ไม่ชดเชย · reason บังคับ · evidence_path ไม่บังคับ) — บันทึกผ่าน RPC `resolve_missed_service`
--      · kind = 'makeup' (ชดเชยแล้ว) — **ผู้ใช้ไม่สร้างเอง** ระบบสร้าง/แก้/ลบตามการเข้าชดเชยที่ผูกไว้
--        (`makeup_month` = เดือนของการเข้านั้นเสมอ) → "ชดเชยแล้ว" ยึดการเข้าจริงเป็นหลัก
--      · ผู้ใช้เขียนตรงไม่ได้ (ไม่มี GRANT INSERT/UPDATE/DELETE) · อ่าน: host / admin / recorder · anon/viewer ไม่เห็น
--      · แก้การตัดสิน = UPDATE แถวเดิม (ประวัติอยู่ใน audit_log)
--   2. `visits.makeup_for_month` — การเข้านี้เป็น "บริการชดเชยของเดือนที่ตก" (FK ไปที่แถวผล)
--      · ไม่นับเป็น routine ของเดือนตัวเอง (ชดเชยในช่วงสัญญา → เดือนนั้นต้องมี 2 ครั้ง: ปกติ + ชดเชย)
--      · trigger BEFORE `visits_makeup_link_guard` (ทุกทาง: RPC หรือ PATCH ตรง) ตรวจแล้วสร้าง/ปรับแถว makeup ให้:
--        สัญญาไม่ถูกยกเลิก (MS009) · เดือนที่ตก = เดือนบริการที่ผ่านไปแล้ว (MS001) และตกจริง (MS002)
--        · การเข้าเป็น routine และอยู่หลังเดือนที่ตก (MS006) · เดือนนั้นยังไม่ถูกตัดสินว่าไม่ชดเชย (MS010)
--        · recorder ไปชดเชยเกินเพดานเวลาไม่ได้ (MS008 — host ทำได้) · ย้ายวันที่การเข้าที่ผูกอยู่ = ปรับ makeup_month ตาม
--      · trigger AFTER `visits_makeup_unlink_cleanup`: เลิกผูก / ลบการเข้า → ลบแถว makeup (กลับเป็นรอตัดสิน)
--      · 1 เดือนที่ตกผูกได้ 1 การเข้า (unique index → 23505)
--      · เปลี่ยนการผูกได้เฉพาะผ่าน RPC (POST/PATCH ตรง → 42501) · ห้ามลงวันที่การเข้าชดเชยล่วงหน้า (MS006)
--      · เดือนที่ตกต้องไม่ก่อนเดือนเริ่มนับ (ตั้งสถานี) — กันผูกเดือนของสัญญาเก่าที่ไม่มีประวัติแล้วดัน Dashboard (MS001)
--      · ข้อจำกัดที่ยอมรับ: เพิ่ม routine ย้อนหลังในเดือนที่ชดเชยไปแล้ว → แถว makeup ค้าง แต่ lib/rules ไม่นับ
--        (เดือนนั้นไม่ตกแล้ว) · admin ลบสัญญา (ที่ไม่มีการเข้า) → แถว waived ถูก CASCADE ลบตาม (audit + คิวลบไฟล์)
--      · บันทึกผ่าน `save_makeup_service_visit(p jsonb)` = `save_service_visit` เดิม (ไม่แตะ signature/เนื้อ) + ผูก/เลิกผูก
--        ใน transaction เดียว → หน้า /service, /bait เดิมไม่กระทบ
--   3. สถานะ 3 แบบ (รอตัดสิน / ชดเชยแล้ว / ไม่ชดเชย) คำนวณใน `lib/rules/missedResolution.ts` · ไม่มี cron
--   4. `resolve_missed_service` = ไม่ชดเชยเท่านั้น: host หรือ recorder ในขอบเขต (admin อ่านอย่างเดียว)
--      · เดือนที่ตกถูกต้อง + ตกจริง · สัญญายกเลิกห้าม (MS009) · สัญญาปิดแล้วทำได้ · ชดเชยแล้วเปลี่ยนไม่ได้ (MS005)
--   5. อ่านรายการรอตัดสิน: `list_pending_missed_services(p_branch_id, p_month)` (SECURITY INVOKER — RLS ของผู้ใช้ทำงาน
--      + recorder เห็นเฉพาะสัญญาในขอบเขต) → แถว "รอชดเชย <เดือน>" ในหน้า /service (รวมสัญญาที่จบแล้ว)
--      · เกณฑ์ชั่วคราว (รอเจ้าของ): นับตกตั้งแต่เดือนที่ตั้งสถานีในระบบ (`missed_tracking_start_month`) กันสัญญาเก่าที่
--        นำเข้าไม่มีประวัติการเข้าท่วมรายการ · ไม่รวมสัญญายกเลิก (ปิดเรื่องไม่ได้)
--   6. เพดานเวลาไปชดเชย = 12 เดือนหลังเดือนบริการสุดท้าย (เจ้าของยืนยัน 14 พ.ย. 2026 (DECISIONS 2.45)) อยู่ที่
--      `missed_makeup_deadline_months()` จุดเดียว · RPC อ่านคืน makeup_deadline_month + past_deadline ให้หน้าจอ
--   7. Storage bucket `missed-service-evidence` (private · 5 MB · PDF/PNG/JPG) — หลักฐานของ "ไม่ชดเชย"
--      อ่านได้เฉพาะไฟล์ที่มีแถวอ้างอิง หรือไฟล์ที่ตัวเองเพิ่งอัปโหลด < 1 ชม. (แพทเทิร์นเดียวกับ contract-files ใน
--      20261112110100 — PDPA) · อัปโหลด: host หรือ recorder ในขอบเขต · เปลี่ยนไฟล์/ลบแถว → ไฟล์เก่าลง
--      `storage_deletion_queue` (ใช้ไฟล์ที่รอลบซ้ำไม่ได้ — MS007)
--   8. audit: trigger `audit_missed_service_resolutions` + เพิ่มกรณีในตัว `audit_trigger` (contract_id + month_key
--      = เดือนที่ตก) · เนื้อ audit_trigger เดิมจาก 20261112150000 เพิ่มเฉพาะจุดที่ติดป้าย "M18"
--   * advisory lock ต่อสัญญาเดียวกับ save_service_visit (การตัดสิน ↔ การผูกการเข้า ไม่ชนกัน)
--   * "ยกเลิก" = contracts.status = 'cancelled' หรือมี cancelled_at (ใช้เงื่อนไขเดียวกันทุกจุดในไฟล์นี้)
--   * error: MS001 เดือนที่ตกไม่ถูกต้อง · MS002 เดือนนั้นไม่ได้ตกบริการ · MS004 ไม่ชดเชยต้องมีเหตุผล
--     · MS005 ชดเชยแล้ว (มีการเข้าผูกอยู่) · MS006 ผูกการเข้าไม่ได้ (ไม่ใช่ routine / ไม่อยู่หลังเดือนที่ตก)
--     · MS007 ไฟล์หลักฐานไม่ถูกต้อง · MS008 เลยเพดานเวลาไปชดเชย (recorder) · MS009 สัญญายกเลิกแล้ว
--     · MS010 เดือนนั้นตัดสินว่าไม่ชดเชยแล้ว · (MS003 เลิกใช้ — เดิมคือเดือนชดเชยที่เลือกล่วงหน้า)
--   * snapshot เดือนที่ปิดแล้วคงค่าเดิม (กฎข้อ 7) — migration นี้ไม่แตะ monthly_branch_snapshots

-- =====================================================================
-- 0. ค่ากลาง (จุดเดียว)
-- =====================================================================
-- เพดานเวลา — เจ้าของยืนยัน 14 พ.ย. 2026 (DECISIONS 2.45): ไปชดเชยได้ไม่เกิน 12 เดือนหลังเดือนบริการสุดท้าย
--   ภายในเพดาน: recorder ไม่ชดเชย + บันทึกการเข้าชดเชยได้ · เลยเพดาน: recorder ไม่ชดเชยได้ (ปิดเรื่อง) แต่บันทึกการเข้า
--   ชดเชยไม่ได้ (MS008) · host ทำได้ทั้งคู่ · สัญญายกเลิก: ห้ามทั้งคู่ทุกบทบาท (MS009)
CREATE FUNCTION public.missed_makeup_deadline_months()
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$ SELECT 12 $$;

-- ⚠ เกณฑ์ชั่วคราว (รอเจ้าของ): เดือนแรกที่นับตกบริการ = เดือนที่ตั้งสถานีในระบบ (เวลาไทย) แต่ไม่ก่อนเดือนเริ่มสัญญา
--   ยังไม่ตั้งสถานี → NULL (ไม่นับ) · ตรงกับ trackingStartMonth() ใน lib/rules/missedResolution.ts
CREATE FUNCTION public.missed_tracking_start_month(p_start_date date, p_initialized_at timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_initialized_at IS NULL THEN NULL
              ELSE greatest(date_trunc('month', p_start_date)::date,
                            date_trunc('month', (p_initialized_at AT TIME ZONE 'Asia/Bangkok'))::date)
         END
$$;

-- =====================================================================
-- 1. ตารางผลของเดือนที่ตก
-- =====================================================================
CREATE TYPE public.missed_resolution_kind AS ENUM ('makeup', 'waived');

CREATE TABLE public.missed_service_resolutions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id   uuid NOT NULL REFERENCES public.contracts (id) ON DELETE CASCADE,
  missed_month  date NOT NULL,
  kind          public.missed_resolution_kind NOT NULL,
  makeup_month  date,
  reason        text,
  evidence_path text,
  decided_by    uuid REFERENCES auth.users (id),
  decided_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missed_service_resolutions_contract_month_key UNIQUE (contract_id, missed_month),
  CONSTRAINT missed_month_is_first_day CHECK (missed_month = date_trunc('month', missed_month)::date),
  CONSTRAINT makeup_month_is_first_day CHECK (makeup_month IS NULL OR makeup_month = date_trunc('month', makeup_month)::date),
  CONSTRAINT kind_fields CHECK (
    (kind = 'makeup' AND makeup_month IS NOT NULL AND makeup_month > missed_month
     AND reason IS NULL AND evidence_path IS NULL)
    OR (kind = 'waived' AND makeup_month IS NULL AND reason IS NOT NULL AND btrim(reason) <> '')),
  CONSTRAINT reason_length CHECK (reason IS NULL OR char_length(reason) <= 1000),
  CONSTRAINT evidence_path_length CHECK (evidence_path IS NULL OR char_length(evidence_path) <= 300)
);

COMMENT ON TABLE public.missed_service_resolutions IS
  'M18 / DECISIONS 2.41+2.45: outcome per missed service month. No row = pending. waived via resolve_missed_service(); makeup rows are maintained by the visits trigger from the linked make-up visit.';

-- =====================================================================
-- 2. visits.makeup_for_month — ผูกการเข้าชดเชย
-- =====================================================================
ALTER TABLE public.visits
  ADD COLUMN makeup_for_month date,
  ADD CONSTRAINT visits_makeup_for_month_first_day
    CHECK (makeup_for_month IS NULL OR makeup_for_month = date_trunc('month', makeup_for_month)::date),
  ADD CONSTRAINT visits_makeup_resolution_fkey
    FOREIGN KEY (contract_id, makeup_for_month)
    REFERENCES public.missed_service_resolutions (contract_id, missed_month);

-- 1 เดือนที่ตก ผูกการเข้าได้ 1 ครั้ง
CREATE UNIQUE INDEX visits_makeup_for_month_key
  ON public.visits (contract_id, makeup_for_month) WHERE makeup_for_month IS NOT NULL;

COMMENT ON COLUMN public.visits.makeup_for_month IS
  'M18: this routine visit makes up the missed month (1st day). Not counted as the routine visit of its own month.';

-- BEFORE: ตรวจ + สร้าง/ปรับแถว makeup (แถวแม่ต้องมีก่อน FK ตรวจตอนจบคำสั่ง)
--   * ผู้ใช้เปลี่ยนการผูก (makeup_for_month / ย้ายสัญญาของการเข้าที่ผูกอยู่) ได้เฉพาะผ่าน save_makeup_service_visit
--     (ด่าน GUC `aga.makeup_link` = id ของการเข้า · ตั้งใน RPC เท่านั้น — POST/PATCH ตรงผ่าน REST → 42501)
--     กันสร้างการเข้าชดเชยที่ไม่มีทีม/ผลตรวจ (ข้ามด่านของ save_service_visit) และกัน viewer ใช้ error ไล่ดูข้อมูล
--   * แก้การเข้าที่ผูกอยู่โดยไม่เปลี่ยนการผูก/ชนิด/เดือน (เช่น แก้หมายเหตุ) → ไม่ตรวจซ้ำ
--   * ห้ามลงวันที่การเข้าชดเชยล่วงหน้า (หลังวันนี้ตามเวลาไทย) — นับใน Dashboard เฉพาะที่ไปจริง (2.45)
--   * เพดานเวลาของ recorder เทียบกับ max(เดือนของการเข้า, เดือนปัจจุบัน) → ลงวันที่ย้อนหลังเลี่ยงเพดานไม่ได้
CREATE FUNCTION public.visits_makeup_link_guard()
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

  SELECT c.start_date, c.stations_initialized_at, c.term_years,
         (c.status = 'cancelled' OR c.cancelled_at IS NOT NULL)
    INTO v_start_date, v_initialized, v_term, v_cancelled
    FROM contracts c WHERE c.id = NEW.contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;
  IF v_cancelled THEN
    RAISE EXCEPTION 'the contract is cancelled' USING ERRCODE = 'MS009';
  END IF;
  v_start_month := date_trunc('month', v_start_date)::date;
  v_last_month  := (v_start_month + make_interval(months => v_term * 12 - 1))::date;
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

CREATE TRIGGER visits_makeup_link_guard
  BEFORE INSERT OR UPDATE OF makeup_for_month, visit_date, visit_type, contract_id ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.visits_makeup_link_guard();

-- AFTER: เลิกผูก / ลบการเข้า → ลบแถว makeup ที่ไม่มีการเข้าผูกแล้ว (กลับเป็นรอตัดสิน)
--   ต้องเป็น AFTER: ตอน BEFORE แถว visits ยังอ้างแถวผลอยู่ ลบแล้ว FK จะขวาง
CREATE FUNCTION public.visits_makeup_unlink_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.makeup_for_month IS NOT NULL
     AND (TG_OP = 'DELETE'
          OR NEW.makeup_for_month IS DISTINCT FROM OLD.makeup_for_month
          OR NEW.contract_id IS DISTINCT FROM OLD.contract_id) THEN
    -- คิวของสัญญาเดิม (เลิกผูกผ่าน RPC ถืออยู่แล้ว · ซ้ำได้)
    PERFORM pg_advisory_xact_lock(hashtextextended('public.save_service_visit:' || OLD.contract_id::text, 0));
    DELETE FROM missed_service_resolutions r
     WHERE r.contract_id = OLD.contract_id AND r.missed_month = OLD.makeup_for_month
       AND r.kind = 'makeup'
       AND NOT EXISTS (SELECT 1 FROM visits vi
                        WHERE vi.contract_id = r.contract_id AND vi.makeup_for_month = r.missed_month);
  END IF;
  RETURN NULL; -- AFTER trigger
END;
$$;

CREATE TRIGGER visits_makeup_unlink_cleanup
  AFTER UPDATE OF makeup_for_month, contract_id OR DELETE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.visits_makeup_unlink_cleanup();

-- =====================================================================
-- 3. RLS + สิทธิ์ตาราง (อ่านอย่างเดียว · เขียนผ่าน RPC / trigger)
-- =====================================================================
ALTER TABLE public.missed_service_resolutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY missed_service_resolutions_select ON public.missed_service_resolutions
  FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));

REVOKE ALL ON public.missed_service_resolutions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.missed_service_resolutions TO authenticated;
GRANT ALL ON public.missed_service_resolutions TO service_role;

-- =====================================================================
-- 4. Storage: ไฟล์หลักฐานของ "ไม่ชดเชย" (ไม่บังคับ)
-- =====================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('missed-service-evidence', 'missed-service-evidence', false, 5242880,
        ARRAY['application/pdf', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- อ่าน: ต้องมีแถวอ้างอิง path นี้ (subquery อ่านตาม RLS ของผู้ใช้) หรือเป็นไฟล์ของตัวเองที่เพิ่งอัปโหลด
--       ไม่เกิน 1 ชม. (ให้แอปลบไฟล์ที่อัปโหลดแล้วบันทึกไม่สำเร็จได้ — เหมือน contract-files)
CREATE POLICY missed_evidence_bucket_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'missed-service-evidence'
    AND public.current_app_role() IN ('host', 'admin', 'recorder')
    AND (
      EXISTS (SELECT 1 FROM public.missed_service_resolutions r WHERE r.evidence_path = storage.objects.name)
      OR (storage.objects.owner_id = auth.uid()::text
          AND storage.objects.created_at > now() - interval '1 hour')
    )
  );

CREATE POLICY missed_evidence_bucket_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'missed-service-evidence'
    AND public.storage_contract_id(name) IS NOT NULL
    AND (public.is_host()
         OR (public.current_app_role() = 'recorder'
             AND public.contract_in_scope(public.storage_contract_id(name))))
  );

-- ลบ: เฉพาะไฟล์ของตัวเองที่เพิ่งอัปโหลด < 1 ชม. และยังไม่มีแถวอ้างอิง (ลบไฟล์ที่อัปโหลดแล้วบันทึกไม่สำเร็จ — PDPA)
--   ไฟล์ที่มีแถวอ้างอิงลบได้ทางคิวลบ (ระบบ) เท่านั้น · แก้ไฟล์ (UPDATE) ไม่มี policy = ไม่มีใครเขียนทับหลักฐานได้
CREATE POLICY missed_evidence_bucket_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'missed-service-evidence'
    AND (public.is_host() OR public.current_app_role() = 'recorder')
    AND storage.objects.owner_id = auth.uid()::text
    AND storage.objects.created_at > now() - interval '1 hour'
    AND NOT EXISTS (SELECT 1 FROM public.missed_service_resolutions r WHERE r.evidence_path = storage.objects.name)
  );

-- ไฟล์หลักฐานเก่า (เปลี่ยนไฟล์ / ลบแถว) → ลงคิวลบ ถ้าไม่มีแถวอื่นใช้ path นั้น
CREATE FUNCTION public.missed_evidence_enqueue_object_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.evidence_path IS NOT NULL
     AND (TG_OP = 'DELETE' OR NEW.evidence_path IS DISTINCT FROM OLD.evidence_path)
     AND NOT EXISTS (SELECT 1 FROM missed_service_resolutions r
                      WHERE r.evidence_path = OLD.evidence_path AND r.id <> OLD.id) THEN
    INSERT INTO storage_deletion_queue (bucket, path)
    VALUES ('missed-service-evidence', OLD.evidence_path)
    ON CONFLICT (bucket, path) DO UPDATE
      SET done_at = NULL, attempts = 0, last_error = NULL, enqueued_at = now();
  END IF;
  RETURN NULL; -- AFTER trigger
END;
$$;

CREATE TRIGGER missed_evidence_enqueue_object_delete
  AFTER DELETE OR UPDATE OF evidence_path ON public.missed_service_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.missed_evidence_enqueue_object_delete();

-- =====================================================================
-- 5. RPC: ไม่ชดเชย (ชดเชย = บันทึกการเข้าชดเชย ข้อ 6)
-- payload: { contract_id, missed_month 'YYYY-MM-01', reason (บังคับ), evidence_path (ไม่บังคับ),
--            kind (ไม่บังคับ — ถ้าส่งต้องเป็น 'waived') }
-- =====================================================================
CREATE FUNCTION public.resolve_missed_service(p jsonb)
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

  SELECT date_trunc('month', c.start_date)::date, c.term_years,
         (c.status = 'cancelled' OR c.cancelled_at IS NOT NULL)
    INTO v_start_month, v_term, v_cancelled
    FROM contracts c WHERE c.id = v_contract;
  IF v_cancelled THEN
    RAISE EXCEPTION 'the contract is cancelled' USING ERRCODE = 'MS009';
  END IF;

  -- ---------- เดือนที่ตก ----------
  IF v_missed <> date_trunc('month', v_missed)::date
     OR v_missed < v_start_month
     OR v_missed >= (v_start_month + make_interval(months => v_term * 12))::date
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
-- 6. RPC: บันทึกการเข้าชดเชย = save_service_visit เดิม + ผูก/เลิกผูก ใน transaction เดียว
-- payload = payload ของ save_service_visit + `makeup_for_month` ('YYYY-MM-01' = เดือนที่ตกที่ชดเชย · null = เลิกผูก
--           — key บังคับ) · การเข้าต้องเป็น routine และอยู่หลังเดือนที่ตก (เดือนไหนก็ได้ — 2.45)
-- SECURITY INVOKER: สิทธิ์ทั้งหมดมาจาก save_service_visit + RLS ของ visits + trigger ข้อ 2
-- =====================================================================
CREATE FUNCTION public.save_makeup_service_visit(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_visit_id uuid;
  v_contract uuid;
  v_month    date;
  v_result   jsonb;
BEGIN
  IF NOT (is_host() OR current_app_role() = 'recorder') THEN
    RAISE EXCEPTION 'not allowed to record service' USING ERRCODE = '42501';
  END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR NOT (p ? 'makeup_for_month')
     OR nullif(p ->> 'visit_id', '') IS NULL OR nullif(p ->> 'contract_id', '') IS NULL THEN
    RAISE EXCEPTION 'visit_id, contract_id and makeup_for_month are required' USING ERRCODE = '22004';
  END IF;
  v_visit_id := (p ->> 'visit_id')::uuid;
  v_contract := (p ->> 'contract_id')::uuid;
  v_month    := nullif(p ->> 'makeup_for_month', '')::date;
  IF NOT (is_host() OR contract_in_scope(v_contract)) THEN
    RAISE EXCEPTION 'not allowed to record service for this contract' USING ERRCODE = '42501';
  END IF;

  -- ถือคิวของสัญญาก่อนแตะแถว visits (ลำดับเดียวกับ save_service_visit — กัน deadlock)
  PERFORM pg_advisory_xact_lock(hashtextextended('public.save_service_visit:' || v_contract::text, 0));

  -- เลิกผูก / ย้ายไปชดเชยเดือนอื่น: เลิกผูกเดิมก่อน (trigger ลบแถว makeup เดิม → กลับเป็นรอตัดสิน)
  -- ผูกเดือนเดิมอยู่แล้ว: คงลิงก์ไว้ — ถ้าย้ายวันที่ trigger ปรับ makeup_month ตามเอง
  -- เปิดด่านเปลี่ยนการผูกเฉพาะการเข้านี้ (transaction-local · ปิดก่อนจบ)
  PERFORM set_config('aga.makeup_link', v_visit_id::text, true);
  UPDATE visits vi SET makeup_for_month = NULL
   WHERE vi.id = v_visit_id AND vi.contract_id = v_contract AND vi.makeup_for_month IS NOT NULL
     AND vi.makeup_for_month IS DISTINCT FROM v_month;

  v_result := save_service_visit(p - 'makeup_for_month');

  IF v_month IS NOT NULL THEN
    UPDATE visits vi SET makeup_for_month = v_month
     WHERE vi.id = v_visit_id AND vi.contract_id = v_contract AND vi.makeup_for_month IS DISTINCT FROM v_month;
  END IF;
  PERFORM set_config('aga.makeup_link', '', true);

  RETURN coalesce(v_result, '{}'::jsonb) || jsonb_build_object('makeup_for_month', v_month);
END;
$$;

-- =====================================================================
-- 7. อ่านรายการ "รอตัดสิน" (แถว "รอชดเชย <เดือน>" ในหน้า /service · หน้า ต้องทำ)
--   p_branch_id: NULL = ทุกสาขาที่มองเห็น · p_month: เดือนของหน้า (วันใดก็ได้ในเดือน · NULL = เดือนปัจจุบัน)
--   คืนเดือนที่ตกก่อน min(p_month, เดือนปัจจุบัน) ที่ยังไม่ชดเชยและไม่ได้ตัดสินว่าไม่ชดเชย · รวมสัญญาที่จบ/ปิดแล้ว
--   · ไม่รวมสัญญายกเลิก · นับตั้งแต่ missed_tracking_start_month (เกณฑ์ชั่วคราว)
--   SECURITY INVOKER: RLS ของ contracts/customers/visits/missed_service_resolutions ทำงานตามผู้เรียก
--   + recorder เห็นเฉพาะสัญญาในขอบเขต (contract_in_scope) · บทบาทอื่นนอกจาก host/admin/recorder → 42501
-- =====================================================================
CREATE FUNCTION public.list_pending_missed_services(p_branch_id uuid DEFAULT NULL, p_month date DEFAULT NULL)
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
           (date_trunc('month', ct.start_date) + make_interval(months => ct.term_years * 12 - 1))::date AS last_month
      FROM contracts ct
      JOIN customers cu ON cu.id = ct.customer_id
     WHERE ct.status <> 'cancelled' AND ct.cancelled_at IS NULL
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
-- 8. audit (เนื้อเดิมจาก 20261112150000 + กรณี missed_service_resolutions "M18")
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
    WHEN 'missed_service_resolutions' THEN   -- M18: ค้นตามสัญญา + เดือนที่ตก
      v_contract := (v_rec ->> 'contract_id')::uuid;
      v_month    := to_char((v_rec ->> 'missed_month')::date, 'YYYY-MM');
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

CREATE TRIGGER audit_missed_service_resolutions
  AFTER INSERT OR UPDATE OR DELETE ON public.missed_service_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- =====================================================================
-- 9. สิทธิ์ function (ทุกตัวในไฟล์นี้)
-- =====================================================================
REVOKE ALL ON FUNCTION public.visits_makeup_link_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.visits_makeup_unlink_cleanup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.missed_evidence_enqueue_object_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.missed_makeup_deadline_months() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missed_makeup_deadline_months() TO authenticated;
REVOKE ALL ON FUNCTION public.missed_tracking_start_month(date, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missed_tracking_start_month(date, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_missed_service(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_missed_service(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.save_makeup_service_visit(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_makeup_service_visit(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.list_pending_missed_services(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_missed_services(uuid, date) TO authenticated;
