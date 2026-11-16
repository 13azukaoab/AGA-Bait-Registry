-- M19a: ข้อมูลติดต่อลูกค้า — หมายเหตุ · เบอร์โทรหลายเบอร์ · หัวหน้างานแก้ผู้ติดต่อ/เบอร์/หมายเหตุ
-- (DECISIONS M19 · 2.43 · mockup รายละเอียดลูกค้า FINAL + #service · เจ้าของอนุมัติ 15 พ.ย. 2026 · SPEC §5)
--
-- Logic summary (สำหรับทีม):
--   1. customers.note (ไม่บังคับ · ≤ 300 ตัวอักษร ตาม mockup)
--   2. ตารางใหม่ customer_phones = เบอร์โทรหลายเบอร์ต่อลูกค้า (เบอร์ + ชื่อ/หน้าที่ ไม่บังคับ)
--      * เบอร์: ตัวเลข เว้นวรรค - + ( ) , / . ยาว 8–40 ตัว (กติกาเดียวกับ mockup) · ชื่อ/หน้าที่ ≤ 40
--      * เบอร์ซ้ำในลูกค้าเดียวกันไม่ได้ (เทียบเฉพาะตัวเลข: "02-123 4567" = "021234567") → CC003
--      * sort_order ไม่ UNIQUE (เรียงด้วย sort_order, created_at) — กันปัญหาสลับลำดับแบบ M22
--      * ลบลูกค้า → เบอร์ถูกลบตาม (CASCADE) และลง audit ทีละแถว · ย้ายเบอร์ไปลูกค้าอื่นไม่ได้ (customer_id แก้ไม่ได้)
--      * DB ไม่บังคับ "ต้องมีอย่างน้อย 1 เบอร์" (ลูกค้าใหม่/นำเข้ายังไม่มีเบอร์) — RPC กันลบเบอร์สุดท้าย (CC004)
--      * audit: trigger audit_customer_phones เรียก public.audit_trigger() ตัวเดิม (ไม่แทนที่ฟังก์ชัน —
--        M21 กำลังแก้เนื้อ) ⚠ ตอนนี้ audit_log.branch_id ของแถวเบอร์ = NULL (CASE ใน audit_trigger ยังไม่มี
--        'customer_phones') — รอหมวด 2 ตัดสินว่าจะเพิ่มใน audit_trigger รอบไหน
--   3. สิทธิ์ (RLS + GRANT 2 ชั้น)
--      * อ่าน: host / admin / recorder ทุกสาขา (เท่ากับ customers_select) · viewer / anon ไม่มีสิทธิ์เลย (PDPA —
--        anon ถูกปฏิเสธตั้งแต่ชั้น GRANT 42501)
--      * เขียนตรงผ่าน REST: host ทั้งหมด · admin เฉพาะลูกค้าในสาขาที่อยู่ในขอบเขต (เหมือน customers เดิม)
--      * recorder ไม่มี policy เขียนตรงทั้ง customers และ customer_phones → แก้ได้ทางเดียวคือ RPC
--        save_customer_contact ซึ่งแตะได้แค่ 3 อย่าง: contact_name · note · เบอร์โทร (ชื่อ/ที่อยู่/ประเภท/สาขา ไม่ได้)
--      * สิทธิ์ host / admin บน customers คงเดิมทุกข้อ
--   4. RPC save_customer_contact(p jsonb) — SECURITY DEFINER (ตรวจบทบาท + ขอบเขตเองทุกครั้ง)
--      payload: { customer_id (บังคับ), confirm_cross_team (bool),
--                 contact_name?, note?,                       ← ส่ง key มา = แก้ช่องนั้น · note '' = ล้าง
--                 phones_upsert?: [{id?, phone, label?, sort_order?}],   ← มี id = แก้เบอร์เดิม · ไม่มี = เพิ่ม
--                 phones_delete?: [id, ...] }
--      * host / admin / recorder · admin & recorder ต้องอยู่ในขอบเขตสาขา (branch_in_scope) ไม่งั้น 42501
--      * "ลูกค้าทีมอื่น" (เฉพาะ recorder) — ดู customer_contact_is_cross_team() ข้อ 5:
--        ไม่ส่ง confirm_cross_team = true → CC001 (ไม่แก้อะไรเลย) · ส่ง true → แก้ได้ + บันทึกว่าข้ามทีม
--      * ทุกครั้งที่บันทึก ตั้ง customers.contact_updated_at / contact_updated_by / contact_cross_team
--        → trigger audit_customers เดิมเก็บแถว audit ที่มี "contact_cross_team": true ใน new_data
--        (ไม่ต้องแก้ audit_trigger) และหน้าจอใช้แสดง "แก้ไขล่าสุด … (ข้ามทีม)" ตาม mockup
--      * เบอร์ที่แก้/ลบ หา customer_id จากแถวเบอร์เอง — ไม่เชื่อ customer_id ที่ส่งมา (เบอร์ของลูกค้าอื่น → AG004)
--      * ล็อกแถวลูกค้า (FOR UPDATE) กันบันทึกพร้อมกันแล้วเบอร์หายหมด
--   5. customer_contact_is_cross_team(customer_id) — "ลูกค้าของทีมอื่น" สำหรับ recorder
--      (customers ไม่มี team_id · SPEC D8 ทีมบันทึกต่อการเข้า) จึงนิยาม:
--      * ทีมของลูกค้า = ทีมใน contract_teams ของทุกสัญญาของลูกค้า ∪ ทีมของการเข้าบริการครั้งล่าสุด (visit_teams)
--      * ข้ามทีม = ลูกค้ามีทีมอย่างน้อย 1 ทีม และทีมของผู้ใช้ (profiles.team_id) ไม่อยู่ในชุดนั้น
--        - ลูกค้ายังไม่มีทีมเลย → ไม่ถือว่าข้ามทีม · ลูกค้ามีหลายทีมและตรง 1 ทีม → ไม่ข้าม
--        - ผู้ใช้ไม่มี team_id แต่ลูกค้ามีทีม → ข้ามทีม
--      * host / admin → false เสมอ (กติกาข้ามทีมใช้กับหัวหน้างานเท่านั้น)
--      * FE เรียกก่อนเปิดแก้ เพื่อถามยืนยัน 1 ครั้งต่อลูกค้า (mockup) — หรือจับ CC001 จาก save ก็ได้
--   6. customers_contact_meta_guard (BEFORE INSERT/UPDATE บน customers) — กันปลอมค่า contact_* ผ่าน REST:
--      เขียนตรงจาก API (current_user anon/authenticated) → INSERT ล้างเป็นค่าว่าง · UPDATE คงค่าเดิม
--      แต่ถ้าแก้ contact_name / note ตรง (admin/host) ระบบประทับเวลา + ผู้แก้ + ข้ามทีม = false ให้เอง
--      RPC (SECURITY DEFINER, current_user = เจ้าของตาราง) ไม่ติดด่าน
--   * error ใหม่ (MESSAGE ภาษาไทยแสดงผู้ใช้ได้ตรง):
--       CC001 ลูกค้าของทีมอื่น ต้องยืนยันก่อน (DETAIL = JSON รหัสทีมของลูกค้า)
--       CC002 ข้อมูลไม่ถูกต้อง (เบอร์ผิดรูปแบบ / ชื่อผู้ติดต่อว่างหรือยาวเกิน / หมายเหตุยาวเกิน / ชื่อหน้าที่ยาวเกิน)
--       CC003 เบอร์ซ้ำกับเบอร์ที่มีอยู่ของลูกค้านี้
--       CC004 ลบเบอร์สุดท้ายไม่ได้
--     ใช้ร่วมของเดิม: AG004 ไม่พบลูกค้า/เบอร์ · 42501 ไม่มีสิทธิ์ · 22023 payload ผิดรูปแบบ
--   * customers.phone (คอลัมน์เดิม 1 เบอร์) ไม่แตะ ไม่ย้ายข้อมูลในไฟล์นี้ — ทางเลือกอยู่ใน M19a-report.md

-- =====================================================================
-- 1. customers: หมายเหตุ + ข้อมูลการแก้ข้อมูลติดต่อล่าสุด
-- =====================================================================
ALTER TABLE public.customers
  ADD COLUMN note               text,
  ADD COLUMN contact_updated_at timestamptz,
  ADD COLUMN contact_updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN contact_cross_team boolean NOT NULL DEFAULT false;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_note_length CHECK (note IS NULL OR char_length(note) <= 300);

COMMENT ON COLUMN public.customers.note IS 'หมายเหตุลูกค้า (≤ 300) — แก้ได้โดย host/admin/หัวหน้างาน (M19a)';
COMMENT ON COLUMN public.customers.contact_updated_at IS 'เวลาที่แก้ผู้ติดต่อ/เบอร์/หมายเหตุล่าสุด (ระบบตั้ง · M19a)';
COMMENT ON COLUMN public.customers.contact_updated_by IS 'ผู้แก้ข้อมูลติดต่อล่าสุด (ระบบตั้ง · M19a)';
COMMENT ON COLUMN public.customers.contact_cross_team IS
  'true = การแก้ข้อมูลติดต่อครั้งล่าสุดเป็นหัวหน้างานทีมอื่น (ยืนยันแล้ว) — เก็บใน audit_log ผ่าน audit_customers (M19a)';

-- =====================================================================
-- 2. customer_phones
-- =====================================================================
CREATE TABLE public.customer_phones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  phone       text NOT NULL,
  label       text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_phones_phone_format CHECK (phone ~ '^[0-9+()\s,/.-]{8,40}$'),
  CONSTRAINT customer_phones_phone_has_digit CHECK (phone ~ '[0-9]'),
  CONSTRAINT customer_phones_label_length CHECK (label IS NULL OR char_length(label) <= 40)
);

