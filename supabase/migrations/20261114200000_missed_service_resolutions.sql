-- M18: จัดการตกบริการ ชดเชย / ไม่ชดเชย (เจ้าของตอบครบ 14 พ.ย. 2026 — DECISIONS 2.41
--      · แบบ docs/plans/2026-11-14-missed-service-resolution.md)
--
-- Logic summary:
--   1. ตาราง `missed_service_resolutions` — 1 แถว = การตัดสินของ 1 เดือนที่ตกบริการของ 1 สัญญา
--      · ไม่มีแถว = รอตัดสิน · แก้การตัดสิน = UPDATE แถวเดิม (ประวัติอยู่ใน audit_log)
--      · kind = 'makeup' (ชดเชย → makeup_month · makeup_date ไม่บังคับ แต่ต้องอยู่ในเดือนนั้น)
--        / 'waived' (ไม่ชดเชย · reason บังคับ) · evidence_path = ไฟล์หลักฐาน (ไม่บังคับ — 2.41 ④)
--      · ระดับที่ใช้คิดทุกกติกา = เดือน (`makeup_month`) · `makeup_date` เก็บวันที่ที่หน้าจอเลือกจากปฏิทิน
--      · ผู้ใช้เขียนตรงไม่ได้ (ไม่มี GRANT INSERT/UPDATE/DELETE) — บันทึกผ่าน RPC `resolve_missed_service` เท่านั้น
--        อ่าน: host / admin / recorder (ทุกสาขา เหมือนตารางบริการอื่น) · anon/viewer ไม่เห็น (PDPA)
--   2. `visits.makeup_for_month` — การเข้านี้เป็น "ชดเชยของเดือนที่ตก" (FK ไปที่การตัดสิน)
--      · ไม่นับเป็น routine ของเดือนตัวเอง (เดือนชดเชยในช่วงสัญญาต้องมี 2 ครั้ง: ปกติ + ชดเชย)
--      · trigger `visits_makeup_link_guard` ตรวจทุกทาง (RPC หรือ PATCH ตรง): ต้องเป็น routine · การตัดสินเป็น makeup
--        · วันที่เข้าอยู่ในเดือนชดเชย · 1 เดือนที่ตกผูกได้ 1 การเข้า (unique index)
--      · บันทึกการเข้าชดเชยผ่าน `save_makeup_service_visit(p jsonb)` = `save_service_visit` เดิม (ไม่แตะ signature
--        /เนื้อ) + ผูก/เลิกผูกใน transaction เดียว → หน้า /service, /bait เดิมไม่กระทบ
--   3. สถานะ 5 แบบ (รอตัดสิน / ชดเชย → เดือน / ชดเชยแล้ว / ชดเชยไม่ได้ทำ / ไม่ชดเชย) คำนวณใน
--      `lib/rules/missedResolution.ts` จาก ตารางนี้ + การเข้าที่ผูก + เดือนปัจจุบัน (Asia/Bangkok) ไม่มี cron
--   4. ด่านใน `resolve_missed_service`
--      · host หรือ recorder ในขอบเขตสาขาของสัญญา (admin อ่านอย่างเดียว · 2.41 ①)
--      · missed_month = วันที่ 1 · อยู่ในเดือนบริการ (เดือนเริ่ม + ปี×12 — กฎข้อ 5 ไม่ใช้ end_date) · ผ่านไปแล้ว
--        · ยังไม่ถูกยกเลิก · และ "ตกจริง" (ไม่มี routine ที่ไม่ใช่ชดเชยในเดือนนั้น) → กันสร้างเดือนชดเชยปลอมดัน Dashboard
--      · ชดเชย: เดือนชดเชย > เดือนที่ตก · recorder เลือกเดือนก่อนเดือนปัจจุบันไม่ได้ (host ได้) — ยกเว้นคงเดือนเดิม
--      · มีการเข้าชดเชยผูกอยู่แล้ว → เปลี่ยนชนิด/เดือนชดเชยไม่ได้ (MS005 — เลิกผูกการเข้าก่อน)
--      · หลักฐาน: path ต้องเป็น `<contract_id>/<ชื่อไฟล์>` ใน bucket `missed-service-evidence` และมีไฟล์อยู่จริง
--   5. Storage bucket ใหม่ `missed-service-evidence` (private · 5 MB · PDF/PNG/JPG)
--      อ่าน: host/admin/recorder · อัปโหลด: host หรือ recorder ในขอบเขตของสัญญา (โฟลเดอร์แรก = contract_id)
--      แก้/ลบไฟล์: ไม่มี policy (ไฟล์หลักฐานไม่ถูกเขียนทับ)
--   6. audit: trigger `audit_missed_service_resolutions` + เพิ่มกรณีในตัว `audit_trigger` (contract_id + month_key
--      = เดือนที่ตก) · เนื้อ audit_trigger เดิมจาก 20261112150000 เพิ่มเฉพาะจุดที่ติดป้าย "M18"
--   * advisory lock ต่อสัญญาเดียวกับ save_service_visit (การตัดสิน ↔ การผูกการเข้า ไม่ชนกัน)
--   * error ใหม่: MS001 เดือนที่ตกไม่ถูกต้อง · MS002 เดือนนั้นไม่ได้ตกบริการ · MS003 เดือน/วันชดเชยไม่ถูกต้อง
--     · MS004 ไม่ชดเชยต้องมีเหตุผล · MS005 มีการเข้าชดเชยผูกอยู่ · MS006 ผูกการเข้าไม่ได้ · MS007 ไฟล์หลักฐานไม่ถูกต้อง
--   * snapshot เดือนที่ปิดแล้วคงค่าเดิม (กฎข้อ 7) — migration นี้ไม่แตะ monthly_branch_snapshots

