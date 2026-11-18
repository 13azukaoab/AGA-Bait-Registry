-- M40 (phase 5): ด่านป้องกันตัวเลขใน monthly_branch_snapshots ก่อนทำหน้า Port ต่างจังหวัด
-- (SPEC §6.5, §7.7, §8.2, บรรทัด 81, §14 ข้อ 17 ข · DECISIONS 2.79, 2.81, 5.6, 5.9, 5.11, 5.12/5.12a · CLAUDE.md กฎ 1, 4, 7)
--
-- Logic summary:
--   (a) ด่านเขียนแถว (trigger `snapshots_manual_guard` · BEFORE INSERT/UPDATE/DELETE · SECURITY INVOKER)
--       * ตรวจเฉพาะคำขอตรงจาก API ของผู้ใช้ (`current_user` = authenticated / anon) — service_role,
--         migration (postgres) และ RPC SECURITY DEFINER ของ M39 (เจ้าของ = postgres) ผ่านเสมอ
--         (ฟังก์ชันต้องเป็น INVOKER: ถ้าเป็น DEFINER, current_user จะกลายเป็นเจ้าของ และด่านจะไม่ทำงานเลย)
--       * ผู้ใช้ที่ไม่ใช่ host → 42501 (ตรงกับ RLS snapshots_host_write เดิม · กัน 2 ชั้น)
--       * host เขียน/ลบได้เฉพาะแถว source = 'manual' ของสาขา division = 'province'
--         - แถวเดิม (OLD: UPDATE/DELETE รวมถึง upsert ที่ชนแถวเดิม) และแถวใหม่ (NEW: INSERT/UPDATE) ต้องผ่านทั้งคู่
--           → เปลี่ยน source / branch_id / month_key เพื่อหนีกฎไม่ได้
--         - SN001 = แถวไม่ใช่ manual (computed / legacy) · SN002 = สาขาไม่ใช่ต่างจังหวัด (หรือไม่พบสาขา)
--   (b) ยอดรวมคำนวณที่ฐานข้อมูล (แถว manual · ทุก role)
--       cust = s1+…+xl3 · vS = v_s1+v_s3 · vM = v_m1+v_m3 · vL = v_l1+v_l3 · vXL = v_xl1+v_xl3 · value = vS+vM+vL+vXL
--       (สูตรเดียวกับ lib/dashboard/manualRow.ts `buildManualRow` · ค่าที่ client ส่งมาในช่องเหล่านี้ถูกเขียนทับ)
--       ทำใน BEFORE trigger โดยแก้ NEW → audit (AFTER trigger เดิม) ลงแถวเดียว ไม่มี UPDATE ซ้อน
--       CHECK ใหม่ (เฉพาะ source = 'manual' — แถว legacy (v_s1… = 0 แต่มีจำนวน) และ computed (v_s1… = 0) ไม่กระทบ):
--         snapshots_manual_counts_nonneg      จำนวน 8 tier ≥ 0 (คอลัมน์เป็น int อยู่แล้ว = จำนวนเต็ม)
--         snapshots_manual_values_nonneg      มูลค่า 8 tier ≥ 0 และไม่ใช่ NaN
--         snapshots_manual_zero_count_value   จำนวน 0 ⇒ มูลค่า 0 (รายtier)
--       CHECK ยอดรายงาน (report_cust / report_value · DECISIONS 5.11) คงเดิม
--   (c) confirmed_at / confirmed_by ตั้งที่เซิร์ฟเวอร์ (แถว manual · เฉพาะคำขอจาก API ของผู้ใช้)
--       * INSERT: client ส่ง confirmed_at ไม่ว่าง → confirmed_at = now(), confirmed_by = auth.uid() · ว่าง → ว่างทั้งคู่
--       * UPDATE: NEW.confirmed_at ว่าง → ว่างทั้งคู่ ("ยังไม่อัปเดต")
--                 ไม่ว่าง + (เดิมยังไม่ยืนยัน หรือ ตัวเลข/ยอดรายงาน/สาขา/เดือน เปลี่ยน) → ประทับใหม่ now() / auth.uid()
--                 ไม่ว่าง + ไม่มีอะไรเปลี่ยน → คงค่าประทับเดิม (ไม่เชื่อค่าที่ client ส่ง)
--       * ค่าที่ client ส่งมา (เวลาย้อนหลัง / confirmed_by ของคนอื่น) ไม่ถูกใช้เลย
--       * service_role / postgres (งานนำเข้า) ใช้ค่าที่ส่งมาตรงๆ (เชื่อถือได้ ไม่ผ่าน REST ของผู้ใช้)
--   (d) list_post_close_edits(p_month, p_scope) — รายการ "แก้หลังปิด" แบบแคบ (SPEC §8.2 · §14 ข้อ 17 ข)
--       * SECURITY DEFINER · search_path ตรึง · EXECUTE: authenticated เท่านั้น
--       * สิทธิ์ = month_close_actor_can(auth.uid(), scope, 'close') (ตัวเดียวกับ M39):
--         host = ทั้ง 2 scope · recorder active ที่มี central ใน division_scope = central เท่านั้น · อื่นๆ 42501
--       * ส่วนที่ยังไม่ปิด → คืน 0 แถว (ไม่ใช่ error) · เดือนผิดรูปแบบ / scope ว่าง → MC001
--       * แถว = audit_log ที่ month_key = p_month และ changed_at > greatest(closed_at, last_resync_at) (มากกว่าแบบเคร่ง:
--         แถว audit ของรอบปิด/คำนวณใหม่เองมี changed_at = เวลาเดียวกับ closed_at / last_resync_at จึงไม่ถูกนับ)
--       * scope → สาขา: JOIN branches ที่ division = scope (central = 24 สาขาส่วนกลาง · province = 19 สาขาต่างจังหวัด)
--         แถว audit ที่ branch_id ว่าง **ไม่แสดง** (ระบุ scope ไม่ได้) — ดูครบได้ที่หน้าประวัติของ host
--       * ไม่นับตาราง month_closures / month_closure_overrides (เป็นการปิด/แก้ผู้ปิด ไม่ใช่การแก้ข้อมูล ·
--         set_month_closer เลื่อน closed_at ได้ จึงตัดออกตรงๆ)
--       * คอลัมน์: changed_at, table_name, action, branch_id, branch_name, actor_name, actor_position_code, actor_position_name
--         **ไม่มี old_data / new_data / row_id / contract_id / ข้อมูลลูกค้า**
--       * ข้อจำกัดที่รู้: การเข้าบริการที่ถูกย้ายออกจากเดือนที่ปิด ลง audit ด้วยเดือนใหม่ → ไม่อยู่ในรายการของเดือนเดิม
--         (แก้ได้เฉพาะตอนแทน audit_trigger — ไม่ทำในรอบนี้)
--   * error ใหม่: SN001, SN002 (ไม่ชนชุดเดิม AG/AS/CC/CL/CT/MC/MS/PS/SV/SY/TM/TR/WL) · ใช้ซ้ำ MC001 (เดือน/ส่วนผิด) · 42501
--   * ไม่แทน audit_trigger และไม่แทนฟังก์ชันเดิมตัวใด · REVOKE TRUNCATE/REFERENCES/TRIGGER ของ authenticated บนตารางนี้
--     (TRUNCATE ข้ามทั้ง RLS และ row trigger — ในเครื่องได้มาจาก default privileges)
--   * ลำดับ cloud: หลัง 20261115271000_month_close_ready_notes.sql
--   * ก่อน db push: ADD CONSTRAINT ตรวจแถว manual ที่มีอยู่ — ถ้ามีแถวผิด migration ทั้งไฟล์ล้ม (ดู preflight ในรายงาน M40)

