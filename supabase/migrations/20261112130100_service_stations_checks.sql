-- ก้อน ② schema หน้ากรอกข้อมูลทำบริการ: สถานี · ผลตรวจรายสถานี · F1–F10 · ตั้งสถานีเดือนแรก/Renew
-- เจ้าของอนุมัติ 12 พ.ย. 2026 (ก1 · ข1 · ค1 แบบปรับ · ง1 + ใช้เลขเดิมได้) · แบบเต็ม: docs/plans/2026-11-12-service-entry-schema.md
--
-- Logic summary:
--   * stations
--       - `station_no` = เลขนับแยกชนิด (IG-1…n, IC-1…n, AG-1…n) · แถวเก่าดึงเลขจาก `code` ถ้ามีตัวเลข
--       - ไม่ซ้ำต่อ (สัญญา, ชนิด, เลข) **เฉพาะสถานีที่ยังใช้งาน** (active / eliminated / pending_removal)
--         → ฝังแทนสถานีที่หาย/ถอน/ถอดแล้วใช้เลขเดิมได้ (เจ้าของตัดสิน — แทน DECISIONS 2.15 เดิม)
--       - `point_label` ป้ายจุด (AG · จำข้ามเดือนเพราะอยู่ที่สถานี)
--       - `contracts.stations_initialized_at` แยก "ยังไม่ระบุจำนวนสถานี" ออกจาก "ระบุแล้วว่า IC = 0"
--   * หัวหน้างาน (recorder) เขียน stations ได้ในขอบเขตหน่วยงาน (ค่าเริ่มต้นทางเทคนิคที่เจ้าของรับ):
--       เพิ่มสถานีใหม่ (ต้องเป็น active และมีเลขสถานี) · แก้ได้แค่ `status`, `removed_at`, `collected_at`, `point_label` ·
--       ลบไม่ได้ (ไม่มี policy) · trigger `stations_recorder_guard` กันแก้ช่องอื่น (42501)
--       ฟังก์ชันระบบที่เป็น SECURITY DEFINER (เช่นย้ายสถานีตอน Renew) ไม่ติดด่านนี้ เพราะทำในนามเจ้าของตาราง
--   * station_checks (เจ้าของเลือก ก1 เก็บวัสดุรายสถานี · ข1 เก็บแถว "ไม่ได้ตรวจ")
--       - เหยื่อ หาร 50 ลงตัว 0–5,000 ก. · `bait_eaten_pct` 0/25/50/75/100
--       - `termite_group` ใต้ดิน (ใส่เหยื่อ) / สวน (เคมีผง `powder_points` จุด — กรัม = จุด × 0.3 คำนวณตอนสรุป)
--       - `timber_replaced` เปลี่ยนไม้ล่อ (จำนวนชิ้นคำนวณตอนสรุป IG 2 / IC 1)
--       - `checked = false` = "ไม่ได้ตรวจจุดนี้" → ห้ามมีผลใดๆ และไม่นับเป็นรอบ F
--       - 1 สถานีมีผลได้ 1 แถวต่อการเข้า 1 ครั้ง
--   * F1–F10 (`follow_up_no`) นับต่อสถานี เฉพาะแถวที่ตรวจจริง · วันเดียวกันได้เลขเดียวกัน (กติกาเดิม)
--       - คำนวณเองเสมอทั้งตอนเพิ่มและตอนแก้ (ผู้ใช้ส่งเลขมาก็ถูกทับ)
--       - **แก้ช่องโหว่เดิม:** เพิ่ม/ลบผลตรวจ · เปลี่ยน checked · แก้วันที่ของการเข้า → คำนวณเลขใหม่ทั้งสถานี
--       - การเปลี่ยนเลข F อย่างเดียวไม่ลง audit_log (เป็นค่าที่ระบบคำนวณ ไม่ใช่การแก้ของคน —
--         กันจำนวน "แก้หลังปิดเดือน" พองเกินจริง)
--   * ตั้งสถานีเดือนแรก / Renew: `initialize_contract_stations()` (SECURITY DEFINER · ตรวจสิทธิ์เองทุกข้อ)
--       - host หรือ recorder ในขอบเขต · ทำได้ครั้งเดียวต่อสัญญา (SV007)
--       - สร้าง IG/IC ตามเลขที่ส่งมา + (ลูกค้า Renew) ย้ายสถานีที่ยังใช้งานของสัญญาเก่า
--         (`renewed_from_contract_id`) มาสัญญาใหม่ ตามที่หัวหน้างานติ๊กเลือก (เจ้าของเลือกหน้ากรอกผลบริการ)
--       - **ย้ายแถวสถานี ไม่สร้างใหม่** → F ของกล่อง AG นับต่อ · ผลบริการของสัญญาเก่าไม่ถูกย้าย
--         เปิดดูได้เสมอ · บันทึกถาวรใน `station_transfers` · สถานีที่ไม่ได้เลือกค้างที่สัญญาเก่า
--         (เข้ารายการรอเก็บสถานี §7.8) · ลบสัญญา Renew ภายหลัง → สถานีที่ย้ายเข้ามาคืนกลับสัญญาเดิมเอง
--       - error: SV007 ตั้งสถานีไปแล้ว · SV008 สถานีย้ายไม่ได้ (ไม่ใช่ของสัญญาเก่าที่ผูก / ไม่ได้ใช้งาน) ·
--         SV009 เลขสถานีไม่ถูกต้องหรือซ้ำ · AG004 ไม่พบสัญญา · 42501 ไม่มีสิทธิ์

