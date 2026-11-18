-- M39 (phase 5): ปิดเดือน 2 ส่วน + คำนวณ snapshot ใหม่ + แก้ชื่อ/เวลาผู้ปิด + สถานะแบบแคบ + month_closures เขียนผ่าน RPC เท่านั้น
-- (SPEC §7.7, §9.2 · DECISIONS 2.72, 5.4, 5.8, 5.12/5.12a · CLAUDE.md กฎ 7 · เจ้าของตอบ 18 พ.ย. 2026 ผ่าน BE)
--
-- Logic summary:
--   0. สิทธิ์ (เจ้าของ 18 พ.ย.):
--      - ปิดส่วนกลาง: host หรือ recorder ที่มี 'central' ใน division_scope · ปิดต่างจังหวัด: host
--      - คำนวณ snapshot ใหม่ / แก้ชื่อ-เวลาผู้ปิด / ปิดข้ามด้วยเหตุผล: host เท่านั้น
--        (ปิดข้าม = host only เพราะ mockup ทำก่อน DECISIONS 2.72 และ 2.72 ระบุ "ผู้ดูแล (host) กดข้ามได้")
--   1. ทางเขียน: **ผู้เรียกส่งตัวเลขเองไม่ได้** — route ตรวจสิทธิ์ที่ DB ด้วย JWT ของผู้ใช้ (`can_close_month_part`)
--      → server ใช้ service role (lib/admin/monthCloseAdmin.ts) อ่านทะเบียน + คำนวณด้วย lib/rules
--      → เรียก RPC แบบ service-role-only `close_month_part(p_actor, …)` / `resync_month_part(p_actor, …)`
--      - RPC ตรวจซ้ำ 2 ชั้น: EXECUTE ให้ service_role เท่านั้น + ตรวจ role ในเนื้อฟังก์ชัน · ตรวจสิทธิ์ของ p_actor จาก profiles
--        (active · role · division_scope) เอง ไม่เชื่อ route
--      - **ผู้แก้ใน audit_log = p_actor**: หลังตรวจสิทธิ์แล้ว ฟังก์ชันตั้ง `request.jwt.claim.sub` และ `sub` ใน
--        `request.jwt.claims` = p_actor แบบ local (เฉพาะ transaction นี้ · role คง service_role) → auth.uid() ใน
--        audit_trigger = คนกดจริง (+ actor_position_code) · ช่องผู้ทำ (closed_by / overridden_by / last_resync_by) ตั้งจาก p_actor ตรงๆ
--      - **สูตรอยู่ที่ lib/rules (TypeScript) ที่เดียว** — SQL ตรวจรูปแบบแถวอย่างเดียว ไม่มีสูตรคำนวณ
--   2. month_closures เขียนผ่าน RPC เท่านั้น: ลบ policy เขียน 3 ตัว + REVOKE INSERT/UPDATE/DELETE จาก authenticated
--      และ service_role · อ่านคงเดิม (month_closures_select: host/admin/recorder)
--   3. "ส่วนกลางพร้อมปิด" (เจ้าของเลือก ก) = ทุกสาขาส่วนกลางไม่มีสัญญาที่ "ค้างบริการ" ของเดือนนั้น
--      ค้างบริการ = เกณฑ์เดียวกับ list_pending_missed_services (เนื้อล่าสุด 20261115200000 · M30) ที่ missed_month = เดือนนั้น:
--      สัญญาไม่ยกเลิก · ไม่ถูกแทน (contract_is_renewed) · ตั้งสถานีแล้ว · เดือนอยู่ในช่วง
--      missed_tracking_start_month … เดือนสุดท้ายของสัญญา (term_months) · ไม่มีการเข้า routine (ไม่ใช่ชดเชย) ในเดือนนั้น ·
--      ไม่มีการเข้าชดเชยให้เดือนนั้น · ไม่มีผลตัดสิน "ไม่ชดเชย" (waived)
--      → **หมายเหตุตกบริการ (missed_service_notes) ของเดือนนั้น นับว่าบันทึกแล้ว** (เจ้าของเลือก ก 18 พ.ย. 2026 —
--        หัวหน้างานกรอกเหตุผลตกบริการครบ = ปิดเองได้ ไม่ต้องให้ host ปิดข้าม) · ไม่ใช้ confirmed_at (เจ้าของ: ไม่บังคับ)
--      → ต่างจาก list_pending_missed_services ข้อเดียว: หมายเหตุนับเฉพาะ "ความพร้อมปิดเดือน" — สัญญานั้นยังเป็น
--        "ตกบริการรอตัดสิน" ในรายการเดิมตามปกติ (pgTAP เทียบ 2 ฟังก์ชันตอนไม่มีหมายเหตุ ต้องได้สาขาเดียวกัน)
--      → `central_unready_branches(month)` (เรียก helper เดิมตามชื่อ ได้เนื้อล่าสุดเสมอ · ไม่กรองขอบเขต recorder)
--      ไม่พร้อม → host ปิดได้พร้อมเหตุผล (MC006/MC007) · recorder ปิดไม่ได้ (MC006 · ส่งเหตุผลมา = MC014)
--   4. month_closure_overrides — เหตุผลปิดข้าม · host อ่านคนเดียว · เขียนผ่าน close_month_part · ลง audit (trigger เดิม)
--   5. audit แถว computed: UPDATE ที่ค่าเปลี่ยน (คำนวณใหม่ · ค่าเก่า/ใหม่) · DELETE · INSERT เข้าเดือน/ส่วนที่ปิดแล้ว
--      (INSERT ตอนกดปิดไม่ลง — กันประวัติรก · แถว manual ใช้ trigger เดิม)
--   6. close_month_part(p_actor, month, scope, rows, override_reason, ack_carried) — service role
--      MC001 เดือนผิด · MC002 ยังไม่จบ (ไทย) · MC003 ก่อน go-live · MC004 ปิดแล้ว · MC005 แถวผิด · MC006 ยังไม่พร้อม ·
--      MC007 เหตุผล 5–500 · MC008 มีแถว legacy/manual · MC009 ค่ายกมายังไม่รับทราบ · MC014 recorder ส่งเหตุผลปิดข้าม
--      province: ไม่มีตัวเลข (แถว manual + ค่ายกมาประกอบตอนส่งตาม 5.12/5.12a) → แถวปิดอย่างเดียว
--   7. resync_month_part(p_actor, month, scope, rows, computed_at) — service role · actor host · MC010 ยังไม่ปิด ·
--      MC013 มี resync ที่ใหม่กว่าเวลาเริ่มคำนวณ (กันเขียนทับด้วยตัวเลขเก่า) · province = บันทึกเวลาแล้วส่งใหม่
--   8. set_month_closer(month, scope, closed_by, closed_at) — host (JWT ผู้ใช้ · DECISIONS 5.8) · MC010–MC012
--   9. get_sync_status() / list_month_closures() — host/admin/recorder · ไม่มี error_message / triggered_by
--  10. start_sync_log(p_source, p_actor) แทนตัวเดิม (DROP + CREATE เพราะเพิ่มพารามิเตอร์) · close/resync = service role + actor
--      finish_sync_log: service role ปิดรอบ auto/close/resync · ผู้ใช้ปิดรอบ manual ของตัวเอง (เหมือนเดิม)
--   * error ใหม่: MC001–MC014 · 42501 = ไม่มีสิทธิ์
--   * ข้อจำกัดที่รู้: ย้ายสาขาข้ามส่วนกลาง/ต่างจังหวัดหลังปิด → resync เดือนนั้น MC005 · value_annual ของแถว computed = 0
--   * ไม่แทน audit_trigger · ตาราง month_closure_overrides ไม่อยู่ใน CASE ของ audit_trigger → audit_log.month_key ว่าง