-- =====================================================================
-- 1. (a)(b)(c) trigger function
-- =====================================================================
CREATE FUNCTION public.snapshots_manual_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_request boolean := current_user IN ('authenticated', 'anon');
  v_division     division;
  v_changed      boolean;
BEGIN
  -- ---------- (a) ด่านสำหรับคำขอตรงจาก API ของผู้ใช้ ----------
  IF v_user_request THEN
    IF NOT public.is_host() THEN
      RAISE EXCEPTION 'แก้ตัวเลข snapshot ได้เฉพาะ OM/PM (host)' USING ERRCODE = '42501';
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      IF OLD.source <> 'manual' THEN
        RAISE EXCEPTION 'แถว snapshot แบบ % แก้/ลบผ่านหน้านี้ไม่ได้ (เฉพาะตัวเลขต่างจังหวัดที่กรอกมือ)', OLD.source
          USING ERRCODE = 'SN001';
      END IF;
      SELECT b.division INTO v_division FROM branches b WHERE b.id = OLD.branch_id;
      IF v_division IS DISTINCT FROM 'province' THEN
        RAISE EXCEPTION 'แก้/ลบตัวเลขได้เฉพาะสาขาต่างจังหวัด' USING ERRCODE = 'SN002';
      END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      IF NEW.source <> 'manual' THEN
        RAISE EXCEPTION 'บันทึกได้เฉพาะแถวตัวเลขต่างจังหวัดที่กรอกมือ (source = manual) — ได้ %', NEW.source
          USING ERRCODE = 'SN001';
      END IF;
      SELECT b.division INTO v_division FROM branches b WHERE b.id = NEW.branch_id;
      IF v_division IS DISTINCT FROM 'province' THEN
        RAISE EXCEPTION 'บันทึกตัวเลขกรอกมือได้เฉพาะสาขาต่างจังหวัด (ส่วนกลางคำนวณจากทะเบียน)' USING ERRCODE = 'SN002';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.source <> 'manual' THEN
    RETURN NEW;   -- legacy / computed: เก็บตามที่ส่งมา (เขียนได้เฉพาะ service_role / postgres / RPC)
  END IF;

  -- ---------- (b) ยอดรวมจาก 8 tier (สูตรเดียวกับ buildManualRow) ----------
  NEW.cust  := NEW.s1 + NEW.s3 + NEW.m1 + NEW.m3 + NEW.l1 + NEW.l3 + NEW.xl1 + NEW.xl3;
  NEW."vS"  := NEW.v_s1 + NEW.v_s3;
  NEW."vM"  := NEW.v_m1 + NEW.v_m3;
  NEW."vL"  := NEW.v_l1 + NEW.v_l3;
  NEW."vXL" := NEW.v_xl1 + NEW.v_xl3;
  NEW.value := NEW."vS" + NEW."vM" + NEW."vL" + NEW."vXL";

  -- ---------- (c) ผู้ยืนยัน / เวลายืนยัน ----------
  IF v_user_request THEN
    IF NEW.confirmed_at IS NULL THEN
      NEW.confirmed_by := NULL;
    ELSIF TG_OP = 'INSERT' THEN
      NEW.confirmed_at := now();
      NEW.confirmed_by := auth.uid();
    ELSE
      v_changed := (NEW.month_key, NEW.branch_id, NEW.source,
                    NEW.s1, NEW.s3, NEW.m1, NEW.m3, NEW.l1, NEW.l3, NEW.xl1, NEW.xl3,
                    NEW.v_s1, NEW.v_s3, NEW.v_m1, NEW.v_m3, NEW.v_l1, NEW.v_l3, NEW.v_xl1, NEW.v_xl3,
                    NEW.report_cust, NEW.report_value)
                   IS DISTINCT FROM
                   (OLD.month_key, OLD.branch_id, OLD.source,
                    OLD.s1, OLD.s3, OLD.m1, OLD.m3, OLD.l1, OLD.l3, OLD.xl1, OLD.xl3,
                    OLD.v_s1, OLD.v_s3, OLD.v_m1, OLD.v_m3, OLD.v_l1, OLD.v_l3, OLD.v_xl1, OLD.v_xl3,
                    OLD.report_cust, OLD.report_value);
      IF OLD.confirmed_at IS NULL OR v_changed THEN
        NEW.confirmed_at := now();
        NEW.confirmed_by := auth.uid();
      ELSE
        NEW.confirmed_at := OLD.confirmed_at;
        NEW.confirmed_by := OLD.confirmed_by;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.snapshots_manual_guard() IS
  'M40: ด่านเขียน monthly_branch_snapshots — ผู้ใช้ทาง API: host เท่านั้น · เฉพาะแถว manual ของสาขาต่างจังหวัด (SN001/SN002) · '
  'แถว manual: คำนวณ cust/vS/vM/vL/vXL/value จาก 8 tier · confirmed_at/by ประทับที่เซิร์ฟเวอร์';