-- =====================================================================
-- 1. stations
-- =====================================================================
ALTER TABLE public.stations
  ADD COLUMN station_no  int CONSTRAINT stations_station_no_positive CHECK (station_no > 0),
  ADD COLUMN point_label text;

UPDATE public.stations
   SET station_no = nullif(regexp_replace(code, '\D', '', 'g'), '')::int
 WHERE code ~ '\d' AND length(regexp_replace(code, '\D', '', 'g')) <= 6;

CREATE UNIQUE INDEX stations_in_use_no_key
  ON public.stations (contract_id, type, station_no)
  WHERE station_no IS NOT NULL AND status IN ('active', 'eliminated', 'pending_removal');

ALTER TABLE public.contracts ADD COLUMN stations_initialized_at timestamptz;

-- recorder: เพิ่ม/แก้สถานีในขอบเขต (ช่องที่แก้ได้คุมด้วย trigger ข้างล่าง)
CREATE POLICY stations_recorder_insert ON public.stations FOR INSERT TO authenticated
  WITH CHECK (public.current_app_role() = 'recorder' AND public.contract_in_scope(contract_id));
CREATE POLICY stations_recorder_update ON public.stations FOR UPDATE TO authenticated
  USING (public.current_app_role() = 'recorder' AND public.contract_in_scope(contract_id))
  WITH CHECK (public.current_app_role() = 'recorder' AND public.contract_in_scope(contract_id));

CREATE FUNCTION public.stations_recorder_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- ฟังก์ชันระบบแบบ SECURITY DEFINER ทำงานในนามเจ้าของตาราง (current_user ไม่ใช่ authenticated) → ผ่าน
  IF current_user <> 'authenticated' OR public.current_app_role() IS DISTINCT FROM 'recorder' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' OR NEW.removed_at IS NOT NULL OR NEW.collected_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new station must start active' USING ERRCODE = '42501';
    END IF;
    IF NEW.station_no IS NULL THEN
      RAISE EXCEPTION 'a new station needs a station number' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.contract_id  IS DISTINCT FROM OLD.contract_id
     OR NEW.type         IS DISTINCT FROM OLD.type
     OR NEW.station_no   IS DISTINCT FROM OLD.station_no
     OR NEW.code         IS DISTINCT FROM OLD.code
     OR NEW.installed_at IS DISTINCT FROM OLD.installed_at THEN
    RAISE EXCEPTION 'recorder may only change status, removed_at, collected_at and point_label'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stations_recorder_guard
  BEFORE INSERT OR UPDATE ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.stations_recorder_guard();

-- =====================================================================
-- 2. station_checks — ผลตรวจรายสถานี
-- =====================================================================
CREATE TYPE public.termite_group AS ENUM ('subterranean', 'garden');