-- =====================================================================
-- 1. month_closure_overrides
-- =====================================================================
CREATE TABLE public.month_closure_overrides (
  month_key              text NOT NULL,
  scope                  public.closure_scope NOT NULL,
  reason                 text NOT NULL
                           CONSTRAINT month_closure_overrides_reason_len
                           CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500),
  unconfirmed_branch_ids uuid[] NOT NULL DEFAULT '{}',
  overridden_by          uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  overridden_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (month_key, scope),
  FOREIGN KEY (month_key, scope) REFERENCES public.month_closures (month_key, scope) ON DELETE CASCADE
);

COMMENT ON TABLE public.month_closure_overrides IS
  'M39: เหตุผลที่ host ปิดส่วนกลางก่อนทุกสาขายืนยันครบ (DECISIONS 2.72) — host อ่านเท่านั้น · เขียนผ่าน close_month_part';

ALTER TABLE public.month_closure_overrides ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.month_closure_overrides FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.month_closure_overrides TO authenticated, service_role;

CREATE POLICY month_closure_overrides_host_select ON public.month_closure_overrides
  FOR SELECT TO authenticated USING (public.is_host());

-- audit_trigger เดิม (ไม่แทน) · ตารางนี้ไม่อยู่ใน CASE ของ audit_trigger → month_key/branch_id ใน audit_log ว่าง
-- (ข้อมูลเต็มอยู่ใน new_data) — ถ้าต้องการค้นตามเดือน แจ้ง BE เพิ่ม WHEN ในรอบแทน audit_trigger ครั้งถัดไป
CREATE TRIGGER audit_month_closure_overrides
  AFTER INSERT OR UPDATE OR DELETE ON public.month_closure_overrides
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- =====================================================================
-- 2. audit แถว computed ที่ถูกเขียนทับ (คำนวณ snapshot ใหม่)
-- =====================================================================
-- UPDATE ที่แตะแถว computed (ฝั่งใดฝั่งหนึ่ง) และไม่ใช่ manual (manual มี trigger ของตัวเอง — กันลง 2 ซ้ำ)
CREATE TRIGGER audit_snapshots_computed_update
  AFTER UPDATE ON public.monthly_branch_snapshots
  FOR EACH ROW
  WHEN ((OLD.source = 'computed' OR NEW.source = 'computed')
        AND OLD.source <> 'manual' AND NEW.source <> 'manual'
        AND OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.audit_trigger();

-- ลบแถว computed (เช่น host ลบตรงผ่าน REST) → ลงประวัติ
CREATE TRIGGER audit_snapshots_computed_delete
  AFTER DELETE ON public.monthly_branch_snapshots
  FOR EACH ROW WHEN (OLD.source = 'computed')
  EXECUTE FUNCTION public.audit_trigger();

-- INSERT แถว computed ของส่วนที่ **ปิดแล้ว** (= resync เติมแถวที่หาย / เขียนตรง) → ลงประวัติ
-- (ตอนกดปิด แถวปิดยังไม่ถูกสร้างขณะเขียน snapshot → ไม่ลง กันประวัติรก)
CREATE FUNCTION public.snapshot_month_is_closed(p_month text, p_branch uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM month_closures mc JOIN branches b ON b.id = p_branch
     WHERE mc.month_key = p_month
       AND mc.scope::text = b.division::text);
$$;

CREATE TRIGGER audit_snapshots_computed_insert_closed
  AFTER INSERT ON public.monthly_branch_snapshots
  FOR EACH ROW
  WHEN (NEW.source = 'computed' AND public.snapshot_month_is_closed(NEW.month_key, NEW.branch_id))
  EXECUTE FUNCTION public.audit_trigger();

-- =====================================================================
-- 3. month_closures เขียนผ่าน RPC เท่านั้น (เจ้าของ + HQ 18 พ.ย. 2026)
--    เดิม: month_closures_host_write (FOR ALL host) · month_closures_recorder_insert / _update (central)
--    ใหม่: เหลือ month_closures_select (อ่าน host/admin/recorder) · ไม่มีสิทธิ์เขียนตาราง (RPC SECURITY DEFINER เขียนแทน)
-- =====================================================================
DROP POLICY month_closures_host_write ON public.month_closures;
DROP POLICY month_closures_recorder_insert ON public.month_closures;
DROP POLICY month_closures_recorder_update ON public.month_closures;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.month_closures FROM authenticated, service_role;

-- =====================================================================
-- 4. helper
-- =====================================================================
-- ตรวจเดือนที่จะปิด: รูปแบบ · จบแล้ว (ไทย) · ≥ go-live
CREATE FUNCTION public.month_close_check_month(p_month text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_month IS NULL OR p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'เดือนต้องเป็นรูปแบบ YYYY-MM (ได้ %)', coalesce(p_month, 'ว่าง') USING ERRCODE = 'MC001';
  END IF;
  IF p_month >= to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') THEN
    RAISE EXCEPTION 'เดือน % ยังไม่จบ (เวลาไทย) ปิดไม่ได้', p_month USING ERRCODE = 'MC002';
  END IF;
  IF p_month < to_char(public.go_live_month(), 'YYYY-MM') THEN
    RAISE EXCEPTION 'เดือน % อยู่ก่อนเดือนเริ่มใช้ระบบ (%) — เป็นข้อมูลเดิม ไม่ต้องปิด',
      p_month, to_char(public.go_live_month(), 'YYYY-MM') USING ERRCODE = 'MC003';
  END IF;
END;
$$;

-- สิทธิ์ของผู้ใช้ (อ่านจาก profiles ตรง ไม่พึ่ง auth.uid()) · action: close | resync | override
CREATE FUNCTION public.month_close_actor_can(p_actor uuid, p_scope public.closure_scope, p_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT CASE
             WHEN p.role = 'host' THEN p_action IN ('close', 'resync', 'override')
             WHEN p.role = 'recorder' THEN p_action = 'close' AND p_scope = 'central'
                                         AND 'central'::division = ANY (p.division_scope)
             ELSE false
           END
      FROM profiles p
     WHERE p.user_id = p_actor AND p.is_active), false);
$$;

-- route ถามก่อนใช้ service role: ผู้ใช้ที่ล็อกอินอยู่ปิดส่วนนี้ได้ไหม
CREATE FUNCTION public.can_close_month_part(p_scope public.closure_scope)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND p_scope IS NOT NULL
         AND public.month_close_actor_can(auth.uid(), p_scope, 'close');
$$;

-- ผู้เรียกต้องเป็น service role (ตรวจซ้ำนอกเหนือจาก GRANT)
CREATE FUNCTION public.month_close_require_service()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (coalesce(current_setting('role', true), '') = 'service_role'
          OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'เรียกได้เฉพาะฝั่ง server' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ตั้งผู้กระทำของ transaction นี้ = p_actor (ให้ audit_trigger บันทึกคนกดจริง) · role ใน claims คงเดิม
CREATE FUNCTION public.month_close_as_actor(p_actor uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
  PERFORM set_config('request.jwt.claims', (v_claims || jsonb_build_object('sub', p_actor::text))::text, true);
END;
$$;

-- สาขาส่วนกลางที่ยังมีสัญญาค้างบริการของเดือนนั้น (นิยามในหัวไฟล์ข้อ 3)
CREATE FUNCTION public.central_unready_branches(p_month text)
RETURNS TABLE (branch_id uuid, branch_name text, pending_count int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH m AS (SELECT to_date(p_month || '-01', 'YYYY-MM-DD') AS d)
  SELECT b.id, b.name, count(*)::int
    FROM contracts ct
    JOIN customers cu ON cu.id = ct.customer_id
    JOIN branches b ON b.id = cu.branch_id AND b.division = 'central'
    CROSS JOIN m
   WHERE ct.status <> 'cancelled' AND ct.cancelled_at IS NULL
     AND NOT contract_is_renewed(ct.id)
     AND ct.stations_initialized_at IS NOT NULL
     AND missed_tracking_start_month(ct.start_date, ct.stations_initialized_at) <= m.d
     AND (date_trunc('month', ct.start_date) + make_interval(months => ct.term_months - 1))::date >= m.d
     AND NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = ct.id AND vi.visit_type = 'routine'
                        AND vi.makeup_for_month IS NULL
                        AND vi.visit_date >= m.d
                        AND vi.visit_date < (m.d + interval '1 month')::date)
     AND NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = ct.id AND vi.makeup_for_month = m.d)
     AND NOT EXISTS (SELECT 1 FROM missed_service_resolutions r
                      WHERE r.contract_id = ct.id AND r.missed_month = m.d AND r.kind = 'waived')
     -- ต่างจาก list_pending_missed_services: มีหมายเหตุตกบริการของเดือนนั้น = บันทึกแล้ว (เจ้าของ 18 พ.ย. 2026)
     AND NOT EXISTS (SELECT 1 FROM missed_service_notes n
                      WHERE n.contract_id = ct.id AND n.missed_month = m.d)
   GROUP BY b.id, b.name
   ORDER BY b.name;
$$;

-- ตรวจแถวส่วนกลางที่ route คำนวณมา → คืนตารางชั่วคราวในรูป jsonb ที่ cast แล้ว
--   ต้องเป็น array ของ object: branch_id + s1…xl3, cust (int ≥ 0) + vS, vM, vL, vXL, value (numeric ≥ 0)
--   สาขาต้องเป็นส่วนกลางครบทุกสาขา ไม่ซ้ำ ไม่มีสาขาอื่น
CREATE FUNCTION public.month_close_check_central_rows(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row     jsonb;
  v_ids     uuid[] := '{}';
  v_central uuid[];
  v_key     text;
  v_num     numeric;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'ข้อมูล snapshot ส่วนกลางต้องเป็นรายการ' USING ERRCODE = 'MC005';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'แถว snapshot ไม่ถูกรูปแบบ' USING ERRCODE = 'MC005';
    END IF;
    BEGIN
      v_ids := v_ids || (v_row ->> 'branch_id')::uuid;
      FOREACH v_key IN ARRAY ARRAY['s1','s3','m1','m3','l1','l3','xl1','xl3','cust'] LOOP
        v_num := (v_row ->> v_key)::numeric;
        IF v_num IS NULL OR v_num < 0 OR v_num <> trunc(v_num) OR v_num > 1000000 THEN
          RAISE EXCEPTION 'bad count';
        END IF;
      END LOOP;
      FOREACH v_key IN ARRAY ARRAY['vS','vM','vL','vXL','value'] LOOP
        v_num := (v_row ->> v_key)::numeric;
        IF v_num IS NULL OR v_num < 0 OR v_num > 999999999999.99 THEN
          RAISE EXCEPTION 'bad value';
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'แถว snapshot มีค่าไม่ถูกต้อง (สาขา %)', coalesce(v_row ->> 'branch_id', '?')
        USING ERRCODE = 'MC005';
    END;
  END LOOP;

  SELECT array_agg(b.id ORDER BY b.id) INTO v_central FROM branches b WHERE b.division = 'central';
  IF cardinality(v_ids) <> cardinality(v_central)
     OR (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(v_ids) x) IS DISTINCT FROM v_central THEN
    RAISE EXCEPTION 'snapshot ต้องมีสาขาส่วนกลางครบ % สาขา ไม่ซ้ำ (ได้ % แถว)',
      cardinality(v_central), cardinality(v_ids) USING ERRCODE = 'MC005';
  END IF;
END;
$$;

-- เขียนแถว computed ของส่วนกลาง (หลังตรวจแล้ว) · คง confirmed_at/by / report_* เดิม
-- แถวเดิมที่ไม่ใช่ computed (legacy / manual) → MC008 ไม่เขียนทับ
CREATE FUNCTION public.month_close_write_central_rows(p_month text, p_rows jsonb)
RETURNS int
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM monthly_branch_snapshots s
      JOIN branches b ON b.id = s.branch_id AND b.division = 'central'
     WHERE s.month_key = p_month AND s.source <> 'computed'
  ) THEN
    RAISE EXCEPTION 'เดือน % มีแถว snapshot ส่วนกลางที่ไม่ใช่ค่าคำนวณ (legacy/manual) — ไม่เขียนทับ', p_month
      USING ERRCODE = 'MC008';
  END IF;

  WITH src AS (
    SELECT (r ->> 'branch_id')::uuid AS branch_id,
           (r ->> 's1')::numeric::int AS s1, (r ->> 's3')::numeric::int AS s3, (r ->> 'm1')::numeric::int AS m1, (r ->> 'm3')::numeric::int AS m3,
           (r ->> 'l1')::numeric::int AS l1, (r ->> 'l3')::numeric::int AS l3, (r ->> 'xl1')::numeric::int AS xl1, (r ->> 'xl3')::numeric::int AS xl3,
           (r ->> 'cust')::numeric::int AS cust,
           round((r ->> 'vS')::numeric, 2) AS v_s, round((r ->> 'vM')::numeric, 2) AS v_m,
           round((r ->> 'vL')::numeric, 2) AS v_l, round((r ->> 'vXL')::numeric, 2) AS v_xl,
           round((r ->> 'value')::numeric, 2) AS value
      FROM jsonb_array_elements(p_rows) r
  ), up AS (
    INSERT INTO monthly_branch_snapshots AS t
      (month_key, branch_id, source, s1, s3, m1, m3, l1, l3, xl1, xl3, cust, "vS", "vM", "vL", "vXL", value)
    SELECT p_month, branch_id, 'computed', s1, s3, m1, m3, l1, l3, xl1, xl3, cust, v_s, v_m, v_l, v_xl, value
      FROM src
    ON CONFLICT (month_key, branch_id) DO UPDATE
      SET s1 = EXCLUDED.s1, s3 = EXCLUDED.s3, m1 = EXCLUDED.m1, m3 = EXCLUDED.m3,
          l1 = EXCLUDED.l1, l3 = EXCLUDED.l3, xl1 = EXCLUDED.xl1, xl3 = EXCLUDED.xl3,
          cust = EXCLUDED.cust, "vS" = EXCLUDED."vS", "vM" = EXCLUDED."vM", "vL" = EXCLUDED."vL",
          "vXL" = EXCLUDED."vXL", value = EXCLUDED.value
      WHERE t.source = 'computed'
        AND (t.s1, t.s3, t.m1, t.m3, t.l1, t.l3, t.xl1, t.xl3, t.cust, t."vS", t."vM", t."vL", t."vXL", t.value)
            IS DISTINCT FROM
            (EXCLUDED.s1, EXCLUDED.s3, EXCLUDED.m1, EXCLUDED.m3, EXCLUDED.l1, EXCLUDED.l3, EXCLUDED.xl1,
             EXCLUDED.xl3, EXCLUDED.cust, EXCLUDED."vS", EXCLUDED."vM", EXCLUDED."vL", EXCLUDED."vXL", EXCLUDED.value)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_changed FROM up;

  RETURN v_changed;
END;
$$;

-- =====================================================================
-- 5. close_month_part (service role)
-- =====================================================================
CREATE FUNCTION public.close_month_part(
  p_actor           uuid,
  p_month           text,
  p_scope           public.closure_scope,
  p_rows            jsonb DEFAULT NULL,
  p_override_reason text DEFAULT NULL,
  p_ack_carried     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason    text := nullif(regexp_replace(p_override_reason, '^\s+|\s+$', '', 'g'), '');
  v_unready   jsonb := '[]';
  v_unready_n int := 0;
  v_carried   uuid[] := '{}';
  v_override  boolean := false;
  v_closed_at timestamptz;
BEGIN
  PERFORM public.month_close_require_service();
  IF p_actor IS NULL OR p_scope IS NULL OR NOT public.month_close_actor_can(p_actor, p_scope, 'close') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ปิดส่วนนี้ (ส่วนกลาง: OM/PM หรือหัวหน้างานส่วนกลาง · ต่างจังหวัด: OM/PM)'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.month_close_check_month(p_month);
  PERFORM public.month_close_as_actor(p_actor);

  -- กันกดปิดส่วนเดียวกันพร้อมกัน (คนที่ 2 รอแล้วเห็นแถวของคนแรก → MC004)
  PERFORM pg_advisory_xact_lock(hashtext('public.month_closures:' || p_month || ':' || p_scope::text));

  IF EXISTS (SELECT 1 FROM month_closures WHERE month_key = p_month AND scope = p_scope) THEN
    RAISE EXCEPTION 'เดือน % ส่วน % ปิดไปแล้ว — ถ้าต้องอัปเดตตัวเลขให้ใช้ "คำนวณ snapshot ใหม่"', p_month, p_scope
      USING ERRCODE = 'MC004';
  END IF;

  IF p_scope = 'central' THEN
    PERFORM public.month_close_check_central_rows(p_rows);

    SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.branch_id, 'name', u.branch_name, 'pending', u.pending_count)
                              ORDER BY u.branch_name), '[]'),
           count(*)::int
      INTO v_unready, v_unready_n
      FROM public.central_unready_branches(p_month) u;

    IF v_unready_n > 0 THEN
      IF NOT public.month_close_actor_can(p_actor, p_scope, 'override') THEN
        IF v_reason IS NOT NULL THEN
          RAISE EXCEPTION 'ปิดข้ามด้วยเหตุผลได้เฉพาะ OM/PM (host)' USING ERRCODE = 'MC014';
        END IF;
        RAISE EXCEPTION 'ยังมี % สาขาส่วนกลางที่บันทึกบริการไม่ครบ — รอให้ครบ หรือให้ OM/PM ปิดข้ามพร้อมเหตุผล', v_unready_n
          USING ERRCODE = 'MC006',
                DETAIL = jsonb_build_object('branches', v_unready, 'can_override', false)::text;
      END IF;
      -- ส่งเหตุผลมาแต่เป็นช่องว่างล้วน (space/tab/newline) = เหตุผลไม่ถูกต้อง ไม่ใช่ "ไม่ได้ส่ง"
      IF p_override_reason IS NOT NULL AND v_reason IS NULL THEN
        RAISE EXCEPTION 'เหตุผลต้องยาว 5–500 ตัวอักษร' USING ERRCODE = 'MC007';
      END IF;
      IF v_reason IS NULL THEN
        RAISE EXCEPTION 'ยังมี % สาขาส่วนกลางที่บันทึกบริการไม่ครบ — รอให้ครบ หรือพิมพ์เหตุผลเพื่อปิดข้าม', v_unready_n
          USING ERRCODE = 'MC006',
                DETAIL = jsonb_build_object('branches', v_unready, 'can_override', true)::text;
      END IF;
      IF char_length(v_reason) NOT BETWEEN 5 AND 500 THEN
        RAISE EXCEPTION 'เหตุผลต้องยาว 5–500 ตัวอักษร' USING ERRCODE = 'MC007';
      END IF;
      v_override := true;
    END IF;

    PERFORM public.month_close_write_central_rows(p_month, p_rows);
  ELSE
    IF p_rows IS NOT NULL AND p_rows <> '[]'::jsonb AND p_rows <> 'null'::jsonb THEN
      RAISE EXCEPTION 'ต่างจังหวัดไม่รับตัวเลขตอนปิด (ใช้แถวที่บันทึกในหน้าอัพเดท port)' USING ERRCODE = 'MC005';
    END IF;
    -- สาขาที่ยังใช้ค่ายกมา (DECISIONS 5.12 / 5.12a) = ไม่มีแถว manual ที่ยืนยันแล้วของเดือนนั้น
    SELECT coalesce(array_agg(b.id ORDER BY b.name), '{}') INTO v_carried
      FROM branches b
     WHERE b.division = 'province'
       AND NOT EXISTS (
         SELECT 1 FROM monthly_branch_snapshots s
          WHERE s.month_key = p_month AND s.branch_id = b.id
            AND s.source = 'manual' AND s.confirmed_at IS NOT NULL);
    IF cardinality(v_carried) > 0 AND NOT coalesce(p_ack_carried, false) THEN
      RAISE EXCEPTION 'ยังมี % สาขาต่างจังหวัดที่ใช้ค่ายกมา — ต้องติ๊กรับทราบก่อนปิด', cardinality(v_carried)
        USING ERRCODE = 'MC009',
              DETAIL = (SELECT jsonb_build_object('branches',
                          coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name), '[]'))::text
                          FROM branches b WHERE b.id = ANY (v_carried));
    END IF;
  END IF;

  BEGIN
    INSERT INTO month_closures (month_key, scope, closed_by, closed_at)
    VALUES (p_month, p_scope, p_actor, now())
    RETURNING closed_at INTO v_closed_at;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'เดือน % ส่วน % ปิดไปแล้ว', p_month, p_scope USING ERRCODE = 'MC004';
  END;

  IF v_override THEN
    INSERT INTO month_closure_overrides (month_key, scope, reason, unconfirmed_branch_ids, overridden_by)
    SELECT p_month, p_scope, v_reason,
           coalesce(array_agg((e ->> 'id')::uuid), '{}'), p_actor
      FROM jsonb_array_elements(v_unready) e;
  END IF;

  RETURN jsonb_build_object(
    'month', p_month,
    'scope', p_scope,
    'closed_at', v_closed_at,
    'overridden', v_override,
    'unready_count', v_unready_n,
    'carried_count', cardinality(v_carried)
  );