-- ชื่อขึ้นต้น "snapshots_" มาก่อน trigger อื่นของ BEFORE (ตอนนี้ไม่มีตัวอื่น) · AFTER (audit) เห็นค่าที่คำนวณแล้ว
CREATE TRIGGER snapshots_manual_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.monthly_branch_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.snapshots_manual_guard();

REVOKE ALL ON FUNCTION public.snapshots_manual_guard() FROM PUBLIC, anon;

-- TRUNCATE ข้าม RLS + row trigger · ไม่มีหน้าจอใดใช้ (PostgREST ไม่มี TRUNCATE) — ตัดทิ้งให้ชัด
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.monthly_branch_snapshots FROM authenticated;

-- =====================================================================
-- 2. (b) CHECK เฉพาะแถว manual
-- =====================================================================
ALTER TABLE public.monthly_branch_snapshots
  ADD CONSTRAINT snapshots_manual_counts_nonneg
    CHECK (
      source <> 'manual'
      OR (s1 >= 0 AND s3 >= 0 AND m1 >= 0 AND m3 >= 0 AND l1 >= 0 AND l3 >= 0 AND xl1 >= 0 AND xl3 >= 0)
    ),
  ADD CONSTRAINT snapshots_manual_values_nonneg
    CHECK (
      source <> 'manual'
      OR (v_s1 >= 0 AND v_s3 >= 0 AND v_m1 >= 0 AND v_m3 >= 0 AND v_l1 >= 0 AND v_l3 >= 0 AND v_xl1 >= 0 AND v_xl3 >= 0
          AND (v_s1 + v_s3 + v_m1 + v_m3 + v_l1 + v_l3 + v_xl1 + v_xl3) <> 'NaN'::numeric)
    ),
  ADD CONSTRAINT snapshots_manual_zero_count_value
    CHECK (
      source <> 'manual'
      OR ((s1 <> 0 OR v_s1 = 0) AND (s3 <> 0 OR v_s3 = 0) AND (m1 <> 0 OR v_m1 = 0) AND (m3 <> 0 OR v_m3 = 0)
          AND (l1 <> 0 OR v_l1 = 0) AND (l3 <> 0 OR v_l3 = 0) AND (xl1 <> 0 OR v_xl1 = 0) AND (xl3 <> 0 OR v_xl3 = 0))
    );