ALTER TABLE public.station_checks
  ADD COLUMN bait_eaten_pct  smallint
    CONSTRAINT station_checks_bait_eaten_pct_step CHECK (bait_eaten_pct IN (0, 25, 50, 75, 100)),
  ADD COLUMN termite_group   public.termite_group,
  ADD COLUMN powder_points   int CONSTRAINT station_checks_powder_points_positive CHECK (powder_points > 0),
  ADD COLUMN timber_replaced boolean NOT NULL DEFAULT false,
  ADD COLUMN checked         boolean NOT NULL DEFAULT true;

ALTER TABLE public.station_checks
  ADD CONSTRAINT station_checks_bait_range CHECK (bait_added_g BETWEEN 0 AND 5000),
  ADD CONSTRAINT station_checks_unchecked_has_no_result CHECK (
    checked OR (termite_caste IS NULL AND bait_added_g IS NULL AND bait_eaten_pct IS NULL
                AND termite_group IS NULL AND powder_points IS NULL AND NOT timber_replaced)),
  ADD CONSTRAINT station_checks_garden_no_bait CHECK (
    termite_group IS DISTINCT FROM 'garden' OR coalesce(bait_added_g, 0) = 0),
  ADD CONSTRAINT station_checks_powder_only_garden CHECK (
    powder_points IS NULL OR termite_group = 'garden'),
  ADD CONSTRAINT station_checks_visit_station_key UNIQUE (visit_id, station_id);