CREATE INDEX customer_phones_customer_idx ON public.customer_phones (customer_id, sort_order, created_at);
-- เบอร์ซ้ำในลูกค้าเดียวกัน (เทียบเฉพาะตัวเลข)
CREATE UNIQUE INDEX customer_phones_customer_digits_key
  ON public.customer_phones (customer_id, (regexp_replace(phone, '[^0-9]', '', 'g')));

COMMENT ON TABLE public.customer_phones IS
  'เบอร์โทรลูกค้า (หลายเบอร์ + ชื่อ/หน้าที่) — ข้อมูลส่วนบุคคล PDPA · viewer/anon ห้ามอ่าน (M19a)';

-- updated_at + ห้ามย้ายเบอร์ไปลูกค้าอื่น
CREATE FUNCTION public.customer_phones_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'ย้ายเบอร์โทรไปลูกค้าอื่นไม่ได้ — ลบแล้วเพิ่มใหม่ที่ลูกค้าปลายทาง' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_phones_before_update
  BEFORE UPDATE ON public.customer_phones
  FOR EACH ROW EXECUTE FUNCTION public.customer_phones_before_update();

-- audit: ใช้ฟังก์ชันเดิม (ไม่ CREATE OR REPLACE audit_trigger — M21 เป็นเจ้าของเนื้อฟังก์ชัน)
CREATE TRIGGER audit_customer_phones
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_phones
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- RLS
ALTER TABLE public.customer_phones ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_phones_select ON public.customer_phones FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));
CREATE POLICY customer_phones_host_write ON public.customer_phones FOR ALL TO authenticated
  USING (public.is_host()) WITH CHECK (public.is_host());
