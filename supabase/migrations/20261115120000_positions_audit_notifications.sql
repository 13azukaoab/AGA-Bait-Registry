-- M21: ชื่อตำแหน่ง + ตำแหน่ง "เจ้าของ" · ตำแหน่งผู้แก้ใน audit · แจ้งเตือนที่ยังไม่อ่าน · division_scope อัตโนมัติ
-- (DECISIONS M21 — เจ้าของอนุมัติ ①–③ 15 พ.ย. 2026 · division_scope ข้อ ก · SPEC §5/§5.1 v1.9)
--
-- Logic summary (สำหรับทีม):
--   1. positions
--      * ชื่อเต็ม (name_th) / ชื่อสั้น (short_name_th — คอลัมน์ใหม่): แอดมิน (Admin)/แอดมิน ·
--        หัวหน้างาน (Supervisor)/หัวหน้างาน · Project Manager (PM)/PM · Operation Manager (OM)/OM · เจ้าของ/เจ้าของ
--        (code เดิม — RLS/โค้ดอ้าง code ไม่ต้องแก้) · ไม่ระบุชื่อสั้น → ใช้ชื่อเต็ม
--      * คอลัมน์ใหม่ `assignable` (true = เลือกได้จากหน้าจัดการผู้ใช้) · ตำแหน่งใหม่ `owner` = "เจ้าของ"
--        ระดับ host · assignable = false
--      * "เส้นทาง API" = คำขอที่มาทาง PostgREST / Supabase client (role anon / authenticated / service_role
--        หรือ session_user = authenticator) — ดู `is_api_session()`
--        - เส้นทาง API ตั้ง/ถอดตำแหน่งเจ้าของไม่ได้ (รวม service_role ที่ server ใช้สร้างผู้ใช้) และแก้/ปิด/ลบ
--          บัญชีของผู้ถือตำแหน่งเจ้าของไม่ได้ ยกเว้นเจ้าของแก้แถวตัวเอง (เช่น touch_last_login) — error PS001
--        - เส้นทาง API แก้/ลบแถวตำแหน่งที่ assignable = false, เปลี่ยนค่า assignable, หรือสร้างตำแหน่ง
--          assignable = false ไม่ได้ — error PS002
--        - ตั้งเจ้าของได้ทางเดียว: ผู้ดูแลฐานข้อมูลรัน SQL ตรง (Supabase SQL Editor / role postgres) เช่น
--            UPDATE public.profiles SET position_code = 'owner' WHERE username = '<username>';
--   2. audit_log.actor_position_code = ตำแหน่งของผู้แก้ ณ ตอนแก้ (ไม่มี FK — แถว audit ต้องอยู่ต่อแม้ตำแหน่ง
--      ถูกเปลี่ยนชื่อ/ลบ) · ไม่มีผู้ใช้ (service / migration) → NULL
--      audit_trigger: เนื้อเดียวกับ M18 (20261114200000) ทุกบรรทัด เพิ่มเฉพาะจุดที่ติดป้าย "M21"
--      ⚠⚠ ตัวถัดไปที่แทน audit_trigger (CREATE OR REPLACE) ต้องใช้เนื้อจาก M21 (ไฟล์นี้) ไม่ใช่ M18 หรือเก่ากว่า
--         ไม่งั้น actor_position_code หายเงียบ — เทส 37 ล้มทันทีถ้าแถว audit ที่ผู้ใช้ทำมี actor_position_code = NULL
--      * audit_profiles: เก็บเมื่อ position_code / role / is_active / division_scope / display_name / username
--        เปลี่ยน (ไม่เก็บ last_login / must_change_password / onboarding) · row_id = user_id
--   3. user_notifications = แจ้งเตือนรายผู้ใช้ (แถบแจ้งหลัง login)
--      * อ่านได้เฉพาะแถวของตัวเอง (RLS) · ผู้ใช้ INSERT/UPDATE/DELETE ตรงไม่ได้ (ไม่มี GRANT)
--      * เขียนโดย trigger เท่านั้น — ตอนนี้มีเรื่องเดียว: ตำแหน่งถูกเปลี่ยน (`position_changed`)
--        (การเปลี่ยน code ของตำแหน่งที่ cascade มาที่ profiles ไม่นับว่าเปลี่ยนตำแหน่ง → ไม่แจ้ง)
--      * ทำเครื่องหมายว่าอ่านแล้วผ่าน RPC `mark_notifications_read(ids)` — แก้ได้เฉพาะแถวของตัวเอง
--      * anon ไม่มีสิทธิ์ใดๆ · viewer เห็นเฉพาะแถวตัวเองเหมือนทุกคน
--   4. profiles.division_scope ค่าเริ่มต้น = {central, province} (ข้อ ก: ผู้ใช้ใหม่เห็นทุกเขต)
--      * ใช้ DEFAULT ไม่ใช่ trigger — ส่งค่ามาเอง (เช่น {central}) ยังแยกเขตได้ตามเดิม
--      * โค้ดสร้างผู้ใช้ฝั่ง server ต้อง "ไม่ส่ง" division_scope เพื่อให้ได้ค่าเริ่มต้น
--      * backfill ผู้ใช้เดิมทุกคนเป็น {central, province} (HQ ยืนยัน 15 พ.ย. 2026)