-- =====================================================================
-- 1. ตารางการตัดสิน
-- =====================================================================
CREATE TYPE public.missed_resolution_kind AS ENUM ('makeup', 'waived');

CREATE TABLE public.missed_service_resolutions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id   uuid NOT NULL REFERENCES public.contracts (id) ON DELETE CASCADE,
  missed_month  date NOT NULL,
  kind          public.missed_resolution_kind NOT NULL,
  makeup_month  date,
  makeup_date   date,
  reason        text,
  evidence_path text,
  decided_by    uuid REFERENCES auth.users (id),
  decided_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missed_service_resolutions_contract_month_key UNIQUE (contract_id, missed_month),
  CONSTRAINT missed_month_is_first_day CHECK (missed_month = date_trunc('month', missed_month)::date),
  CONSTRAINT makeup_month_is_first_day CHECK (makeup_month IS NULL OR makeup_month = date_trunc('month', makeup_month)::date),
  CONSTRAINT makeup_date_in_makeup_month CHECK (
    makeup_date IS NULL OR date_trunc('month', makeup_date)::date = makeup_month),
  CONSTRAINT kind_fields CHECK (
    (kind = 'makeup' AND makeup_month IS NOT NULL AND makeup_month > missed_month)
    OR (kind = 'waived' AND makeup_month IS NULL AND makeup_date IS NULL
        AND reason IS NOT NULL AND btrim(reason) <> '')),
  CONSTRAINT reason_length CHECK (reason IS NULL OR char_length(reason) <= 1000),
  CONSTRAINT evidence_path_length CHECK (evidence_path IS NULL OR char_length(evidence_path) <= 300)
);

COMMENT ON TABLE public.missed_service_resolutions IS
  'M18 / DECISIONS 2.41: decision per missed service month (makeup or waived). No row = pending. Written only through resolve_missed_service().';

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

CREATE FUNCTION public.visits_makeup_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind  public.missed_resolution_kind;
  v_month date;
BEGIN
  IF NEW.makeup_for_month IS NULL THEN
    RETURN NEW;
  END IF;
  -- คิวเดียวกับ resolve_missed_service / save_service_visit ของสัญญานี้
  PERFORM pg_advisory_xact_lock(hashtextextended('public.save_service_visit:' || NEW.contract_id::text, 0));

  SELECT r.kind, r.makeup_month INTO v_kind, v_month
    FROM missed_service_resolutions r
   WHERE r.contract_id = NEW.contract_id AND r.missed_month = NEW.makeup_for_month;
  IF NOT FOUND OR v_kind <> 'makeup' THEN
    RAISE EXCEPTION 'this month has no make-up decision' USING ERRCODE = 'MS006';
  END IF;
  IF NEW.visit_type <> 'routine' THEN
    RAISE EXCEPTION 'a make-up visit must be a routine visit' USING ERRCODE = 'MS006';
  END IF;
  IF date_trunc('month', NEW.visit_date)::date <> v_month THEN
    RAISE EXCEPTION 'the make-up visit must be in the chosen make-up month' USING ERRCODE = 'MS006';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER visits_makeup_link_guard
  BEFORE INSERT OR UPDATE OF makeup_for_month, visit_date, visit_type, contract_id ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.visits_makeup_link_guard();

-- =====================================================================
-- 3. RLS + สิทธิ์ตาราง (อ่านอย่างเดียว · เขียนผ่าน RPC)
-- =====================================================================
ALTER TABLE public.missed_service_resolutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY missed_service_resolutions_select ON public.missed_service_resolutions
  FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));

REVOKE ALL ON public.missed_service_resolutions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.missed_service_resolutions TO authenticated;
GRANT ALL ON public.missed_service_resolutions TO service_role;