-- =====================================================================
-- 3. F1–F10: คำนวณเอง · นับเฉพาะที่ตรวจจริง · คำนวณใหม่ทั้งสถานีเมื่อมีการเปลี่ยน
-- =====================================================================
-- ค่า F ของผลตรวจ 1 แถว (null ถ้าไม่ได้ตรวจ) — นับผลตรวจของสถานีเดียวกันที่ตรวจจริงและวันที่ก่อนหน้า
CREATE FUNCTION public.compute_follow_up_no(p_station_id uuid, p_visit_id uuid, p_check_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 1 + count(*)::int
    FROM public.station_checks sc
    JOIN public.visits v ON v.id = sc.visit_id
   WHERE sc.station_id = p_station_id
     AND sc.checked
     AND sc.id IS DISTINCT FROM p_check_id
     AND v.visit_date < (SELECT v2.visit_date FROM public.visits v2 WHERE v2.id = p_visit_id);
$$;

-- BEFORE INSERT (trigger เดิมชื่อ set_follow_up_no) + BEFORE UPDATE: ทับค่าที่ผู้ใช้ส่งมาด้วยค่าที่คำนวณ
CREATE OR REPLACE FUNCTION public.set_follow_up_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.checked THEN
    NEW.follow_up_no := public.compute_follow_up_no(NEW.station_id, NEW.visit_id, NEW.id);
  ELSE
    NEW.follow_up_no := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_follow_up_no_on_update
  BEFORE UPDATE ON public.station_checks
  FOR EACH ROW EXECUTE FUNCTION public.set_follow_up_no();

-- คำนวณใหม่ทั้งสถานี (แก้เฉพาะแถวที่เลขเปลี่ยน · UPDATE แค่ follow_up_no จึงไม่วนเรียก trigger ข้างล่าง)
CREATE FUNCTION public.renumber_station_follow_ups(p_station_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.station_checks sc
     SET follow_up_no = CASE WHEN sc.checked
                             THEN public.compute_follow_up_no(sc.station_id, sc.visit_id, sc.id) END
   WHERE sc.station_id = p_station_id
     AND sc.follow_up_no IS DISTINCT FROM
         CASE WHEN sc.checked THEN public.compute_follow_up_no(sc.station_id, sc.visit_id, sc.id) END;
$$;

CREATE FUNCTION public.station_checks_renumber()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.renumber_station_follow_ups(OLD.station_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE')
     AND (TG_OP = 'INSERT' OR NEW.station_id IS DISTINCT FROM OLD.station_id) THEN
    PERFORM public.renumber_station_follow_ups(NEW.station_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER station_checks_renumber
  AFTER INSERT OR DELETE OR UPDATE OF checked, visit_id, station_id ON public.station_checks
  FOR EACH ROW EXECUTE FUNCTION public.station_checks_renumber();

-- แก้วันที่ของการเข้า → ทุกสถานีที่ตรวจในการเข้านั้นคำนวณใหม่
-- (ลบการเข้า = ผลตรวจถูกลบตามแบบ CASCADE → trigger ข้างบนคำนวณให้เอง)
CREATE FUNCTION public.visits_renumber()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.renumber_station_follow_ups(s.station_id)
     FROM (SELECT DISTINCT sc.station_id FROM public.station_checks sc WHERE sc.visit_id = NEW.id) s;
  RETURN NULL;
END;
$$;

CREATE TRIGGER visits_renumber
  AFTER UPDATE OF visit_date ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.visits_renumber();

-- =====================================================================
-- 4. audit — ไม่ลงการเปลี่ยนเลข F อย่างเดียว (ค่าที่ระบบคำนวณ)
--    (เนื้อเดิมจาก 20261112120000 + เงื่อนไขข้ามต้นฟังก์ชัน)
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
    WHEN 'station_checks', 'visit_teams' THEN
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

-- =====================================================================
-- 5. ตั้งสถานีเดือนแรก / ย้ายสถานีตอน Renew
-- =====================================================================
CREATE TABLE public.station_transfers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id       uuid NOT NULL REFERENCES public.stations (id) ON DELETE CASCADE,
  from_contract_id uuid NOT NULL REFERENCES public.contracts (id) ON DELETE CASCADE,
  to_contract_id   uuid NOT NULL REFERENCES public.contracts (id) ON DELETE CASCADE,
  transferred_at   timestamptz NOT NULL DEFAULT now(),
  transferred_by   uuid REFERENCES auth.users (id) DEFAULT auth.uid(),
  CONSTRAINT station_transfers_different_contracts CHECK (from_contract_id <> to_contract_id)
);
CREATE INDEX station_transfers_station_id_idx ON public.station_transfers (station_id);
CREATE INDEX station_transfers_from_contract_idx ON public.station_transfers (from_contract_id);
CREATE INDEX station_transfers_to_contract_idx ON public.station_transfers (to_contract_id);

ALTER TABLE public.station_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY station_transfers_select ON public.station_transfers FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));
-- ไม่มี policy เขียน: บันทึกผ่าน initialize_contract_stations() เท่านั้น

CREATE FUNCTION public.initialize_contract_stations(
  p_contract_id          uuid,
  p_ig_nos               int[]  DEFAULT '{}',
  p_ic_nos               int[]  DEFAULT '{}',
  p_transfer_station_ids uuid[] DEFAULT '{}'
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role        public.user_role := public.current_app_role();
  v_initialized timestamptz;
  v_old         uuid;
  v_ig          int[] := coalesce(p_ig_nos, '{}');
  v_ic          int[] := coalesce(p_ic_nos, '{}');
  v_moves       uuid[] := ARRAY(SELECT DISTINCT s FROM unnest(coalesce(p_transfer_station_ids, '{}')) s
                                 WHERE s IS NOT NULL);
  v_count       int;
BEGIN
  -- สิทธิ์ (function นี้ข้าม RLS จึงตรวจเองทุกข้อ)
  IF v_role IS NULL OR v_role NOT IN ('host', 'recorder') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT c.stations_initialized_at, c.renewed_from_contract_id INTO v_initialized, v_old
    FROM public.contracts c WHERE c.id = p_contract_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;
  IF v_role <> 'host' AND NOT public.contract_in_scope(p_contract_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_initialized IS NOT NULL THEN
    RAISE EXCEPTION 'stations of this contract are already set' USING ERRCODE = 'SV007';
  END IF;

  -- เลขสถานีใหม่: บวก · ไม่ซ้ำในชุดเดียวกัน
  IF EXISTS (SELECT 1 FROM unnest(v_ig) n WHERE n IS NULL OR n <= 0)
     OR EXISTS (SELECT 1 FROM unnest(v_ic) n WHERE n IS NULL OR n <= 0)
     OR cardinality(v_ig) <> (SELECT count(DISTINCT n) FROM unnest(v_ig) n)
     OR cardinality(v_ic) <> (SELECT count(DISTINCT n) FROM unnest(v_ic) n) THEN
    RAISE EXCEPTION 'invalid or duplicate station numbers' USING ERRCODE = 'SV009';
  END IF;

  -- ย้ายสถานีจากสัญญาเก่า (Renew): ต้องเป็นของสัญญาเก่าที่ผูกไว้ และยังใช้งาน
  IF cardinality(v_moves) > 0 THEN
    IF v_old IS NULL
       OR (SELECT count(*) FROM public.stations s
            WHERE s.id = ANY (v_moves) AND s.contract_id = v_old
              AND s.status IN ('active', 'eliminated', 'pending_removal')) <> cardinality(v_moves) THEN
      RAISE EXCEPTION 'station cannot be moved to this contract' USING ERRCODE = 'SV008';
    END IF;

    -- เลขที่ย้ายมาต้องไม่ชนกับเลขใหม่ที่จะสร้าง
    IF EXISTS (SELECT 1 FROM public.stations s
                WHERE s.id = ANY (v_moves)
                  AND ((s.type = 'IG' AND s.station_no = ANY (v_ig))
                    OR (s.type = 'IC' AND s.station_no = ANY (v_ic)))) THEN
      RAISE EXCEPTION 'station number already used by a moved station' USING ERRCODE = 'SV009';
    END IF;

    UPDATE public.stations s SET contract_id = p_contract_id, updated_at = now()
     WHERE s.id = ANY (v_moves);

    INSERT INTO public.station_transfers (station_id, from_contract_id, to_contract_id)
    SELECT m, v_old, p_contract_id FROM unnest(v_moves) m;
  END IF;

  INSERT INTO public.stations (contract_id, type, station_no, status)
  SELECT p_contract_id, 'IG'::public.station_type, n, 'active'::public.station_status FROM unnest(v_ig) n
  UNION ALL
  SELECT p_contract_id, 'IC'::public.station_type, n, 'active'::public.station_status FROM unnest(v_ic) n;

  UPDATE public.contracts c SET stations_initialized_at = now() WHERE c.id = p_contract_id;

  SELECT count(*) INTO v_count FROM public.stations s
   WHERE s.contract_id = p_contract_id AND s.status IN ('active', 'eliminated', 'pending_removal');
  RETURN v_count;
END;
$$;

-- ลบสัญญา Renew → สถานีที่ย้ายเข้ามา **คืนกลับสัญญาเดิม** (ไม่ให้หายไปพร้อมสัญญาแบบ CASCADE)
-- กรณีจริง: บันทึกผลบริการครั้งแรก (ย้ายสถานี) → ลบผลบริการนั้น → admin ลบสัญญา Renew ที่เปิดผิด
-- สถานี IG/IC ที่ยังฝังอยู่หน้างานต้องไม่หายจากทั้ง 2 สัญญา · ทำเป็น trigger บน contracts จึงครอบทั้ง
-- delete_job_opening() และการลบตรงของ host · เลขชนกับสถานีที่สัญญาเดิมเพิ่มภายหลัง = unique index ปฏิเสธการลบ
CREATE FUNCTION public.contracts_return_transferred_stations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.stations s
     SET contract_id = t.from_contract_id, updated_at = now()
    FROM public.station_transfers t
   WHERE t.to_contract_id = OLD.id
     AND t.station_id = s.id
     AND s.contract_id = OLD.id;

  DELETE FROM public.station_transfers t WHERE t.to_contract_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER contracts_return_transferred_stations
  BEFORE DELETE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_return_transferred_stations();

-- =====================================================================
-- 6. สิทธิ์ (ตาราง/function ใหม่ต้องกำหนดในไฟล์นี้ — CLAUDE.md)
-- =====================================================================
REVOKE ALL ON public.station_transfers FROM PUBLIC;
REVOKE ALL ON public.station_transfers FROM anon;
REVOKE ALL ON public.station_transfers FROM authenticated;
GRANT SELECT ON public.station_transfers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.station_transfers TO service_role;

REVOKE ALL ON FUNCTION public.stations_recorder_guard()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compute_follow_up_no(uuid, uuid, uuid)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renumber_station_follow_ups(uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.station_checks_renumber()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.visits_renumber()                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contracts_return_transferred_stations()    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.initialize_contract_stations(uuid, int[], int[], uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initialize_contract_stations(uuid, int[], int[], uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.initialize_contract_stations(uuid, int[], int[], uuid[]) TO authenticated;