-- =====================================================================
-- 0. ตัวช่วย: คำขอนี้มาทาง API หรือไม่
--    * ไม่เป็น SECURITY DEFINER — session_user / ค่า role ของ session ไม่เปลี่ยนตาม DEFINER
--      จึงเรียกจากใน trigger DEFINER แล้วยังเห็นผู้เรียกจริง
--    * PostgREST ต่อด้วย authenticator แล้ว SET ROLE เป็น anon/authenticated/service_role
--      → เช็ก session_user ด้วย กันกรณี SET ROLE NONE กลับเป็น authenticator
--    * supabase_auth_admin = Supabase Auth (GoTrue) — auth.admin.deleteUser() ลบ auth.users แล้ว cascade มาลบ
--      profiles → ต้องนับเป็นเส้นทาง API ด้วย ไม่งั้นลบบัญชีเจ้าของผ่าน server ได้ (ผลตรวจ security review M21)
--    ⚠ auth.admin.updateUserById (รีเซ็ตรหัส / แบน / เปลี่ยนอีเมล) ไม่แตะ profiles — DB กันไม่ได้
--      → route ฝั่ง server ทุกตัวที่เรียก auth.admin.* กับผู้ใช้เป้าหมาย ต้องเช็ก positions.assignable ก่อน
-- =====================================================================
CREATE FUNCTION public.is_api_session()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT session_user::text IN ('authenticator', 'supabase_auth_admin')
      OR coalesce(current_setting('role', true), 'none') IN ('anon', 'authenticated', 'service_role')
$$;

-- =====================================================================
-- 1. positions: ชื่อแสดง + ตำแหน่งเจ้าของ
-- =====================================================================
ALTER TABLE public.positions
  ADD COLUMN assignable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.positions.assignable IS
  'true = เลือกได้จากหน้าจัดการผู้ใช้ · false (เจ้าของ) = ตั้งได้เฉพาะผู้ดูแลฐานข้อมูลผ่าน SQL (M21)';

-- ชื่อสั้น (แถบบน / ป้ายในตาราง) · ชื่อเต็มอยู่ที่ name_th
ALTER TABLE public.positions
  ADD COLUMN short_name_th text;

-- ชื่อทั้งหมดอยู่จุดนี้จุดเดียว (HQ ยืนยัน 15 พ.ย. 2026 · a6920c3 · ตรง POSITIONS ใน mockup admin-user-management)
-- code เดิมห้ามเปลี่ยน (profiles อ้างอยู่)
UPDATE public.positions p
   SET name_th = v.name_th, short_name_th = v.short_name_th
  FROM (VALUES
    ('job_admin',  'แอดมิน (Admin)',           'แอดมิน'),
    ('supervisor', 'หัวหน้างาน (Supervisor)',  'หัวหน้างาน'),
    ('pm',         'Project Manager (PM)',     'PM'),
    ('om',         'Operation Manager (OM)',   'OM')
  ) AS v (code, name_th, short_name_th)
 WHERE p.code = v.code;

INSERT INTO public.positions (code, name_th, short_name_th, role, sort_order, assignable)
VALUES ('owner', 'เจ้าของ', 'เจ้าของ', 'host', 0, false);

-- ตำแหน่งที่ host เพิ่มเองโดยไม่ระบุชื่อสั้น → ใช้ชื่อเต็มแทน (กัน NULL)
UPDATE public.positions SET short_name_th = name_th WHERE short_name_th IS NULL;
ALTER TABLE public.positions
  ALTER COLUMN short_name_th SET NOT NULL;

CREATE FUNCTION public.positions_default_short_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.short_name_th IS NULL OR btrim(NEW.short_name_th) = '' THEN
    NEW.short_name_th := NEW.name_th;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER positions_default_short_name
  BEFORE INSERT OR UPDATE OF short_name_th, name_th ON public.positions
  FOR EACH ROW EXECUTE FUNCTION public.positions_default_short_name();