-- =====================================================================
-- 3. (d) list_post_close_edits
-- =====================================================================
CREATE FUNCTION public.list_post_close_edits(p_month text, p_scope public.closure_scope)
RETURNS TABLE (
  changed_at          timestamptz,
  table_name          text,
  action              text,
  branch_id           uuid,
  branch_name         text,
  actor_name          text,
  actor_position_code text,
  actor_position_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_since timestamptz;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.month_close_actor_can(auth.uid(), coalesce(p_scope, 'central'), 'close') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูรายการแก้หลังปิดเดือน' USING ERRCODE = '42501';
  END IF;
  IF p_scope IS NULL OR p_month IS NULL OR p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'เดือน/ส่วนไม่ถูกต้อง (เดือนต้องเป็น YYYY-MM)' USING ERRCODE = 'MC001';
  END IF;

  SELECT greatest(mc.closed_at, mc.last_resync_at) INTO v_since
    FROM month_closures mc
   WHERE mc.month_key = p_month AND mc.scope = p_scope;
  IF v_since IS NULL THEN
    RETURN;   -- ส่วนนี้ยังไม่ปิด → ไม่มี "แก้หลังปิด"
  END IF;

  RETURN QUERY
  SELECT a.changed_at,
         a.table_name,
         a.action::text,
         a.branch_id,
         b.name,
         p.display_name,
         a.actor_position_code,
         pos.name_th
    FROM audit_log a
    JOIN branches b ON b.id = a.branch_id AND b.division::text = p_scope::text
    LEFT JOIN profiles p ON p.user_id = a.changed_by
    LEFT JOIN positions pos ON pos.code = a.actor_position_code
   WHERE a.month_key = p_month
     AND a.changed_at > v_since
     AND a.table_name NOT IN ('month_closures', 'month_closure_overrides')
   ORDER BY a.changed_at DESC, a.table_name, b.name;
END;
$$;

COMMENT ON FUNCTION public.list_post_close_edits(text, public.closure_scope) IS
  'M40: รายการแก้หลังปิดเดือน (หน้าปิดเดือน) — host ทั้ง 2 ส่วน · recorder ส่วนกลาง · ไม่มีค่าเก่า/ใหม่ · ยังไม่ปิด = 0 แถว · 42501 / MC001';

REVOKE ALL ON FUNCTION public.list_post_close_edits(text, public.closure_scope) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_post_close_edits(text, public.closure_scope) TO authenticated;