END;
$$;

COMMENT ON FUNCTION public.close_month_part(uuid, text, public.closure_scope, jsonb, text, boolean) IS
  'M39: ปิดเดือน 1 ส่วน (service role · ผู้กด p_actor: central = host/recorder ส่วนกลาง · province = host) — MC001–MC009, MC014';

-- =====================================================================
-- 6. resync_month_part (service role · actor = host)
-- =====================================================================
CREATE FUNCTION public.resync_month_part(
  p_actor       uuid,
  p_month       text,
  p_scope       public.closure_scope,
  p_rows        jsonb DEFAULT NULL,
  p_computed_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed int := 0;
  v_last    timestamptz;
BEGIN
  PERFORM public.month_close_require_service();
  IF p_actor IS NULL OR p_scope IS NULL OR NOT public.month_close_actor_can(p_actor, p_scope, 'resync') THEN
    RAISE EXCEPTION 'คำนวณ snapshot ใหม่ได้เฉพาะ OM/PM (host)' USING ERRCODE = '42501';
  END IF;
  IF p_month IS NULL OR p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'เดือนไม่ถูกต้อง' USING ERRCODE = 'MC001';
  END IF;

  PERFORM public.month_close_as_actor(p_actor);
  PERFORM pg_advisory_xact_lock(hashtext('public.month_closures:' || p_month || ':' || p_scope::text));

  SELECT mc.last_resync_at INTO v_last
    FROM month_closures mc WHERE mc.month_key = p_month AND mc.scope = p_scope FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'เดือน % ส่วน % ยังไม่ปิด — คำนวณ snapshot ใหม่ได้เฉพาะเดือนที่ปิดแล้ว', p_month, p_scope
      USING ERRCODE = 'MC010';
  END IF;
  -- กันเขียนทับด้วยตัวเลขเก่า: host อีกคนคำนวณใหม่สำเร็จหลังจากที่รอบนี้เริ่มคำนวณ → ให้กดใหม่
  IF p_computed_at IS NOT NULL AND v_last IS NOT NULL AND v_last > p_computed_at THEN
    RAISE EXCEPTION 'มีการคำนวณ snapshot ใหม่ของส่วนนี้ระหว่างรอ — กดใหม่อีกครั้ง' USING ERRCODE = 'MC013';
  END IF;

  IF p_scope = 'central' THEN
    PERFORM public.month_close_check_central_rows(p_rows);
    v_changed := public.month_close_write_central_rows(p_month, p_rows);
  ELSIF p_rows IS NOT NULL AND p_rows <> '[]'::jsonb AND p_rows <> 'null'::jsonb THEN
    RAISE EXCEPTION 'ต่างจังหวัดไม่มีค่าคำนวณ (แถว manual) — ไม่รับตัวเลข' USING ERRCODE = 'MC005';
  END IF;

  UPDATE month_closures
     SET last_resync_at = now(), last_resync_by = p_actor
   WHERE month_key = p_month AND scope = p_scope;

  RETURN jsonb_build_object('month', p_month, 'scope', p_scope, 'changed_branches', v_changed);
END;
$$;

COMMENT ON FUNCTION public.resync_month_part(uuid, text, public.closure_scope, jsonb, timestamptz) IS
  'M39: คำนวณ snapshot ใหม่ (service role · ผู้กด host · ส่วนที่ปิดแล้ว MC010 · MC013 กันตัวเลขเก่า) — central เขียนทับแถว computed · province บันทึกเวลาอย่างเดียว';

-- =====================================================================
-- 7. set_month_closer (DECISIONS 5.8)
-- =====================================================================
CREATE FUNCTION public.set_month_closer(
  p_month     text,
  p_scope     public.closure_scope,
  p_closed_by uuid,
  p_closed_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role       user_role;
  v_divs       division[];
  v_month_end  timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_host() THEN
    RAISE EXCEPTION 'แก้ชื่อ/เวลาผู้ปิดเดือนได้เฉพาะ OM/PM (host)' USING ERRCODE = '42501';
  END IF;
  IF p_month IS NULL OR p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' OR p_scope IS NULL THEN
    RAISE EXCEPTION 'เดือน/ส่วนไม่ถูกต้อง' USING ERRCODE = 'MC001';
  END IF;

  PERFORM 1 FROM month_closures WHERE month_key = p_month AND scope = p_scope FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'เดือน % ส่วน % ยังไม่ปิด', p_month, p_scope USING ERRCODE = 'MC010';
  END IF;

  SELECT p.role, p.division_scope INTO v_role, v_divs
    FROM profiles p WHERE p.user_id = p_closed_by AND p.is_active;
  IF v_role IS NULL
     OR (p_scope = 'central' AND v_role = 'recorder' AND NOT ('central'::division = ANY (v_divs)))
     OR (p_scope = 'central' AND v_role NOT IN ('host', 'recorder'))
     OR (p_scope = 'province' AND v_role <> 'host') THEN
    RAISE EXCEPTION 'ผู้ปิดต้องเป็นผู้ใช้ที่มีสิทธิ์ปิดส่วนนี้ (ส่วนกลาง: OM/PM หรือหัวหน้างาน · ต่างจังหวัด: OM/PM)'
      USING ERRCODE = 'MC011';
  END IF;

  -- ต้นเดือนถัดไปตามเวลาไทย = เวลาแรกที่ปิดเดือนนี้ได้
  v_month_end := ((to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month')::timestamp)
                 AT TIME ZONE 'Asia/Bangkok';
  IF p_closed_at IS NULL OR p_closed_at < v_month_end OR p_closed_at > now() THEN
    RAISE EXCEPTION 'เวลาปิดต้องอยู่หลังสิ้นเดือน % และไม่เกินเวลาปัจจุบัน', p_month USING ERRCODE = 'MC012';
  END IF;

  UPDATE month_closures
     SET closed_by = p_closed_by, closed_at = p_closed_at
   WHERE month_key = p_month AND scope = p_scope;
END;
$$;

COMMENT ON FUNCTION public.set_month_closer(text, public.closure_scope, uuid, timestamptz) IS
  'M39 (DECISIONS 5.8): host แก้ชื่อ/เวลาผู้ปิดเดือน · ลง audit ด้วย audit_month_closures · MC010–MC012';

-- =====================================================================
-- 8. get_sync_status (DECISIONS 2.72)
-- =====================================================================
CREATE FUNCTION public.get_sync_status()
RETURNS TABLE (source text, started_at timestamptz, finished_at timestamptz, result text, error_code text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.current_app_role()::text, '') NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูสถานะการส่ง' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (l.source) l.source, l.started_at, l.finished_at, l.result, l.error_code
    FROM sync_logs l
   ORDER BY l.source, l.started_at DESC, l.id DESC;
END;
$$;

COMMENT ON FUNCTION public.get_sync_status() IS
  'M39 (DECISIONS 2.72): รอบส่ง Dashboard ล่าสุดต่อช่องทาง (เวลา/ผล/error_code เท่านั้น) — host/admin/recorder';

-- =====================================================================
-- 9. list_month_closures
-- =====================================================================
CREATE FUNCTION public.list_month_closures(p_from text DEFAULT NULL, p_to text DEFAULT NULL)
RETURNS TABLE (month_key text, scope public.closure_scope, closed_at timestamptz, closed_by_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.current_app_role()::text, '') NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูสถานะปิดเดือน' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT mc.month_key, mc.scope, mc.closed_at, p.display_name
    FROM month_closures mc
    LEFT JOIN profiles p ON p.user_id = mc.closed_by
   WHERE (p_from IS NULL OR mc.month_key >= p_from)
     AND (p_to IS NULL OR mc.month_key <= p_to)
   ORDER BY mc.month_key DESC, mc.scope;
END;
$$;

COMMENT ON FUNCTION public.list_month_closures(text, text) IS
  'M39: สถานะปิดเดือน (เดือน/ส่วน/เวลาปิด/ชื่อผู้ปิด) — host/admin/recorder';

-- =====================================================================
-- 10. start_sync_log (DROP + CREATE: เพิ่ม p_actor) / finish_sync_log — เนื้อจาก 20261115250000 แก้เฉพาะบล็อก "M39"
-- =====================================================================
DROP FUNCTION public.start_sync_log(text);

CREATE FUNCTION public.start_sync_log(p_source text, p_actor uuid DEFAULT NULL)   -- M39: + p_actor
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_service boolean := coalesce(current_setting('role', true), '') = 'service_role'
                          OR coalesce(auth.role(), '') = 'service_role';
  v_uid        uuid := auth.uid();
  v_id         bigint;
BEGIN
  IF p_source = 'auto' THEN
    IF NOT v_is_service THEN
      RAISE EXCEPTION 'Auto Sync เรียกได้เฉพาะระบบ (cron)' USING ERRCODE = '42501';
    END IF;
    v_uid := NULL;
  ELSIF p_source = 'manual' THEN
    -- service_role ห้ามเปิดรอบ manual แม้มี sub ของ host ติดมา (manual = คนกดจริงเท่านั้น)
    IF v_is_service OR v_uid IS NULL OR NOT public.is_host() THEN
      RAISE EXCEPTION 'ส่งข้อมูลเข้า Dashboard ได้เฉพาะ OM/PM (host)' USING ERRCODE = '42501';
    END IF;
  -- M39: ส่งหลังปิดเดือน / คำนวณใหม่ — server (service role) เปิดรอบในนามผู้กด (p_actor) ที่มีสิทธิ์ทำรายการนั้น
  ELSIF p_source IN ('close', 'resync') THEN
    IF NOT v_is_service OR p_actor IS NULL
       OR NOT (CASE WHEN p_source = 'resync'
                    THEN public.month_close_actor_can(p_actor, 'central', 'resync')
                    ELSE public.month_close_actor_can(p_actor, 'central', 'close')
                         OR public.month_close_actor_can(p_actor, 'province', 'close') END) THEN
      RAISE EXCEPTION 'ไม่มีสิทธิ์เปิดรอบส่ง "%"', p_source USING ERRCODE = '42501';
    END IF;
    v_uid := p_actor;
  ELSE
    -- export: ยังไม่มีหน้าจอ — เปิดเมื่อทำ Export (แก้ฟังก์ชันนี้ ไม่ต้องแก้ตาราง)   -- M39
    RAISE EXCEPTION 'ช่องทางส่ง "%" ยังไม่รองรับ', p_source USING ERRCODE = 'SY002';
  END IF;

  -- คิวเดียวทั้งระบบ: รอบอื่นที่เรียกพร้อมกันต้องรอ lock แล้วเห็นแถวที่เพิ่ง insert
  PERFORM pg_advisory_xact_lock(hashtext('public.sync_logs'));

  -- รอบที่ค้างเกิน 10 นาที (route ล่ม/หมดเวลา) → ปิดเป็นล้มเหลว ไม่ให้บล็อกตลอดไป
  UPDATE sync_logs
     SET finished_at   = now(),
         result        = 'failed',
         error_code    = 'timeout',
         error_message = 'รอบนี้ไม่ได้บันทึกผลภายใน 10 นาที (ระบบหยุดกลางทาง)'
   WHERE finished_at IS NULL
     AND started_at < now() - interval '10 minutes';

  IF EXISTS (SELECT 1 FROM sync_logs WHERE finished_at IS NULL) THEN
    IF p_source = 'auto' THEN
      INSERT INTO sync_logs (source, triggered_by, finished_at, result, error_code, error_message)
      VALUES ('auto', NULL, now(), 'skipped', 'busy', 'มีการส่งอื่นกำลังทำงานอยู่ รอบนี้ข้าม');
      RETURN NULL;
    END IF;
    RAISE EXCEPTION 'มีการส่งข้อมูลเข้า Dashboard กำลังทำงานอยู่ รอสักครู่แล้วลองใหม่' USING ERRCODE = 'SY001';
  END IF;

  INSERT INTO sync_logs (source, triggered_by)
  VALUES (p_source, v_uid)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.start_sync_log(text, uuid) IS
  'M27/M39: เริ่มรอบส่ง Dashboard — auto = service_role · manual = host · close/resync = service_role ในนาม p_actor · กันส่งซ้อน (SY001)';

CREATE OR REPLACE FUNCTION public.finish_sync_log(
  p_id            bigint,
  p_result        text,
  p_error_code    text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_months_sent   text[] DEFAULT '{}',
  p_month_count   int DEFAULT NULL,
  p_commit_sha    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_service boolean := coalesce(current_setting('role', true), '') = 'service_role'
                          OR coalesce(auth.role(), '') = 'service_role';
  v_row        sync_logs%ROWTYPE;
BEGIN
  IF p_result IS NULL OR p_result NOT IN ('success', 'skipped', 'failed') THEN
    RAISE EXCEPTION 'ผลการส่งไม่ถูกต้อง: %', p_result USING ERRCODE = 'SY002';
  END IF;

  SELECT * INTO v_row FROM sync_logs WHERE id = p_id FOR UPDATE;

  IF NOT FOUND OR v_row.finished_at IS NOT NULL THEN
    RAISE EXCEPTION 'ไม่พบรอบส่งที่ยังไม่จบ (id %)', p_id USING ERRCODE = 'SY003';
  END IF;

  IF v_is_service THEN
    IF v_row.source NOT IN ('auto', 'close', 'resync') THEN   -- M39: + close / resync (server เปิดรอบให้)
      RAISE EXCEPTION 'ระบบปิดได้เฉพาะรอบ Auto Sync / ปิดเดือน / คำนวณใหม่' USING ERRCODE = '42501';
    END IF;
  -- ผู้เปิดรอบปิดรอบของตัวเองได้แม้ถูกถอดสิทธิ์ host ระหว่างทาง (ไม่งั้น commit แล้วแต่ log ค้างเป็น timeout)
  ELSIF v_row.source <> 'manual'
        OR auth.uid() IS NULL
        OR v_row.triggered_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์บันทึกผลรอบนี้' USING ERRCODE = '42501';
  END IF;

  UPDATE sync_logs
     SET finished_at   = now(),
         result        = p_result,
         error_code    = nullif(left(btrim(p_error_code), 40), ''),
         error_message = nullif(left(btrim(p_error_message), 500), ''),
         months_sent   = coalesce(p_months_sent, '{}'),
         month_count   = p_month_count,
         commit_sha    = CASE WHEN p_result = 'success' THEN lower(p_commit_sha) END
   WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION public.finish_sync_log(bigint, text, text, text, text[], int, text) IS
  'M27/M39: จบรอบส่ง Dashboard — service_role ปิดรอบ auto/close/resync · host ปิดรอบ manual ของตัวเอง · แก้ได้ครั้งเดียว (SY003)';

-- =====================================================================
-- 11. สิทธิ์ function
-- =====================================================================
-- helper ภายใน: เรียกได้จาก RPC (SECURITY DEFINER เจ้าของเดียวกัน) เท่านั้น
REVOKE ALL ON FUNCTION public.month_close_check_month(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.month_close_check_central_rows(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.month_close_write_central_rows(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.central_unready_branches(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.month_close_actor_can(uuid, public.closure_scope, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.month_close_require_service() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.month_close_as_actor(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- trigger WHEN ของ snapshot เรียกด้วยสิทธิ์ผู้เขียนแถว
REVOKE ALL ON FUNCTION public.snapshot_month_is_closed(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.snapshot_month_is_closed(text, uuid) TO authenticated, service_role;

-- เขียน (service role เท่านั้น — route ตรวจสิทธิ์ผู้ใช้ก่อน · RPC ตรวจ p_actor ซ้ำ)
REVOKE ALL ON FUNCTION public.close_month_part(uuid, text, public.closure_scope, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resync_month_part(uuid, text, public.closure_scope, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_month_part(uuid, text, public.closure_scope, jsonb, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.resync_month_part(uuid, text, public.closure_scope, jsonb, timestamptz) TO service_role;

-- ผู้ใช้ที่ล็อกอิน (ตรวจในเนื้อฟังก์ชัน)
REVOKE ALL ON FUNCTION public.can_close_month_part(public.closure_scope) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_month_closer(text, public.closure_scope, uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_sync_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_month_closures(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_close_month_part(public.closure_scope) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_month_closer(text, public.closure_scope, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sync_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_month_closures(text, text) TO authenticated;

-- start_sync_log ถูก DROP + CREATE ใหม่ → ให้สิทธิ์ใหม่ (finish_sync_log คงสิทธิ์เดิม)
REVOKE ALL ON FUNCTION public.start_sync_log(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_sync_log(text, uuid) TO authenticated, service_role;