-- positions: เส้นทาง API แตะตำแหน่งที่เลือกไม่ได้ / ค่า assignable ไม่ได้
CREATE FUNCTION public.positions_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_api_session() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF (TG_OP = 'INSERT' AND NOT NEW.assignable)
     OR (TG_OP = 'UPDATE' AND (NOT OLD.assignable OR NEW.assignable IS DISTINCT FROM OLD.assignable))
     OR (TG_OP = 'DELETE' AND NOT OLD.assignable) THEN
    RAISE EXCEPTION 'this position can only be managed by the database administrator'
      USING ERRCODE = 'PS002';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER positions_owner_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.positions
  FOR EACH ROW EXECUTE FUNCTION public.positions_owner_guard();

-- profiles: เส้นทาง API ตั้ง/ถอดตำแหน่งเจ้าของไม่ได้ · แก้/ปิด/ลบบัญชีเจ้าของไม่ได้ (ยกเว้นเจ้าของแก้แถวตัวเอง)
CREATE FUNCTION public.profiles_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_locked boolean := false;
  v_new_locked boolean := false;
BEGIN
  IF NOT public.is_api_session() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.position_code IS NOT NULL THEN
    SELECT NOT p.assignable INTO v_old_locked FROM public.positions p WHERE p.code = OLD.position_code;
    v_old_locked := coalesce(v_old_locked, false);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.position_code IS NOT NULL THEN
    SELECT NOT p.assignable INTO v_new_locked FROM public.positions p WHERE p.code = NEW.position_code;
    v_new_locked := coalesce(v_new_locked, false);
  END IF;

  -- ตั้ง / ถอดตำแหน่งที่เลือกไม่ได้ (รวมแก้ของตัวเอง)
  IF (TG_OP = 'INSERT' AND v_new_locked)
     OR (TG_OP = 'UPDATE' AND NEW.position_code IS DISTINCT FROM OLD.position_code
         AND (v_old_locked OR v_new_locked)) THEN
    RAISE EXCEPTION 'the owner position cannot be assigned or removed from the application'
      USING ERRCODE = 'PS001';
  END IF;

  -- แก้ / ปิด / ลบบัญชีของผู้ถือตำแหน่งที่เลือกไม่ได้ — ได้เฉพาะเจ้าตัว (แก้ ไม่ใช่ลบ)
  IF v_old_locked AND (TG_OP = 'DELETE' OR auth.uid() IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'the owner account cannot be changed from the application'
      USING ERRCODE = 'PS001';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER profiles_owner_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_owner_guard();

-- =====================================================================
-- 2. audit_log.actor_position_code + audit_trigger (เนื้อ M18 + จุด "M21")
-- =====================================================================
ALTER TABLE public.audit_log
  ADD COLUMN actor_position_code text;

COMMENT ON COLUMN public.audit_log.actor_position_code IS
  'ตำแหน่งของผู้แก้ ณ ตอนแก้ (positions.code · ไม่มี FK) · NULL = ไม่มีผู้ใช้ (service/migration) (M21)';

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
  v_actor_pos  text;   -- M21
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
    WHEN 'profiles' THEN                     -- M21: row_id = user_id ของบัญชีที่ถูกแก้
      v_row_id := NULLIF(v_rec ->> 'user_id', '')::uuid;
    ELSE
      NULL;
  END CASE;

  IF v_branch IS NULL AND v_contract IS NOT NULL THEN
    SELECT cu.branch_id INTO v_branch
      FROM public.contracts c
      JOIN public.customers cu ON cu.id = c.customer_id
     WHERE c.id = v_contract;
  END IF;

  -- M21: ตำแหน่งของผู้แก้ ณ ตอนนี้ (ไม่มีผู้ใช้ → NULL)
  IF auth.uid() IS NOT NULL THEN
    SELECT p.position_code INTO v_actor_pos FROM public.profiles p WHERE p.user_id = auth.uid();
  END IF;

  INSERT INTO public.audit_log
    (table_name, row_id, action, old_data, new_data, changed_by, branch_id, contract_id, month_key,
     actor_position_code)                                                         -- M21
  VALUES
    (TG_TABLE_NAME, v_row_id, lower(TG_OP)::public.audit_action, v_old, v_new, auth.uid(),
     v_branch, v_contract, v_month,
     v_actor_pos);                                                                -- M21

  RETURN NULL; -- AFTER trigger: return value ignored
END;
$$;

-- audit_profiles (HQ ยืนยัน 15 พ.ย. 2026): เก็บเฉพาะเมื่อ 6 ช่องนี้เปลี่ยน — position_code / role / is_active /
--   division_scope / display_name / username · ไม่เก็บ last_login / must_change_password / onboarding
--   (กันทุกการ login สร้างแถว audit) · หน้าจัดการผู้ใช้อ่าน "ตำแหน่งเดิม → ใหม่" จาก old_data/new_data
CREATE TRIGGER audit_profiles_insert_delete
  AFTER INSERT OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_profiles_update
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (OLD.position_code  IS DISTINCT FROM NEW.position_code
     OR OLD.role           IS DISTINCT FROM NEW.role
     OR OLD.is_active      IS DISTINCT FROM NEW.is_active
     OR OLD.division_scope IS DISTINCT FROM NEW.division_scope
     OR OLD.display_name   IS DISTINCT FROM NEW.display_name
     OR OLD.username       IS DISTINCT FROM NEW.username)
  EXECUTE FUNCTION public.audit_trigger();

-- =====================================================================
-- 3. user_notifications — แจ้งเตือนที่ยังไม่อ่าน (แถบแจ้งหลัง login)
-- =====================================================================
CREATE TABLE public.user_notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind       text NOT NULL CONSTRAINT user_notifications_kind_format CHECK (kind ~ '^[a-z_]{2,40}$'),
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb
             CONSTRAINT user_notifications_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);