CREATE POLICY customer_phones_admin_insert ON public.customer_phones FOR INSERT TO authenticated
  WITH CHECK (public.current_app_role() = 'admin'
    AND public.branch_in_scope((SELECT cu.branch_id FROM public.customers cu WHERE cu.id = customer_id)));
CREATE POLICY customer_phones_admin_update ON public.customer_phones FOR UPDATE TO authenticated
  USING (public.current_app_role() = 'admin'
    AND public.branch_in_scope((SELECT cu.branch_id FROM public.customers cu WHERE cu.id = customer_id)))
  WITH CHECK (public.current_app_role() = 'admin'
    AND public.branch_in_scope((SELECT cu.branch_id FROM public.customers cu WHERE cu.id = customer_id)));
CREATE POLICY customer_phones_admin_delete ON public.customer_phones FOR DELETE TO authenticated
  USING (public.current_app_role() = 'admin'
    AND public.branch_in_scope((SELECT cu.branch_id FROM public.customers cu WHERE cu.id = customer_id)));

-- GRANT 2 ชั้น (ในเครื่อง = cloud): ล้างสิทธิ์ default ก่อน แล้วให้เฉพาะที่ต้องใช้
REVOKE ALL ON public.customer_phones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_phones TO authenticated;
GRANT ALL ON public.customer_phones TO service_role;