-- =====================================================================
-- 4. Storage: ไฟล์หลักฐาน (ไม่บังคับ)
-- =====================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('missed-service-evidence', 'missed-service-evidence', false, 5242880,
        ARRAY['application/pdf', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY missed_evidence_bucket_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'missed-service-evidence'
    AND public.current_app_role() IN ('host', 'admin', 'recorder')
  );
CREATE POLICY missed_evidence_bucket_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'missed-service-evidence'
    AND public.storage_contract_id(name) IS NOT NULL
    AND (public.is_host()
         OR (public.current_app_role() = 'recorder'
             AND public.contract_in_scope(public.storage_contract_id(name))))
  );

-- =====================================================================
-- 5. RPC: ตัดสินเดือนที่ตก
-- payload: { contract_id, missed_month 'YYYY-MM-01', kind 'makeup'|'waived',
--            makeup_date 'YYYY-MM-DD' (บังคับเมื่อ makeup), reason (บังคับเมื่อ waived), evidence_path (ไม่บังคับ) }
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
  v_kind        public.missed_resolution_kind;
  v_mk_date     date;
  v_mk_month    date;
  v_reason      text := nullif(btrim(p ->> 'reason'), '');
  v_evidence    text := nullif(btrim(p ->> 'evidence_path'), '');
  v_role        text := current_app_role();
  v_is_host     boolean := is_host();
  v_now_month   date := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
  v_start_month date;
  v_term        int;
  v_cancelled   date;
  v_old         missed_service_resolutions%ROWTYPE;
  v_has_old     boolean;
  v_row         missed_service_resolutions%ROWTYPE;
