-- คิวลบไฟล์ใน Storage + ปิดการเปิดไฟล์ที่ไม่มีแถวอ้างอิง (เจ้าของอนุมัติแบบ 12 พ.ย. 2026 ทาง 3ก)
--
-- Logic summary:
--   * ปัญหาเดิม: แถว contract_files ลบตามสัญญา (CASCADE) แต่ object ใน bucket ไม่ลบตาม แอปต้องลบเอง
--     และ policy ลบ object ต้องให้แถวสัญญายังอยู่ → ลบไฟล์ก่อน = PDF หายถ้าลบสัญญาไม่ผ่าน ·
--     ลบสัญญาก่อน = ลบ object ไม่ได้อีกเลย · และ remove() ที่ถูก RLS ปฏิเสธไม่ error
--   * หลักใหม่: **ฐานข้อมูลเป็นตัวตั้ง** — แอปไม่ต้องลบ object เอง
--       - trigger AFTER DELETE บน contract_files → ลง path ในคิว (ครอบทั้งลบไฟล์ตรงๆ และลบตามสัญญา)
--       - trigger AFTER UPDATE OF storage_path → ลง path เก่า (เปลี่ยน PDF สัญญา)
--       - อยู่ใน transaction เดียวกับการลบ: ลบสำเร็จ = ลงคิวแน่ · ลบไม่สำเร็จ/ถูก RLS ปฏิเสธ = ไม่ลงคิว
--   * งานลบจริงทำฝั่ง server (`app/api/cron/storage-cleanup` · service role · ด่าน CRON_SECRET):
--     ตรวจซ้ำว่าไม่มีแถวใช้ path แล้ว → remove → ตรวจว่า object หายจริง → ปิดงาน /
--     นับ attempts + เก็บ error (ลองได้ไม่เกิน 5 ครั้ง ที่เหลือค้างให้ host เห็น) · ลบเฉพาะ path ในคิว
--   * สิทธิ์ของคิว: anon ไม่มีอะไรเลย · authenticated SELECT ได้แต่ RLS ให้เห็นเฉพาะ host ·
--     ไม่มีใครในฝั่งผู้ใช้เขียนคิวได้ (เขียนผ่าน trigger SECURITY DEFINER เท่านั้น) · service_role ครบ
--   * ปิดช่องโหว่อ่านไฟล์: policy อ่าน bucket เดิมให้พนักงานทุกตำแหน่งอ่าน object ไหนก็ได้ใน bucket →
--     ไฟล์ที่ลบแถวแล้ว (รอคิวลบ) ถ้ารู้ path ยังสร้าง signed URL ได้ · policy ใหม่ต้องมีแถว
--     contract_files อ้างอิง path นั้นอยู่ (ข้อมูลส่วนบุคคล — PDPA) · ยกเว้นผู้อัปโหลดเห็นไฟล์ของตัวเอง
--     ที่เพิ่งอัปโหลดไม่เกิน 1 ชั่วโมง (ให้แอปลบไฟล์ที่อัปโหลดแล้วเขียนแถวไม่สำเร็จได้)

-- =====================================================================
-- 1. คิว
-- =====================================================================
CREATE TABLE public.storage_deletion_queue (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket      text NOT NULL,
  path        text NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  attempts    int  NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error  text,
  done_at     timestamptz,
  CONSTRAINT storage_deletion_queue_bucket_path_key UNIQUE (bucket, path)
);

-- งานลบดึงเฉพาะรายการที่ยังไม่เสร็จ
CREATE INDEX storage_deletion_queue_pending_idx
  ON public.storage_deletion_queue (enqueued_at) WHERE done_at IS NULL;

ALTER TABLE public.storage_deletion_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY storage_deletion_queue_host_read ON public.storage_deletion_queue
  FOR SELECT TO authenticated USING (public.is_host());

-- =====================================================================
-- 2. trigger ลงคิว
-- =====================================================================
CREATE FUNCTION public.contract_files_enqueue_object_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.storage_deletion_queue (bucket, path)
    VALUES ('contract-files', OLD.storage_path)
    ON CONFLICT (bucket, path) DO NOTHING;
  ELSIF TG_OP = 'UPDATE' AND NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
    INSERT INTO public.storage_deletion_queue (bucket, path)
    VALUES ('contract-files', OLD.storage_path)
    ON CONFLICT (bucket, path) DO NOTHING;
  END IF;
  RETURN NULL; -- AFTER trigger
END;
$$;

CREATE TRIGGER contract_files_enqueue_object_delete
  AFTER DELETE OR UPDATE OF storage_path ON public.contract_files
  FOR EACH ROW EXECUTE FUNCTION public.contract_files_enqueue_object_delete();

-- =====================================================================
-- 3. policy อ่าน bucket: ต้องมีแถว contract_files อ้างอิง
--    (subquery อ่าน contract_files ตาม RLS ของผู้ใช้ — พนักงานทุกตำแหน่งอ่านตารางนี้ได้อยู่แล้ว)
--    ข้อยกเว้น: ผู้อัปโหลดเห็น object ของตัวเองที่เพิ่งอัปโหลดภายใน 1 ชั่วโมง แม้ยังไม่มีแถว —
--    Storage ต้อง "มองเห็น" object ก่อนจึงลบได้ (remove ที่มองไม่เห็นจะคืน [] เงียบๆ) ถ้าไม่มีข้อยกเว้นนี้
--    แอปจะลบไฟล์ที่เพิ่งอัปโหลดตอนเขียนแถวไม่สำเร็จไม่ได้ (ทดสอบจริงกับ Storage ในเครื่อง 12 พ.ย. 2026)
-- =====================================================================
DROP POLICY contract_files_bucket_read ON storage.objects;
CREATE POLICY contract_files_bucket_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'contract-files'
    AND public.current_app_role() IN ('host', 'admin', 'recorder')
    AND (
      EXISTS (SELECT 1 FROM public.contract_files cf WHERE cf.storage_path = storage.objects.name)
      OR (storage.objects.owner_id = auth.uid()::text
          AND storage.objects.created_at > now() - interval '1 hour')
    )
  );

-- =====================================================================
-- 4. สิทธิ์ (ตารางและ function ใหม่ต้องกำหนดในไฟล์นี้ — CLAUDE.md)
-- =====================================================================
REVOKE ALL ON public.storage_deletion_queue FROM PUBLIC;
REVOKE ALL ON public.storage_deletion_queue FROM anon;
REVOKE ALL ON public.storage_deletion_queue FROM authenticated;
GRANT SELECT ON public.storage_deletion_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.storage_deletion_queue TO service_role;

REVOKE ALL ON FUNCTION public.contract_files_enqueue_object_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contract_files_enqueue_object_delete() FROM anon;
REVOKE ALL ON FUNCTION public.contract_files_enqueue_object_delete() FROM authenticated;
