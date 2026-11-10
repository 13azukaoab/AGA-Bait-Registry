-- M1: ไฟล์แนบของสัญญา `contract_files` + Storage bucket แบบ private (SPEC §6.6 · DECISIONS 3.1–3.6)
--
-- Logic summary:
--   * 2 ชนิดไฟล์ (`kind`):
--       contract_pdf : "PDF สัญญา + Site plan" รวมไฟล์เดียว **1 แถวต่อสัญญา**
--                      อัปโหลดใหม่ = UPDATE แถวเดิม (เปลี่ยน storage_path) · ลบได้ · PDF เท่านั้น
--       site_plan    : Site plan ที่แก้ตอนติดตั้ง **หลายเวอร์ชัน** version 1, 2, 3 …
--                      ต้องมี `reason` ทุกครั้ง · `is_current` จริงได้แถวเดียวต่อสัญญา
--                      PDF / PNG / JPG (ตาม SPEC §6.6)
--   * trigger `contract_files_guard` (BEFORE) บังคับกฎที่ policy ทำไม่ได้:
--       - สัญญา `closed` → ไฟล์ล็อก เพิ่ม/แก้/ลบไม่ได้ (P0001)
--         ยกเว้นแถวที่ถูกลบตามสัญญาแบบ CASCADE (หาแถวสัญญาไม่เจอแล้ว)
--       - site_plan เพิ่มได้เฉพาะเมื่อมี contract_pdf แล้ว · ระบบนับ version ให้เอง
--         และปิด is_current ของเวอร์ชันก่อนหน้า
--       - site_plan เป็นประวัติ: แก้ได้แค่ช่อง is_current (ที่ระบบใช้เอง)
--       - ห้ามย้ายไฟล์ไปสัญญาอื่น / เปลี่ยนชนิดไฟล์
--       - uploaded_by = ผู้ล็อกอิน (ปลอมไม่ได้) · เปลี่ยนไฟล์ contract_pdf = ผู้อัปโหลดใหม่
--   * ลบ site_plan เวอร์ชันปัจจุบัน → trigger AFTER DELETE ยกเวอร์ชันล่าสุดที่เหลือขึ้นเป็นปัจจุบัน
--   * ขนาดไฟล์ที่เก็บ ≤ 5 MB (5,242,880 ไบต์) บังคับ 2 ชั้น: CHECK ของตาราง + file_size_limit
--     ของ bucket (ไฟล์ 5–10 MB แอปบีบก่อนอัปโหลด — SPEC §6.6 A3)
--   * สิทธิ์ (ตามตาราง contracts — SPEC §6.6):
--       host     : ทุกสัญญา เพิ่ม/แก้/ลบ
--       admin    : เพิ่ม/แก้/ลบ เฉพาะสัญญาในขอบเขตหน่วยงาน (contract_in_scope)
--       recorder : อ่านอย่างเดียว
--       anon     : ไม่มีสิทธิ์ใดๆ ทั้งตารางและ bucket (PDPA)
--   * Storage: bucket `contract-files` (public = false) เปิดไฟล์ด้วย signed URL เท่านั้น
--     path ของไฟล์ = `<contract_id>/<ชื่อไฟล์>` — policy อ่าน contract_id จากโฟลเดอร์แรก
--   * contract_files ลบตามสัญญาแบบ CASCADE (ไม่ใช่ผลบริการ) · ไฟล์ใน bucket ไม่ลบตามอัตโนมัติ
--     → แอปต้องลบ object ใน Storage เองเมื่อลบสัญญา/ไฟล์
--   * ทุกการเปลี่ยนลง audit_log (audit_trigger รู้จักตาราง contract_files แล้ว)

-- =====================================================================
-- 1. ตาราง
-- =====================================================================
CREATE TYPE public.contract_file_kind AS ENUM ('contract_pdf', 'site_plan');

CREATE TABLE public.contract_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id    uuid NOT NULL REFERENCES public.contracts (id) ON DELETE CASCADE,
  kind           public.contract_file_kind NOT NULL,
  version        int NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_current     boolean NOT NULL DEFAULT true,
  storage_path   text NOT NULL UNIQUE,
  file_name      text NOT NULL CHECK (btrim(file_name) <> ''),
  mime_type      text NOT NULL
                 CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes     int NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  was_compressed boolean NOT NULL DEFAULT false,
  reason         text,
  uploaded_by    uuid REFERENCES auth.users (id) DEFAULT auth.uid(),
  uploaded_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contract_files_pdf_only
    CHECK (kind <> 'contract_pdf' OR mime_type = 'application/pdf'),
  CONSTRAINT contract_files_site_plan_reason
    CHECK (kind <> 'site_plan' OR (reason IS NOT NULL AND btrim(reason) <> '')),
  CONSTRAINT contract_files_kind_version_key UNIQUE (contract_id, kind, version)
);