BEGIN
  -- สิทธิ์ก่อน (คนไม่มีสิทธิ์ไม่ได้ถือ lock / ลองว่ามี id จริงไหม)
  IF NOT (v_is_host OR v_role = 'recorder') THEN
    RAISE EXCEPTION 'not allowed to resolve missed service' USING ERRCODE = '42501';
  END IF;

  IF p IS NULL OR jsonb_typeof(p) <> 'object'
     OR nullif(p ->> 'contract_id', '') IS NULL OR nullif(p ->> 'missed_month', '') IS NULL
     OR nullif(p ->> 'kind', '') IS NULL THEN
    RAISE EXCEPTION 'contract_id, missed_month and kind are required' USING ERRCODE = '22004';
  END IF;
  IF (p ->> 'kind') NOT IN ('makeup', 'waived') THEN
    RAISE EXCEPTION 'kind must be makeup or waived' USING ERRCODE = '22023';
  END IF;
  v_contract := (p ->> 'contract_id')::uuid;
  v_missed   := (p ->> 'missed_month')::date;
  v_kind     := (p ->> 'kind')::public.missed_resolution_kind;
  v_mk_date  := nullif(p ->> 'makeup_date', '')::date;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.save_service_visit:' || v_contract::text, 0));

  -- ---------- สัญญา + ขอบเขต ----------
  SELECT date_trunc('month', c.start_date)::date, c.term_years, c.cancelled_at::date
    INTO v_start_month, v_term, v_cancelled
    FROM contracts c WHERE c.id = v_contract;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;
  IF NOT (v_is_host OR contract_in_scope(v_contract)) THEN
    RAISE EXCEPTION 'not allowed to resolve missed service for this contract' USING ERRCODE = '42501';
  END IF;

  -- ---------- เดือนที่ตก ----------
  IF v_missed <> date_trunc('month', v_missed)::date
     OR v_missed < v_start_month
     OR v_missed >= (v_start_month + make_interval(months => v_term * 12))::date
     OR v_missed >= v_now_month
     OR (v_cancelled IS NOT NULL AND date_trunc('month', v_cancelled)::date <= v_missed) THEN
    RAISE EXCEPTION 'missed_month must be the 1st day of a past service month of this contract'
      USING ERRCODE = 'MS001';
  END IF;
  IF EXISTS (SELECT 1 FROM visits vi
              WHERE vi.contract_id = v_contract AND vi.visit_type = 'routine'
                AND vi.makeup_for_month IS NULL
                AND date_trunc('month', vi.visit_date)::date = v_missed) THEN
    RAISE EXCEPTION 'this month has a routine visit; it was not missed' USING ERRCODE = 'MS002';
  END IF;

  SELECT * INTO v_old FROM missed_service_resolutions r
   WHERE r.contract_id = v_contract AND r.missed_month = v_missed
     FOR UPDATE;
  v_has_old := FOUND;

  -- ---------- ตามชนิด ----------
  IF v_kind = 'makeup' THEN
    IF v_mk_date IS NULL THEN
      RAISE EXCEPTION 'makeup_date is required for a make-up decision' USING ERRCODE = 'MS003';
    END IF;
    v_mk_month := date_trunc('month', v_mk_date)::date;
    IF v_mk_month <= v_missed THEN
      RAISE EXCEPTION 'the make-up month must be after the missed month' USING ERRCODE = 'MS003';
    END IF;
    -- recorder ย้อนก่อนเดือนนี้ไม่ได้ (host ได้) · คงเดือนชดเชยเดิมได้ (แก้เหตุผล/หลักฐาน)
    IF NOT v_is_host AND v_mk_month < v_now_month
       AND NOT (v_has_old AND v_old.kind = 'makeup' AND v_old.makeup_month = v_mk_month) THEN
      RAISE EXCEPTION 'the make-up month cannot be before the current month' USING ERRCODE = 'MS003';
    END IF;
  ELSE
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'a reason is required when no make-up is given' USING ERRCODE = 'MS004';
    END IF;
    v_mk_date := NULL;
    v_mk_month := NULL;
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'reason is too long' USING ERRCODE = '22001';
  END IF;

  -- ---------- มีการเข้าชดเชยผูกอยู่ → เปลี่ยนชนิด/เดือนไม่ได้ ----------
  IF v_has_old
     AND (v_old.kind IS DISTINCT FROM v_kind OR v_old.makeup_month IS DISTINCT FROM v_mk_month)
     AND EXISTS (SELECT 1 FROM visits vi
                  WHERE vi.contract_id = v_contract AND vi.makeup_for_month = v_missed) THEN
    RAISE EXCEPTION 'a make-up visit is linked to this month; unlink or delete that visit first'
      USING ERRCODE = 'MS005';
  END IF;

  -- ---------- หลักฐาน ----------
  IF v_evidence IS NOT NULL THEN
    IF char_length(v_evidence) > 300
       OR v_evidence !~ ('^' || v_contract::text || '/[^/]+$')
       OR NOT EXISTS (SELECT 1 FROM storage.objects o
                       WHERE o.bucket_id = 'missed-service-evidence' AND o.name = v_evidence) THEN
      RAISE EXCEPTION 'evidence file not found for this contract' USING ERRCODE = 'MS007';
    END IF;
  END IF;

  -- ---------- บันทึก ----------
  INSERT INTO missed_service_resolutions AS r
         (contract_id, missed_month, kind, makeup_month, makeup_date, reason, evidence_path,
          decided_by, decided_at)
  VALUES (v_contract, v_missed, v_kind, v_mk_month, v_mk_date, v_reason, v_evidence, auth.uid(), now())
  ON CONFLICT (contract_id, missed_month) DO UPDATE
     SET kind          = EXCLUDED.kind,
         makeup_month  = EXCLUDED.makeup_month,
         makeup_date   = EXCLUDED.makeup_date,
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
-- payload = payload ของ save_service_visit + `makeup_for_month` ('YYYY-MM-01' ผูก · null เลิกผูก — key บังคับ)
-- SECURITY INVOKER: สิทธิ์ทั้งหมดมาจาก save_service_visit + RLS ของ visits + trigger ด้านบน
-- =====================================================================
CREATE FUNCTION public.save_makeup_service_visit(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_visit_id uuid;
  v_month    date;
  v_result   jsonb;
BEGIN
  IF NOT (is_host() OR current_app_role() = 'recorder') THEN
    RAISE EXCEPTION 'not allowed to record service' USING ERRCODE = '42501';
  END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR NOT (p ? 'makeup_for_month')
     OR nullif(p ->> 'visit_id', '') IS NULL THEN
    RAISE EXCEPTION 'visit_id and makeup_for_month are required' USING ERRCODE = '22004';
  END IF;
  v_visit_id := (p ->> 'visit_id')::uuid;
  v_month    := nullif(p ->> 'makeup_for_month', '')::date;

  -- เลิกผูก/เปลี่ยนผูกก่อนบันทึก (การเข้าที่ย้ายวันออกจากเดือนชดเชยจะไม่ติดด่านของการผูกเดิม)
  UPDATE visits vi SET makeup_for_month = NULL
   WHERE vi.id = v_visit_id AND vi.makeup_for_month IS NOT NULL
     AND vi.makeup_for_month IS DISTINCT FROM v_month;

  v_result := save_service_visit(p - 'makeup_for_month');

  IF v_month IS NOT NULL THEN
    UPDATE visits vi SET makeup_for_month = v_month
     WHERE vi.id = v_visit_id AND vi.makeup_for_month IS DISTINCT FROM v_month;
  END IF;

  RETURN coalesce(v_result, '{}'::jsonb) || jsonb_build_object('makeup_for_month', v_month);
END;
$$;

-- =====================================================================
-- 7. audit (เนื้อเดิมจาก 20261112150000 + กรณี missed_service_resolutions "M18")
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
-- 8. สิทธิ์ function (ทุกตัวในไฟล์นี้)
-- =====================================================================
REVOKE ALL ON FUNCTION public.visits_makeup_link_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_missed_service(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_missed_service(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.save_makeup_service_visit(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_makeup_service_visit(jsonb) TO authenticated;
