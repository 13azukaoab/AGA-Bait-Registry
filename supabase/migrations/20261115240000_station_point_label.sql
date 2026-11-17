-- M37 (DECISIONS 2.60 + 2.65 — เจ้าของอนุมัติ 17 พ.ย. 2026): แก้ "ป้ายจุด" กล่อง AG อย่างเดียว ไม่ต้องบันทึกการเข้าบริการ
--
-- Logic summary:
--   1. RPC ใหม่ `set_station_point_label(p_station_id, p_point_label)` → (station_id, point_label, updated_at)
--      * SECURITY DEFINER (search_path ตายตัว) · REVOKE PUBLIC/anon · GRANT authenticated
--      * ลำดับด่าน (กันใช้ error เดาข้อมูล):
--          ① ตำแหน่ง: host หรือ recorder เท่านั้น — admin / viewer / ไม่มีโปรไฟล์ → 42501
--          ② ความยาว: ตัดช่องว่างหัวท้าย (btrim) · ว่าง = NULL · เกิน 40 ตัวอักษร (char_length) → 22001
--             (40 = maxLength ของช่องป้ายในหน้าบันทึกบริการ components/service/AgSection.tsx)
--          ③ ขอบเขต: recorder ต้องเป็นสถานีในขอบเขต (station_in_scope) · ไม่พบ/นอกขอบเขต → 42501 (ไม่บอกว่ามีอยู่จริงไหม)
--          ④ ล็อกแถว (FOR UPDATE) กันบันทึกบริการถอดกล่องพร้อมกัน · host ส่ง id ที่ไม่มี → AG004
--             แล้วตรวจขอบเขต recorder ซ้ำจากแถวที่ล็อก (contract_in_scope) กันสถานีถูกย้ายสัญญาระหว่าง ③ กับ ④
--          ⑤ เฉพาะกล่อง AG → อื่นๆ SV012
--          ⑥ สถานะต้องเป็น active / pending_removal → removed / eliminated / lost / withdrawn = SV013
--      * แก้เฉพาะ point_label + updated_at · ไม่สร้าง visits / station_checks · ไม่แตะรอบ F / status / pending_removal_month
--      * ค่าเท่าเดิม → ไม่ UPDATE (ไม่เกิดแถว audit เปล่า) คืนแถวปัจจุบัน
--      * audit: `audit_stations` (audit_trigger M21 · ไม่แทนที่) เก็บ old/new + changed_by + actor_position_code เอง
--   2. ปิดการแก้ป้ายตรง (REST) ทุก role (แบบ M26/33) — trigger `stations_rpc_only_point_label` → SV014
--      * ใช้กับ current_user = 'authenticated' เท่านั้น (postgres / service_role / migration / SECURITY DEFINER ผ่าน)
--      * UPDATE ที่เปลี่ยน point_label · INSERT ที่มี point_label ไม่ว่าง (ปิดทาง admin ลบสถานีแล้ว INSERT ใหม่พร้อมป้าย)
--      * ยกเว้น (ทางที่ถูก):
--          - `save_service_visit` (SECURITY INVOKER · station_labels) — ด่าน GUC `aga.service_visit` เปิดอยู่
--            (ผู้ใช้ REST ตั้ง GUC เองไม่ได้ — PostgREST ไม่เปิด set_config · แบบเดียวกับ M15)
--          - RPC นี้ — GUC `aga.point_label_edit` = id สถานี (ปกติไม่จำเป็นเพราะเป็น DEFINER · ใส่กันพลาดถ้าวันหน้าเปลี่ยนเป็น INVOKER)
--          - `service_work_set_installs` (SECURITY DEFINER) ไม่ติดด่านอยู่แล้ว
--      * ชื่อ trigger ขึ้นต้น 'stations_rp…' → เรียงหลัง stations_finished_status_guard / stations_install_bait_guard /
--        stations_pending_removal_month / stations_recorder_guard → UPDATE ที่ผิดกฎเดิมด้วย ได้ error เดิม (42501) ก่อน
--   * error ใหม่ (ตระกูล SV · MESSAGE ภาษาไทย):
--       SV012 แก้ป้ายจุดแยกได้เฉพาะกล่อง AG
--       SV013 สถานีถอด/กำจัด/หาย/ถอนออกแล้ว แก้ป้ายไม่ได้
--       SV014 แก้ป้ายจุดตรงไม่ได้ ต้องผ่านหน้าบันทึกบริการหรือปุ่มแก้ป้าย (set_station_point_label)
--   * ข้อจำกัดที่รู้ (นอกขอบเขต M37 · ห้ามแทนที่ save_service_visit): ทาง station_labels ของ save_service_visit
--     ยังแก้ป้ายสถานีทุกชนิด/ทุกสถานะ และไม่มีเพดานความยาว — แจ้ง HQ แล้ว
--   * เทส: supabase/tests/50_station_point_label.test.sql (+ ปรับคู่ควบคุมใน 25 / 30 / 31 / 32 / 41)