CREATE INDEX contract_files_contract_id_idx ON public.contract_files (contract_id);
-- contract_pdf 1 แถวต่อสัญญา
CREATE UNIQUE INDEX contract_files_one_pdf_idx
  ON public.contract_files (contract_id) WHERE kind = 'contract_pdf';
-- site_plan ปัจจุบัน 1 แถวต่อสัญญา
CREATE UNIQUE INDEX contract_files_one_current_site_plan_idx
  ON public.contract_files (contract_id) WHERE kind = 'site_plan' AND is_current;

-- =====================================================================
-- 2. helper (SECURITY DEFINER, pinned search_path — แบบเดียวกับ *_in_scope)
-- =====================================================================
-- 'xxxxxxxx-....-.../file.pdf' -> uuid ของโฟลเดอร์แรก · รูปแบบผิด -> NULL (ไม่ error)
CREATE FUNCTION public.storage_contract_id(p_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN split_part(p_name, '/', 1)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN split_part(p_name, '/', 1)::uuid
  END;
$$;

-- ผู้ใช้ปัจจุบันเพิ่ม/แก้/ลบไฟล์ของสัญญานี้ได้ไหม (สัญญาต้องมีอยู่จริงและยังไม่ปิด)
CREATE FUNCTION public.contract_files_writable(p_contract_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT c.status <> 'closed'
            AND (public.is_host()
                 OR (public.current_app_role() = 'admin' AND public.contract_in_scope(c.id)))
       FROM public.contracts c
      WHERE c.id = p_contract_id),
    false
  );
$$;

-- =====================================================================
-- 3. guard trigger
-- =====================================================================
CREATE FUNCTION public.contract_files_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.contract_id ELSE NEW.contract_id END;
  v_status   public.contract_status;
BEGIN
  SELECT c.status INTO v_status FROM public.contracts c WHERE c.id = v_contract;

  -- ลบตามสัญญาแบบ CASCADE: แถวสัญญาหายไปแล้ว -> ปล่อยผ่าน
  IF TG_OP = 'DELETE' AND v_status IS NULL THEN
    RETURN OLD;
  END IF;

  IF v_status = 'closed' THEN
    RAISE EXCEPTION 'contract is closed: its files are locked' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.uploaded_by := coalesce(auth.uid(), NEW.uploaded_by);
    NEW.uploaded_at := now();

    IF NEW.kind = 'contract_pdf' THEN
      NEW.version    := 1;
      NEW.is_current := true;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.contract_files f
                      WHERE f.contract_id = NEW.contract_id AND f.kind = 'contract_pdf') THEN
        RAISE EXCEPTION 'attach the contract PDF before adding a site plan version'
          USING ERRCODE = 'P0001';
      END IF;
      -- กันสองคนเพิ่มเวอร์ชันพร้อมกันได้เลขซ้ำ
      PERFORM pg_advisory_xact_lock(hashtext('public.contract_files:' || NEW.contract_id::text));
      SELECT coalesce(max(f.version), 0) + 1 INTO NEW.version
        FROM public.contract_files f
       WHERE f.contract_id = NEW.contract_id AND f.kind = 'site_plan';
      UPDATE public.contract_files
         SET is_current = false
       WHERE contract_id = NEW.contract_id AND kind = 'site_plan' AND is_current;
      NEW.is_current := true;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.contract_id <> OLD.contract_id OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'a file cannot move to another contract or change kind'
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.kind = 'site_plan' THEN
    IF (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current') THEN
      RAISE EXCEPTION 'site plan versions are history: add a new version instead'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- contract_pdf: เปลี่ยนไฟล์ = ผู้อัปโหลดใหม่ · version คงที่ 1
  NEW.version    := 1;
  NEW.is_current := true;
  IF NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
    NEW.uploaded_by := coalesce(auth.uid(), NEW.uploaded_by);
    NEW.uploaded_at := now();
  ELSE
    NEW.uploaded_by := OLD.uploaded_by;
    NEW.uploaded_at := OLD.uploaded_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contract_files_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.contract_files
  FOR EACH ROW EXECUTE FUNCTION public.contract_files_guard();

-- ลบ site_plan ปัจจุบัน -> ยกเวอร์ชันล่าสุดที่เหลือขึ้นเป็นปัจจุบัน
CREATE FUNCTION public.contract_files_promote_site_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.kind = 'site_plan' AND OLD.is_current
     AND EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = OLD.contract_id) THEN
    UPDATE public.contract_files
       SET is_current = true
     WHERE id = (SELECT f.id FROM public.contract_files f
                  WHERE f.contract_id = OLD.contract_id AND f.kind = 'site_plan'
                  ORDER BY f.version DESC LIMIT 1);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER contract_files_promote_site_plan
  AFTER DELETE ON public.contract_files
  FOR EACH ROW EXECUTE FUNCTION public.contract_files_promote_site_plan();