COMMENT ON TABLE public.user_notifications IS
  'แจ้งเตือนรายผู้ใช้ · เขียนโดย trigger เท่านั้น · ผู้ใช้อ่านได้เฉพาะของตัวเอง · อ่านแล้วผ่าน mark_notifications_read (M21)';

CREATE INDEX user_notifications_user_unread_idx
  ON public.user_notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX user_notifications_user_idx
  ON public.user_notifications (user_id, created_at DESC);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_notifications_select_own ON public.user_notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ไม่มี policy INSERT/UPDATE/DELETE และไม่มี GRANT → ผู้ใช้เขียนตรงไม่ได้ (2 ชั้น)
REVOKE ALL ON public.user_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_notifications TO service_role;

-- ทำเครื่องหมายอ่านแล้ว · p_ids = NULL → ทุกแถวที่ยังไม่อ่านของตัวเอง · คืนจำนวนแถวที่เปลี่ยน
-- id ของคนอื่น / ที่ไม่มีอยู่ → ไม่มีผล (ไม่ error เพื่อไม่บอกว่ามี id นั้นอยู่)
CREATE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.user_notifications n
     SET read_at = now()
   WHERE n.user_id = auth.uid()
     AND n.read_at IS NULL
     AND (p_ids IS NULL OR n.id = ANY (p_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- แจ้งผู้ใช้เมื่อตำแหน่งถูกเปลี่ยน (ไม่นับการเปลี่ยน code ของตำแหน่งที่ cascade มา)
CREATE FUNCTION public.profiles_notify_position_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ON UPDATE CASCADE จาก positions.code: code เดิมไม่มีในตารางแล้ว = เปลี่ยนชื่อรหัส ไม่ใช่เปลี่ยนตำแหน่ง
  IF OLD.position_code IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.positions p WHERE p.code = OLD.position_code) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.user_notifications (user_id, kind, payload, created_by)
  VALUES (
    NEW.user_id,
    'position_changed',
    jsonb_build_object(
      'old_position_code', OLD.position_code,
      'old_position_name', (SELECT p.name_th FROM public.positions p WHERE p.code = OLD.position_code),
      'new_position_code', NEW.position_code,
      'new_position_name', (SELECT p.name_th FROM public.positions p WHERE p.code = NEW.position_code)
    ),
    auth.uid()
  );
  RETURN NULL; -- AFTER trigger
END;
$$;

CREATE TRIGGER profiles_notify_position_change
  AFTER UPDATE OF position_code ON public.profiles
  FOR EACH ROW WHEN (OLD.position_code IS DISTINCT FROM NEW.position_code)
  EXECUTE FUNCTION public.profiles_notify_position_change();

-- =====================================================================
-- 4. division_scope อัตโนมัติ (ข้อ ก)
-- =====================================================================
ALTER TABLE public.profiles
  ALTER COLUMN division_scope SET DEFAULT '{central,province}'::public.division[];

-- backfill ผู้ใช้เดิมทุกคน (HQ ยืนยัน 15 พ.ย. 2026 · cloud มี 3 แถว) · ลง audit_profiles (changed_by = NULL)
UPDATE public.profiles
   SET division_scope = '{central,province}'::public.division[]
 WHERE division_scope IS DISTINCT FROM '{central,province}'::public.division[];

-- =====================================================================
-- 5. สิทธิ์ function (anon ไม่ได้ · trigger function ไม่ให้ใครเรียกตรง)
-- =====================================================================
REVOKE ALL ON FUNCTION public.is_api_session()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.positions_owner_guard()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profiles_owner_guard()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profiles_notify_position_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.positions_default_short_name()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[])   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated;