-- =====================================================================
-- 1. ด่าน REST: แก้ป้ายจุดตรงไม่ได้ (ทุก role)
-- =====================================================================
CREATE FUNCTION public.stations_point_label_rpc_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ระบบ (postgres / service_role / migration) และฟังก์ชัน SECURITY DEFINER ผ่าน
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  -- ไม่ได้แตะป้าย → ไม่ใช่เรื่องของด่านนี้
  IF (TG_OP = 'UPDATE' AND NEW.point_label IS NOT DISTINCT FROM OLD.point_label)
     OR (TG_OP = 'INSERT' AND NEW.point_label IS NULL) THEN
    RETURN NEW;
  END IF;
  -- ทางที่ถูก: บันทึกบริการ (save_service_visit · station_labels)
  IF coalesce(current_setting('aga.service_visit', true), '') <> '' THEN
    RETURN NEW;
  END IF;
  -- ทางที่ถูก: set_station_point_label (เฉพาะสถานีที่ RPC เปิดไว้)
  IF TG_OP = 'UPDATE'
     AND coalesce(current_setting('aga.point_label_edit', true), '') = NEW.id::text THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'แก้ป้ายจุดตรงไม่ได้ ต้องแก้ผ่านหน้าบันทึกบริการหรือปุ่มแก้ป้ายจุด'
    USING ERRCODE = 'SV014';
END;
$$;

REVOKE ALL ON FUNCTION public.stations_point_label_rpc_only() FROM PUBLIC, anon, authenticated;

-- ชื่อ 'stations_rp…' เรียงหลัง guard เดิมทุกตัวบน stations (BEFORE trigger เรียกตามชื่อ)
CREATE TRIGGER stations_rpc_only_point_label
  BEFORE INSERT OR UPDATE ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.stations_point_label_rpc_only();

-- =====================================================================
-- 2. RPC: แก้ป้ายจุดกล่อง AG อย่างเดียว
-- =====================================================================
CREATE FUNCTION public.set_station_point_label(p_station_id uuid, p_point_label text)
RETURNS TABLE (station_id uuid, point_label text, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_label  text := nullif(btrim(p_point_label), '');
  s        record;
BEGIN
  -- ① ตำแหน่งก่อน (admin / viewer / ไม่มีโปรไฟล์ ไม่ได้ลองค้นแถว)
  IF NOT (public.is_host() OR public.current_app_role() IS NOT DISTINCT FROM 'recorder') THEN
    RAISE EXCEPTION 'not allowed to edit point labels' USING ERRCODE = '42501';
  END IF;

  -- ② ความยาว (นับตัวอักษร ไม่ใช่ byte — ภาษาไทย)
  IF char_length(v_label) > 40 THEN
    RAISE EXCEPTION 'ป้ายจุดยาวได้ไม่เกิน 40 ตัวอักษร' USING ERRCODE = '22001';
  END IF;

  -- ③ ขอบเขต (recorder) — ไม่พบ = นอกขอบเขต (ไม่บอกว่ามี id นี้หรือไม่)
  IF NOT public.is_host() AND NOT public.station_in_scope(p_station_id) THEN
    RAISE EXCEPTION 'not allowed to edit this station' USING ERRCODE = '42501';
  END IF;

  -- ④ ล็อกแถว กันบันทึกบริการเปลี่ยนสถานะพร้อมกัน
  SELECT st.id, st.contract_id, st.type, st.status, st.point_label, st.updated_at INTO s
    FROM public.stations st WHERE st.id = p_station_id
     FOR UPDATE;
  IF NOT FOUND THEN
    IF NOT public.is_host() THEN
      RAISE EXCEPTION 'not allowed to edit this station' USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'station not found' USING ERRCODE = 'AG004';
  END IF;
  -- ตรวจขอบเขตซ้ำหลังล็อก (กันสถานีถูกย้ายสัญญาระหว่างข้อ ③ กับ ④)
  IF NOT public.is_host() AND NOT public.contract_in_scope(s.contract_id) THEN
    RAISE EXCEPTION 'not allowed to edit this station' USING ERRCODE = '42501';
  END IF;

  -- ⑤ เฉพาะกล่อง AG
  IF s.type <> 'AG' THEN
    RAISE EXCEPTION 'แก้ป้ายจุดแยกได้เฉพาะกล่อง AG' USING ERRCODE = 'SV012';
  END IF;

  -- ⑥ เฉพาะสถานีที่ยังติดอยู่
  IF s.status NOT IN ('active', 'pending_removal') THEN
    RAISE EXCEPTION 'สถานีนี้ถอด/กำจัด/หาย/ถอนออกแล้ว แก้ป้ายจุดไม่ได้' USING ERRCODE = 'SV013';
  END IF;

  -- ค่าเท่าเดิม → ไม่เขียน (ไม่เกิดแถว audit เปล่า)
  IF v_label IS NOT DISTINCT FROM s.point_label THEN
    RETURN QUERY SELECT s.id, s.point_label, s.updated_at;
    RETURN;
  END IF;

  PERFORM set_config('aga.point_label_edit', p_station_id::text, true);
  RETURN QUERY
    UPDATE public.stations st
       SET point_label = v_label,
           updated_at  = now()
     WHERE st.id = p_station_id
    RETURNING st.id, st.point_label, st.updated_at;
  PERFORM set_config('aga.point_label_edit', '', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_station_point_label(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_station_point_label(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.set_station_point_label(uuid, text) IS
  'M37: แก้ป้ายจุดกล่อง AG อย่างเดียว (host / recorder ในขอบเขต · active / pending_removal) · ไม่สร้างการเข้าบริการ · '
  'error: 42501 สิทธิ์ · 22001 ยาวเกิน 40 · AG004 ไม่พบ · SV012 ไม่ใช่ AG · SV013 สถานะปิดแล้ว';