-- =====================================================================
-- 4. audit — เพิ่ม contract_files ในตัวเติมบริบท (ส่วนอื่นเหมือน 20261110090400)
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
  v_rec := COALESCE(v_new, v_old);

  -- tables without an "id" column (contract_teams, snapshots, closures) yield NULL
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
    WHEN 'station_checks' THEN
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

CREATE TRIGGER audit_contract_files
  AFTER INSERT OR UPDATE OR DELETE ON public.contract_files
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- =====================================================================
-- 5. RLS ของตาราง (เหมือน contracts)
-- =====================================================================
ALTER TABLE public.contract_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY contract_files_select ON public.contract_files FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));
CREATE POLICY contract_files_host_write ON public.contract_files FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());
CREATE POLICY contract_files_admin_insert ON public.contract_files FOR INSERT TO authenticated
  WITH CHECK (public.current_app_role() = 'admin' AND public.contract_in_scope(contract_id));
CREATE POLICY contract_files_admin_update ON public.contract_files FOR UPDATE TO authenticated
  USING (public.current_app_role() = 'admin' AND public.contract_in_scope(contract_id))
  WITH CHECK (public.current_app_role() = 'admin' AND public.contract_in_scope(contract_id));
CREATE POLICY contract_files_admin_delete ON public.contract_files FOR DELETE TO authenticated
  USING (public.current_app_role() = 'admin' AND public.contract_in_scope(contract_id));

-- =====================================================================
-- 6. Storage bucket (private) + policy
-- =====================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('contract-files', 'contract-files', false, 5242880,
        ARRAY['application/pdf', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- อ่าน (สร้าง signed URL / ดาวน์โหลด): พนักงานทุกตำแหน่ง · anon ไม่มี policy = ไม่ได้
CREATE POLICY contract_files_bucket_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'contract-files'
    AND public.current_app_role() IN ('host', 'admin', 'recorder')
  );
CREATE POLICY contract_files_bucket_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contract-files'
    AND public.contract_files_writable(public.storage_contract_id(name))
  );
CREATE POLICY contract_files_bucket_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'contract-files'
    AND public.contract_files_writable(public.storage_contract_id(name))
  )
  WITH CHECK (
    bucket_id = 'contract-files'
    AND public.contract_files_writable(public.storage_contract_id(name))
  );
CREATE POLICY contract_files_bucket_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'contract-files'
    AND public.contract_files_writable(public.storage_contract_id(name))
  );

-- =====================================================================
-- 7. สิทธิ์ (ตารางและ function ใหม่ทุกตัวต้องมีในไฟล์นี้ — CLAUDE.md)
-- =====================================================================
REVOKE ALL ON public.contract_files FROM PUBLIC;
REVOKE ALL ON public.contract_files FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_files TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.storage_contract_id(text)             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contract_files_writable(uuid)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contract_files_guard()                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contract_files_promote_site_plan()    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_contract_id(text)             FROM anon;
REVOKE ALL ON FUNCTION public.contract_files_writable(uuid)         FROM anon;
REVOKE ALL ON FUNCTION public.contract_files_guard()                FROM anon;
REVOKE ALL ON FUNCTION public.contract_files_promote_site_plan()    FROM anon;
GRANT EXECUTE ON FUNCTION public.storage_contract_id(text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contract_files_writable(uuid) TO authenticated, service_role;
