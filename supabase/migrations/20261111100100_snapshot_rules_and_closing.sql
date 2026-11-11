-- M6: กฎ snapshot + ปิดเดือน บังคับที่ฐานข้อมูล (SPEC §6.5, §7.7, §14 ข้อ 17 · DECISIONS 5.6–5.9, 5.11)
--
-- Logic summary:
--   (ค) คนทั่วไป (anon) ไม่เห็นช่องเบื้องหลังของ snapshot
--       report_cust / report_value / confirmed_at / confirmed_by
--       → ถอนสิทธิ์ SELECT ของ anon บนตาราง monthly_branch_snapshots และเปลี่ยน policy อ่าน
--         เป็นของผู้ล็อกอินเท่านั้น · anon อ่านได้ทาง view v_branch_summary อย่างเดียว
--         (view ไม่มี 4 ช่องนี้ และรันด้วยสิทธิ์เจ้าของ view จึงยังอ่านได้ — หน้า /summary
--          ใช้ view นี้อยู่แล้ว ดู app/(public)/summary/data.ts)
--   (จ) ยอดจากรายงานต้องตรง (เฉพาะแถว source = 'manual'):
--         report_cust  (ถ้ากรอก) = s1 + s3 + m1 + m3 + l1 + l3 + xl1 + xl3
--         report_value (ถ้ากรอก) = v_s1 + v_s3 + … + v_xl3
--       ว่าง (NULL) = ยังไม่เทียบยอด บันทึกได้ (แอปเตือนเอง) · บังคับด้วย CHECK constraint
--       ⚠ เทียบกับผลรวม 8 tier โดยตรง ไม่เทียบกับ cust / value (ที่แอปคำนวณเก็บ) เพื่อไม่ให้
--         กฎนี้พึ่งสูตรฝั่งแอป
--   (จ) ปิดเดือนได้เฉพาะเดือนที่จบแล้วตามเวลา Asia/Bangkok
--       month_key ('YYYY-MM') ต้อง < เดือนปัจจุบันของไทย → trigger BEFORE INSERT / UPDATE OF month_key
--       (CHECK ใช้ now() ไม่ได้) · ย้ายแถวไปเดือนที่ยังไม่จบด้วย UPDATE ก็ไม่ได้
--       แถวเดิมที่ month_key ไม่เปลี่ยน แก้ช่องอื่นได้ตามปกติ (ข้อ ง)
--   (ก)(ข) เขียน snapshot: คงเดิม — policy snapshots_host_write ให้เฉพาะ host ·
--       service_role (ฝั่ง server ตอนกดปิดเดือน) ข้าม RLS · หัวหน้างานเขียนเองไม่ได้
--       **ไม่มีสูตรคำนวณ snapshot ใน SQL** — สูตรอยู่ที่ lib/rules (TypeScript) ที่เดียว
--   (ง) closed_by / closed_at แก้ได้ตามสิทธิ์ปิดเดือนเดิม ไม่ล็อก · trigger audit_month_closures
--       เดิมจดประวัติทุกการแก้
--   * function ใหม่ 1 ตัว (trigger) → REVOKE จาก PUBLIC และ anon ตรงตัว

-- =====================================================================
-- (ค) anon อ่าน snapshot ได้ทาง view เท่านั้น
-- =====================================================================
DROP POLICY snapshots_select_public ON public.monthly_branch_snapshots;

CREATE POLICY snapshots_select_staff ON public.monthly_branch_snapshots
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.monthly_branch_snapshots FROM anon;
REVOKE ALL ON public.monthly_branch_snapshots FROM PUBLIC;

-- view ยังเปิดให้ anon อ่านเหมือนเดิม (ย้ำไว้ ไม่เปลี่ยนสิทธิ์)
GRANT SELECT ON public.v_branch_summary TO anon, authenticated, service_role;

-- =====================================================================
-- (จ) ยอดจากรายงานต้องตรงผลรวม 8 tier (แถว manual)
-- =====================================================================
ALTER TABLE public.monthly_branch_snapshots
  ADD CONSTRAINT snapshots_manual_report_cust_matches
    CHECK (
      source <> 'manual'
      OR report_cust IS NULL
      OR report_cust = s1 + s3 + m1 + m3 + l1 + l3 + xl1 + xl3
    ),
  ADD CONSTRAINT snapshots_manual_report_value_matches
    CHECK (
      source <> 'manual'
      OR report_value IS NULL
      OR report_value = v_s1 + v_s3 + v_m1 + v_m3 + v_l1 + v_l3 + v_xl1 + v_xl3
    );

-- =====================================================================
-- (จ) ปิดเดือนได้เฉพาะเดือนที่จบแล้ว (Asia/Bangkok)
-- =====================================================================
CREATE FUNCTION public.month_closures_only_past_months()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_current_month text := to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM');
BEGIN
  IF NEW.month_key !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'month_key must be YYYY-MM (got %)', NEW.month_key
      USING ERRCODE = '22007';
  END IF;

  IF NEW.month_key >= v_current_month THEN
    RAISE EXCEPTION 'month % has not ended yet (Asia/Bangkok): it cannot be closed', NEW.month_key
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.month_closures_only_past_months() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.month_closures_only_past_months() FROM anon;

CREATE TRIGGER month_closures_only_past_months
  BEFORE INSERT OR UPDATE OF month_key ON public.month_closures
  FOR EACH ROW EXECUTE FUNCTION public.month_closures_only_past_months();