-- =====================================================================
-- 3. customers: กันปลอมค่า contact_* ผ่าน REST (ข้อ 6 ใน summary)
-- =====================================================================
CREATE FUNCTION public.customers_contact_meta_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- RPC SECURITY DEFINER / migration / service_role ผ่าน · ตรวจเฉพาะคำขอตรงจาก API ของผู้ใช้
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.contact_updated_at := NULL;
    NEW.contact_updated_by := NULL;
    NEW.contact_cross_team := false;
  ELSIF NEW.contact_name IS DISTINCT FROM OLD.contact_name OR NEW.note IS DISTINCT FROM OLD.note THEN
    NEW.contact_updated_at := clock_timestamp();
    NEW.contact_updated_by := auth.uid();
    NEW.contact_cross_team := false;
  ELSE
    NEW.contact_updated_at := OLD.contact_updated_at;
    NEW.contact_updated_by := OLD.contact_updated_by;
    NEW.contact_cross_team := OLD.contact_cross_team;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER customers_contact_meta_guard
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.customers_contact_meta_guard();

-- =====================================================================
-- 4. customer_contact_is_cross_team(customer_id)
-- =====================================================================
-- ทีมของลูกค้า = contract_teams ทุกสัญญา ∪ ทีมของการเข้าครั้งล่าสุด (ใช้ภายในเท่านั้น — ไม่ GRANT ให้ผู้ใช้)
CREATE FUNCTION public.customer_team_ids(p_customer_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(array_agg(DISTINCT t.team_id), '{}')
    FROM (
      SELECT ct.team_id
        FROM public.contract_teams ct
        JOIN public.contracts c ON c.id = ct.contract_id
       WHERE c.customer_id = p_customer_id
      UNION
      SELECT vt.team_id
        FROM public.visit_teams vt
       WHERE vt.visit_id = (
         SELECT v.id
           FROM public.visits v
           JOIN public.contracts c ON c.id = v.contract_id
          WHERE c.customer_id = p_customer_id
          ORDER BY v.visit_date DESC, v.created_at DESC
          LIMIT 1)
    ) t;
$$;

CREATE FUNCTION public.customer_contact_is_cross_team(p_customer_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role  public.user_role := public.current_app_role();
  v_team  uuid;
  v_teams uuid[];
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูข้อมูลลูกค้า' USING ERRCODE = '42501';
  END IF;
  IF v_role <> 'recorder' THEN
    RETURN false;
  END IF;

  SELECT p.team_id INTO v_team FROM public.profiles p WHERE p.user_id = auth.uid();
  v_teams := public.customer_team_ids(p_customer_id);

  IF cardinality(v_teams) = 0 THEN
    RETURN false;
  END IF;
  RETURN v_team IS NULL OR NOT (v_team = ANY (v_teams));
END;
$$;

-- =====================================================================
-- 5. save_customer_contact(p jsonb)
-- =====================================================================
CREATE FUNCTION public.save_customer_contact(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role        public.user_role := public.current_app_role();
  v_customer_id uuid;
  v_branch      uuid;
  v_cross       boolean;
  v_confirm     boolean;
  v_contact     text;
  v_note        text;
  v_item        jsonb;
  v_phone_id    uuid;
  v_phone       text;
  v_label       text;
  v_sort        integer;
  v_owner       uuid;
  v_before      integer;
  v_after       integer;
  v_added       uuid[] := '{}';
  v_teams       jsonb;
BEGIN
  -- ---- รูปแบบ payload ----
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a json object' USING ERRCODE = '22023';
  END IF;
  IF (p ? 'phones_upsert') AND jsonb_typeof(p -> 'phones_upsert') <> 'array' THEN
    RAISE EXCEPTION 'phones_upsert must be an array' USING ERRCODE = '22023';
  END IF;
  IF (p ? 'phones_delete') AND jsonb_typeof(p -> 'phones_delete') <> 'array' THEN
    RAISE EXCEPTION 'phones_delete must be an array' USING ERRCODE = '22023';
  END IF;
  IF coalesce(jsonb_array_length(p -> 'phones_upsert'), 0) + coalesce(jsonb_array_length(p -> 'phones_delete'), 0) > 50 THEN
    RAISE EXCEPTION 'too many items in one save' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_customer_id := (p ->> 'customer_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'customer_id is not a valid id' USING ERRCODE = '22023';
  END;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id is required' USING ERRCODE = '22023';
  END IF;
  IF (p ? 'confirm_cross_team') AND jsonb_typeof(p -> 'confirm_cross_team') NOT IN ('boolean', 'null') THEN
    RAISE EXCEPTION 'confirm_cross_team must be true or false' USING ERRCODE = '22023';
  END IF;
  v_confirm := coalesce((p ->> 'confirm_cross_team')::boolean, false);

  -- ---- สิทธิ์ ----
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้ข้อมูลติดต่อลูกค้า' USING ERRCODE = '42501';
  END IF;

  SELECT cu.branch_id INTO v_branch FROM public.customers cu WHERE cu.id = v_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบลูกค้า' USING ERRCODE = 'AG004';
  END IF;
  IF v_role <> 'host' AND NOT public.branch_in_scope(v_branch) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้ข้อมูลลูกค้าสาขานี้' USING ERRCODE = '42501';
  END IF;

  -- ---- ข้ามทีม (เฉพาะ recorder) ----
  v_cross := public.customer_contact_is_cross_team(v_customer_id);
  IF v_cross AND NOT v_confirm THEN
    SELECT coalesce(jsonb_agg(t.code ORDER BY t.code), '[]'::jsonb) INTO v_teams
      FROM public.teams t
     WHERE t.id = ANY (public.customer_team_ids(v_customer_id));
    RAISE EXCEPTION 'ลูกค้ารายนี้เป็นของทีมอื่น — ยืนยันก่อนแก้ข้อมูลติดต่อ'
      USING ERRCODE = 'CC001', DETAIL = jsonb_build_object('team_codes', v_teams)::text;
  END IF;

  -- ---- ผู้ติดต่อ / หมายเหตุ ----
  IF p ? 'contact_name' THEN
    v_contact := btrim(p ->> 'contact_name');
    IF v_contact IS NULL OR v_contact = '' THEN
      RAISE EXCEPTION 'กรุณากรอกชื่อผู้ติดต่อ' USING ERRCODE = 'CC002';
    END IF;
    IF char_length(v_contact) > 80 THEN
      RAISE EXCEPTION 'ชื่อผู้ติดต่อยาวเกิน 80 ตัวอักษร' USING ERRCODE = 'CC002';
    END IF;
  END IF;
  IF p ? 'note' THEN
    v_note := nullif(btrim(p ->> 'note'), '');
    IF char_length(v_note) > 300 THEN
      RAISE EXCEPTION 'หมายเหตุยาวเกิน 300 ตัวอักษร' USING ERRCODE = 'CC002';
    END IF;
  END IF;

  UPDATE public.customers cu SET
    contact_name       = CASE WHEN p ? 'contact_name' THEN v_contact ELSE cu.contact_name END,
    note               = CASE WHEN p ? 'note' THEN v_note ELSE cu.note END,
    contact_updated_at = clock_timestamp(),
    contact_updated_by = auth.uid(),
    contact_cross_team = v_cross,
    updated_at         = now()
  WHERE cu.id = v_customer_id;

  SELECT count(*) INTO v_before FROM public.customer_phones WHERE customer_id = v_customer_id;

  -- ---- ลบเบอร์ ----
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p -> 'phones_delete', '[]'::jsonb)) LOOP
    BEGIN
      v_phone_id := (v_item #>> '{}')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'phones_delete has an invalid id' USING ERRCODE = '22023';
    END;
    DELETE FROM public.customer_phones WHERE id = v_phone_id AND customer_id = v_customer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ไม่พบเบอร์โทรนี้ของลูกค้ารายนี้' USING ERRCODE = 'AG004';
    END IF;
  END LOOP;

  -- ---- เพิ่ม / แก้เบอร์ ----
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p -> 'phones_upsert', '[]'::jsonb)) LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'phones_upsert items must be objects' USING ERRCODE = '22023';
    END IF;
    v_phone := btrim(v_item ->> 'phone');
    v_label := nullif(btrim(v_item ->> 'label'), '');
    IF v_phone IS NULL OR v_phone !~ '^[0-9+()\s,/.-]{8,40}$' OR v_phone !~ '[0-9]' THEN
      RAISE EXCEPTION 'เบอร์โทรไม่ถูกต้อง — ใช้ตัวเลข เว้นวรรค - + ( ) ได้ อย่างน้อย 8 ตัว' USING ERRCODE = 'CC002';
    END IF;
    IF char_length(v_label) > 40 THEN
      RAISE EXCEPTION 'ชื่อ/หน้าที่ของเบอร์ยาวเกิน 40 ตัวอักษร' USING ERRCODE = 'CC002';
    END IF;
    BEGIN
      v_phone_id := (v_item ->> 'id')::uuid;
      v_sort     := (v_item ->> 'sort_order')::integer;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'phones_upsert has an invalid id or sort_order' USING ERRCODE = '22023';
    END;

    -- เบอร์ซ้ำ (เทียบตัวเลข) กับเบอร์อื่นของลูกค้านี้
    IF EXISTS (SELECT 1 FROM public.customer_phones cp
                WHERE cp.customer_id = v_customer_id
                  AND cp.id IS DISTINCT FROM v_phone_id
                  AND regexp_replace(cp.phone, '[^0-9]', '', 'g') = regexp_replace(v_phone, '[^0-9]', '', 'g')) THEN
      RAISE EXCEPTION 'มีเบอร์นี้อยู่แล้ว' USING ERRCODE = 'CC003';
    END IF;

    IF v_phone_id IS NULL THEN
      IF v_sort IS NULL THEN
        SELECT coalesce(max(sort_order), 0) + 1 INTO v_sort
          FROM public.customer_phones WHERE customer_id = v_customer_id;
      END IF;
      BEGIN
        INSERT INTO public.customer_phones (customer_id, phone, label, sort_order)
        VALUES (v_customer_id, v_phone, v_label, v_sort)
        RETURNING id INTO v_phone_id;
      EXCEPTION WHEN unique_violation THEN   -- เพิ่มพร้อมกันจากทางเขียนตรง (admin/host) → ข้อความเดียวกัน
        RAISE EXCEPTION 'มีเบอร์นี้อยู่แล้ว' USING ERRCODE = 'CC003';
      END;
      v_added := v_added || v_phone_id;
    ELSE
      SELECT cp.customer_id INTO v_owner FROM public.customer_phones cp WHERE cp.id = v_phone_id;
      IF v_owner IS NULL OR v_owner <> v_customer_id THEN
        RAISE EXCEPTION 'ไม่พบเบอร์โทรนี้ของลูกค้ารายนี้' USING ERRCODE = 'AG004';
      END IF;
      BEGIN
        UPDATE public.customer_phones cp SET
          phone      = v_phone,
          label      = v_label,
          sort_order = coalesce(v_sort, cp.sort_order)
        WHERE cp.id = v_phone_id;
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'มีเบอร์นี้อยู่แล้ว' USING ERRCODE = 'CC003';
      END;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_after FROM public.customer_phones WHERE customer_id = v_customer_id;
  IF v_before > 0 AND v_after = 0 THEN
    RAISE EXCEPTION 'ลบเบอร์สุดท้ายไม่ได้ — ลูกค้าต้องมีเบอร์โทรอย่างน้อย 1 เบอร์' USING ERRCODE = 'CC004';
  END IF;

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'cross_team', v_cross,
    'added_phone_ids', to_jsonb(v_added));
END;
$$;

-- =====================================================================
-- 6. สิทธิ์ function
-- =====================================================================
REVOKE ALL ON FUNCTION public.customer_phones_before_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customers_contact_meta_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_team_ids(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_contact_is_cross_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_contact_is_cross_team(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_customer_contact(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_customer_contact(jsonb) TO authenticated;
