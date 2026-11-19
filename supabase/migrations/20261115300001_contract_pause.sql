-- =====================================================================
-- M29 พักสัญญา (ลูกค้าค้างจ่าย) — DECISIONS 2.52 · 2.63 · 2.87
--
-- ⚠ ไม่แตะ audit_trigger (ใช้ตัวเดิมผ่าน trigger audit_contract_pauses) · ไม่แตะ save_service_visit /
--   save_makeup_service_visit / visits_makeup_link_guard / ig_collection_apply / ฟังก์ชันทีม-workload (M42)
-- ลำดับ cloud: 20261115290000 → 20261115300000 (enum) → ไฟล์นี้
--
-- สรุป logic (ทีมอ่านตรงนี้ก่อน):
--   1. ตาราง `contract_pauses` — 1 แถว = 1 ช่วงพัก · resumed_at NULL = ยังพักอยู่
--      * เดือนที่พัก = [เดือนของ paused_from, เดือนของ resumed_at) — เดือนที่เริ่มพัก = พักทั้งเดือน ·
--        เดือนที่กลับมาต่อ = ใช้งาน (ต้องเข้าบริการตามปกติ) · พัก-กลับในเดือนเดียวกัน = ไม่มีเดือนพัก
--        (ตรงกับ lib/rules/pauseMonth.ts `isPausedMonth` — แก้ฝั่งหนึ่งต้องแก้อีกฝั่ง) · helper `contract_month_paused()`
--      * ด่าน: ช่วงพักเปิดได้ 1 ช่วงต่อสัญญา (unique partial index) · ช่วงเดือนไม่ทับกัน (EXCLUDE gist · btree_gist)
--      * end_kind: 'resumed' (กดกลับมาต่อ) | 'cancelled' (ยกเลิกสัญญาระหว่างพัก — ระบบปิดช่วงให้เอง ข้อ 3)
--      * RLS: อ่าน = host/admin/recorder (เท่า contracts_select) · anon/viewer ไม่เห็น · เขียนผ่าน RPC เท่านั้น
--      * audit: trigger audit_contract_pauses → audit_trigger เดิม (ไม่มี CASE ของตารางนี้ → contract_id ของ audit_log
--        ว่าง · ค่าอยู่ใน new_data · ขอ BE เพิ่ม CASE ทีหลัง) · การเปลี่ยน contracts.status ลง audit ของ contracts พร้อม contract_id
--   2. RPC `pause_contract(p_contract_id, p_from, p_reason)` / `resume_contract(p_contract_id, p_at)` (SECURITY DEFINER)
--      * ใครกด (2.63): host · admin / recorder ในขอบเขตของสัญญา (contract_in_scope) — ตรวจที่ DB
--      * พัก: สัญญาต้อง active (CP001) · ยังไม่พัก (CP002) · เหตุผลบังคับ ≤ 500 (CP003)
--        · วันเริ่มพัก ≤ วันนี้ อยู่ในอายุสัญญา และไม่ก่อนวันกลับมาต่อครั้งก่อน (CP004)
--        · admin/recorder ย้อนวันเริ่มพัก/กลับมาต่อได้ไม่เกินเดือนก่อนหน้า · host ย้อนได้ (CP004)
--        · ตั้งแต่เดือนที่เริ่มพักต้องยังไม่มีการเข้า routine (รวมชดเชย) (CP005 · DETAIL = เดือน)
--        · ตั้งแต่เดือนที่เริ่มพักต้องยังไม่มีผลตัดสิน/หมายเหตุตกบริการ (CP006)
--      * กลับมาต่อ: สัญญาต้องพักอยู่ (CP007) · วันกลับมาต่อ ≥ วันเริ่มพัก และ ≤ วันนี้ (CP004)
--        · สถานะกลับเป็นค่าก่อนพัก (status_before — พักได้เฉพาะ active จึงเป็น 'active' เสมอ)
--      * ถือคิวเดียวกับ save_service_visit ของสัญญานั้น (advisory lock) + FOR UPDATE แถวสัญญา
--   3. ด่านสถานะ `contracts_pause_status_guard` (BEFORE INSERT/UPDATE OF status · ทุก role):
--      เปลี่ยนเป็น/ออกจาก 'paused' ได้เฉพาะผ่าน RPC → CP008 (ตรวจจากแถวพัก: เข้า paused ต้องมีช่วงเปิด ·
--      ออกจาก paused ต้องไม่มีช่วงเปิด — RPC สร้าง/ปิดแถวก่อน UPDATE · ไม่พึ่งค่า session)
--      * host ยกเลิกการยกเลิกของสัญญาที่ยกเลิกระหว่างพัก → ต้องคืนเป็น 'paused' (เปิดช่วงพักเดิมคืน) ไม่งั้น CP008
--      * ยกเว้น paused → cancelled (ลูกค้าไม่จ่าย ยกเลิกได้เลย · สิทธิ์ตาม RLS/AG007 เดิม)
--        → AFTER trigger `contracts_pause_close_on_cancel` ปิดช่วงพัก end_kind = 'cancelled'
--   4. ระหว่างพัก (ข้อ 1 ช่วงเดือน):
--      * การเข้า routine ในเดือนที่พักบันทึกไม่ได้ (trigger visits_pause_guard · ทุกทาง) → CP009
--        (รอบแก้ปัญหา/ติดตาม AG บันทึกได้ตามปกติ)
--      * เก็บ/ไม่เก็บ IG ของสัญญาที่พักอยู่ไม่ได้ (trigger stations_pause_collection_guard) → CP010
--        → สถานีของสัญญาพักไม่ขึ้นรายการเก็บ (หน้าจอกรองสัญญาที่จบแล้ว · พักไม่ใช่จบ) และ DB กันซ้ำ
--   5. "ชดเชยจากพักสัญญา" (2.87 ข — ไม่ยืดสัญญา ต้องชดเชยให้ครบ):
--      * ใช้การเข้าชดเชยเดิมของ M18 (save_makeup_service_visit · visits.makeup_for_month = เดือนที่พัก)
--        visits_makeup_link_guard เดิมยอมรับเดือนที่พักอยู่แล้ว (เดือนบริการที่ผ่านไป · ไม่มี routine)
--      * คอลัมน์ใหม่ `missed_service_resolutions.origin` = 'missed' | 'pause' — trigger BEFORE ตั้งให้เองจากช่วงพัก
--        (ผู้ใช้ตั้งเองไม่ได้) → แยกนับได้ว่ารายไหน เดือนไหน ชดเชยเมื่อไหร่ ใครบันทึก (decided_by/decided_at + การเข้า)
--      * เดือนที่พัก "ไม่ชดเชย" (waived) ไม่ได้ / บันทึกหมายเหตุตกบริการไม่ได้ (ไม่ใช่ตกบริการ) → CP012
--      * recorder ชดเชยได้ภายในอายุสัญญาเดิม (เดือนของการเข้า ≤ เดือนบริการสุดท้าย) → เกิน = CP011 · host ทำได้
--   6. ตกบริการ (2.52): เดือนที่พักไม่ใช่ตกบริการ → แทนที่ 3 ฟังก์ชันจากเนื้อล่าสุด + เงื่อนไขเดียว
--      `AND NOT contract_month_paused(...)` (ติดป้าย "M29"):
--        list_pending_missed_services (เนื้อ 20261115200000) · list_voided_missed_services (20261115220000)
--        · central_unready_branches (20261115271000)
--   7. อ่านอย่างเดียว:
--      * `v_paused_branch_summary` (/summary · ยอดรวมรายสาขา×เดือน ไม่มี PII · anon อ่านได้แบบ v_branch_summary)
--      * `list_paused_contracts(p_branch_id)` (/todo · สัญญาที่พักอยู่ + เดือนที่พัก + warn เมื่อพักเกิน 3 เดือน — 2.63)
--      * `list_pause_makeups(p_branch_id)` (ค้าง/ชดเชยแล้ว รายเดือนที่พัก)
--   * Dashboard (2.87): คำนวณฝั่ง server ด้วย lib/rules (buildBranchSnapshot ข้ามเดือนที่พัก) — ไม่มี SQL snapshot
--     · dashboard_data.json ไม่เปลี่ยน (กฎ 4) · เดือนที่ปิดแล้วไม่คำนวณใหม่เอง (กฎ 7)
--   * error ใหม่ CP001–CP012 (ข้อความไทยใน HINT)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- =====================================================================
-- 1. ตาราง contract_pauses
-- =====================================================================
CREATE TABLE public.contract_pauses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id   uuid NOT NULL REFERENCES public.contracts (id) ON DELETE CASCADE,
  paused_from   date NOT NULL,
  resumed_at    date,
  reason        text NOT NULL,
  status_before public.contract_status NOT NULL DEFAULT 'active',
  end_kind      text,
  paused_by     uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  resumed_by    uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- เดือน (วันที่ 1) ที่ใช้คิดช่วงพัก · resume_month NULL = ยังพักอยู่
  paused_month  date GENERATED ALWAYS AS (date_trunc('month', paused_from::timestamp)::date) STORED,
  resume_month  date GENERATED ALWAYS AS (date_trunc('month', resumed_at::timestamp)::date) STORED,
  CONSTRAINT contract_pauses_reason_check
    CHECK (btrim(reason, E' \t\r\n ​') <> '' AND char_length(reason) <= 500),
  CONSTRAINT contract_pauses_resume_after_start CHECK (resumed_at IS NULL OR resumed_at >= paused_from),
  CONSTRAINT contract_pauses_end_kind_check
    CHECK ((resumed_at IS NULL AND end_kind IS NULL)
           OR (resumed_at IS NOT NULL AND end_kind IN ('resumed', 'cancelled'))),
  CONSTRAINT contract_pauses_status_before_check CHECK (status_before <> 'paused'),
  -- ช่วงเดือนที่พักไม่ทับกัน (ช่วงว่าง = พัก-กลับในเดือนเดียวกัน ไม่ชนใคร)
  CONSTRAINT contract_pauses_no_overlap
    EXCLUDE USING gist (contract_id WITH =, daterange(paused_month, resume_month, '[)') WITH &&)
);

-- พักอยู่ได้ทีละ 1 ช่วงต่อสัญญา
CREATE UNIQUE INDEX contract_pauses_one_open ON public.contract_pauses (contract_id) WHERE resumed_at IS NULL;
CREATE INDEX contract_pauses_contract_idx ON public.contract_pauses (contract_id, paused_month);

COMMENT ON TABLE public.contract_pauses IS
  'M29 (DECISIONS 2.52/2.63/2.87): contract pause periods. Paused months = [month(paused_from), month(resumed_at)). Written via pause_contract()/resume_contract() only.';

ALTER TABLE public.contract_pauses ENABLE ROW LEVEL SECURITY;

CREATE POLICY contract_pauses_select ON public.contract_pauses
  FOR SELECT TO authenticated
  USING (public.current_app_role() IN ('host', 'admin', 'recorder'));

REVOKE ALL ON public.contract_pauses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contract_pauses TO authenticated;
GRANT ALL ON public.contract_pauses TO service_role;

CREATE TRIGGER audit_contract_pauses
  AFTER INSERT OR UPDATE OR DELETE ON public.contract_pauses
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- =====================================================================
-- 1b. helper: เดือนนี้ของสัญญานี้อยู่ในช่วงพักไหม (ตรงกับ isPausedMonth ใน lib/rules)
--   SECURITY DEFINER: ผู้เรียกบางตัว (central_unready_branches) เป็น DEFINER อยู่แล้ว · คืนแค่ true/false
-- =====================================================================
CREATE FUNCTION public.contract_month_paused(p_contract_id uuid, p_month date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM contract_pauses p
     WHERE p.contract_id = p_contract_id
       AND p.paused_month <= date_trunc('month', p_month::timestamp)::date
       AND (p.resume_month IS NULL OR date_trunc('month', p_month::timestamp)::date < p.resume_month)
       -- ผลตรวจ security L3: viewer เรียกตรงได้ false เสมอ (ไม่ใช้ส่องสถานะสัญญา) · บทบาทอื่น/ระบบ/trigger ใช้ได้ตามปกติ
       AND current_app_role() IS DISTINCT FROM 'viewer')
$$;

REVOKE ALL ON FUNCTION public.contract_month_paused(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_month_paused(uuid, date) TO authenticated, service_role;

-- =====================================================================
-- 2. RPC พัก / กลับมาต่อ
-- =====================================================================
CREATE FUNCTION public.pause_contract(p_contract_id uuid, p_from date, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today       date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_reason      text := nullif(btrim(p_reason, E' \t\r\n ​'), '');
  v_ct          record;
  v_from_month  date;
  v_last_month  date;
  v_last_resume date;
  v_hit         date;
  v_pause_id    uuid;
BEGIN
  -- ตำแหน่งก่อน (คนไม่มีสิทธิ์ไม่ได้ถือ lock / ไม่ได้ลองว่ามีสัญญาจริงไหม)
  IF NOT coalesce(is_host() OR current_app_role() IN ('admin', 'recorder'), false) THEN
    RAISE EXCEPTION 'not allowed to pause contracts' USING ERRCODE = '42501';
  END IF;
  IF p_contract_id IS NULL THEN
    RAISE EXCEPTION 'contract_id is required' USING ERRCODE = '22004';
  END IF;
  IF NOT coalesce(is_host() OR contract_in_scope(p_contract_id), false) THEN
    RAISE EXCEPTION 'not allowed to pause this contract' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'a pause reason is required (max 500 characters)'
      USING ERRCODE = 'CP003', HINT = 'กรุณาพิมพ์เหตุผลที่พักสัญญา (ไม่เกิน 500 ตัวอักษร)';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.save_service_visit:' || p_contract_id::text, 0));
  SELECT c.id, c.status, c.start_date, c.term_months INTO v_ct
    FROM contracts c WHERE c.id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;
  IF v_ct.status = 'paused' THEN
    RAISE EXCEPTION 'the contract is already paused'
      USING ERRCODE = 'CP002', HINT = 'สัญญานี้พักอยู่แล้ว';
  END IF;
  IF v_ct.status <> 'active' THEN
    RAISE EXCEPTION 'only an active contract can be paused'
      USING ERRCODE = 'CP001', HINT = 'พักได้เฉพาะสัญญาที่ใช้งานอยู่ (ไม่ใช่สัญญาหมดอายุ ปิด หรือยกเลิก)';
  END IF;

  v_from_month := date_trunc('month', p_from::timestamp)::date;
  v_last_month := (date_trunc('month', v_ct.start_date::timestamp)
                   + make_interval(months => v_ct.term_months - 1))::date;
  SELECT max(p.resumed_at) INTO v_last_resume FROM contract_pauses p WHERE p.contract_id = p_contract_id;
  IF p_from IS NULL OR p_from > v_today OR p_from < v_ct.start_date OR v_from_month > v_last_month
     OR (v_last_resume IS NOT NULL AND p_from < v_last_resume) THEN
    RAISE EXCEPTION 'invalid pause start date'
      USING ERRCODE = 'CP004',
            HINT = 'วันที่เริ่มพักต้องไม่เกินวันนี้ อยู่ในอายุสัญญา และไม่ก่อนวันที่กลับมาต่อครั้งก่อน';
  END IF;
  -- ผลตรวจ security M1: ย้อนหลังได้ไม่เกินเดือนก่อนหน้า (admin/recorder) — กันลบตกบริการหลายเดือน/เดือนที่ปิดแล้ว
  --   แบบเงียบๆ · host ย้อนได้ (แก้ข้อมูลตกหล่น) · ทุกครั้งลง audit
  IF NOT is_host() AND v_from_month < (date_trunc('month', v_today::timestamp) - interval '1 month')::date THEN
    RAISE EXCEPTION 'only host can backdate a pause before the previous month'
      USING ERRCODE = 'CP004',
            HINT = 'ย้อนวันเริ่มพักได้ไม่เกินเดือนก่อนหน้า — ย้อนมากกว่านั้นให้ผู้ดูแลระบบ (host) ทำ';
  END IF;

  -- เดือนที่เริ่มพักขึ้นไปต้องยังไม่มีบริการ routine (ปกติหรือชดเชย) — เดือนที่พักต้องไม่มีบริการ
  SELECT min(date_trunc('month', vi.visit_date::timestamp)::date) INTO v_hit
    FROM visits vi
   WHERE vi.contract_id = p_contract_id AND vi.visit_type = 'routine' AND vi.visit_date >= v_from_month;
  IF v_hit IS NOT NULL THEN
    RAISE EXCEPTION 'a routine visit exists in or after the pause start month'
      USING ERRCODE = 'CP005', DETAIL = to_char(v_hit, 'YYYY-MM'),
            HINT = format('เดือน %s มีการเข้าบริการแล้ว — เริ่มพักได้ตั้งแต่เดือนถัดจากการเข้าบริการครั้งล่าสุด', to_char(v_hit, 'YYYY-MM'));
  END IF;
  -- ผลตัดสิน / หมายเหตุตกบริการของเดือนที่จะพัก (ห้ามเปลี่ยนเดือนที่ตกไปแล้วเป็นเดือนพักแบบเงียบๆ)
  IF EXISTS (SELECT 1 FROM missed_service_resolutions r
              WHERE r.contract_id = p_contract_id AND r.missed_month >= v_from_month)
     OR EXISTS (SELECT 1 FROM missed_service_notes n
                 WHERE n.contract_id = p_contract_id AND n.missed_month >= v_from_month) THEN
    RAISE EXCEPTION 'missed-service outcomes or notes exist in or after the pause start month'
      USING ERRCODE = 'CP006',
            HINT = 'เดือนที่จะพักมีการตัดสิน/หมายเหตุตกบริการแล้ว — เลือกวันเริ่มพักหลังเดือนนั้น';
  END IF;

  INSERT INTO contract_pauses (contract_id, paused_from, reason, status_before, paused_by)
  VALUES (p_contract_id, p_from, v_reason, v_ct.status, auth.uid())
  RETURNING id INTO v_pause_id;

  UPDATE contracts c SET status = 'paused' WHERE c.id = p_contract_id;   -- ด่านข้อ 3 เห็นแถวพักที่เปิดแล้ว

  RETURN jsonb_build_object(
    'pause_id', v_pause_id, 'contract_id', p_contract_id, 'status', 'paused',
    'paused_from', p_from, 'paused_month', v_from_month);
END;
$$;

COMMENT ON FUNCTION public.pause_contract(uuid, date, text) IS
  'M29: pause an active contract (host / admin / recorder in scope). Errors CP001–CP006, AG004, 42501.';

CREATE FUNCTION public.resume_contract(p_contract_id uuid, p_at date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_status     public.contract_status;
  v_pause      record;
  v_months     int;
BEGIN
  IF NOT coalesce(is_host() OR current_app_role() IN ('admin', 'recorder'), false) THEN
    RAISE EXCEPTION 'not allowed to resume contracts' USING ERRCODE = '42501';
  END IF;
  IF p_contract_id IS NULL THEN
    RAISE EXCEPTION 'contract_id is required' USING ERRCODE = '22004';
  END IF;
  IF NOT coalesce(is_host() OR contract_in_scope(p_contract_id), false) THEN
    RAISE EXCEPTION 'not allowed to resume this contract' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.save_service_visit:' || p_contract_id::text, 0));
  SELECT c.status INTO v_status FROM contracts c WHERE c.id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;
  SELECT p.id, p.paused_from, p.paused_month, p.status_before INTO v_pause
    FROM contract_pauses p WHERE p.contract_id = p_contract_id AND p.resumed_at IS NULL
     FOR UPDATE;
  IF v_status <> 'paused' OR v_pause.id IS NULL THEN
    RAISE EXCEPTION 'the contract is not paused'
      USING ERRCODE = 'CP007', HINT = 'สัญญานี้ไม่ได้พักอยู่';
  END IF;
  IF p_at IS NULL OR p_at < v_pause.paused_from OR p_at > v_today THEN
    RAISE EXCEPTION 'invalid resume date'
      USING ERRCODE = 'CP004', HINT = 'วันที่กลับมาต่อต้องไม่ก่อนวันที่เริ่มพัก และไม่เกินวันนี้';
  END IF;
  -- ผลตรวจ security M1: ย้อนวันกลับมาต่อ = เดือนหลังจากนั้นกลายเป็นตกบริการทั้งหมด → admin/recorder ย้อนได้ไม่เกินเดือนก่อนหน้า
  IF NOT is_host() AND p_at < (date_trunc('month', v_today::timestamp) - interval '1 month')::date THEN
    RAISE EXCEPTION 'only host can backdate a resume before the previous month'
      USING ERRCODE = 'CP004',
            HINT = 'ย้อนวันกลับมาต่อได้ไม่เกินเดือนก่อนหน้า — ย้อนมากกว่านั้นให้ผู้ดูแลระบบ (host) ทำ';
  END IF;

  UPDATE contract_pauses p
     SET resumed_at = p_at, resumed_by = auth.uid(), end_kind = 'resumed', updated_at = now()
   WHERE p.id = v_pause.id;

  UPDATE contracts c SET status = v_pause.status_before WHERE c.id = p_contract_id;   -- แถวพักปิดแล้ว (ข้อ 3)

  v_months := (extract(year FROM age(date_trunc('month', p_at::timestamp), v_pause.paused_month::timestamp)) * 12
               + extract(month FROM age(date_trunc('month', p_at::timestamp), v_pause.paused_month::timestamp)))::int;

  RETURN jsonb_build_object(
    'pause_id', v_pause.id, 'contract_id', p_contract_id, 'status', v_pause.status_before,
    'paused_from', v_pause.paused_from, 'resumed_at', p_at, 'paused_months', v_months);
END;
$$;

COMMENT ON FUNCTION public.resume_contract(uuid, date) IS
  'M29: resume a paused contract (host / admin / recorder in scope). Status returns to its value before the pause. Errors CP004, CP007, AG004, 42501.';

REVOKE ALL ON FUNCTION public.pause_contract(uuid, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resume_contract(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pause_contract(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_contract(uuid, date) TO authenticated;

-- =====================================================================
-- 3. ด่านสถานะ 'paused' บน contracts + ปิดช่วงพักเมื่อยกเลิกสัญญา
-- =====================================================================
CREATE FUNCTION public.contracts_pause_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_latest record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'paused' THEN
      RAISE EXCEPTION 'a contract cannot be created as paused'
        USING ERRCODE = 'CP008', HINT = 'เปลี่ยนสถานะพักสัญญาได้จากปุ่ม "พักสัญญา" / "กลับมาต่อ" เท่านั้น';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- ผลตรวจ security M2: ยกเลิกระหว่างพัก แล้ว host ยกเลิกการยกเลิก → ต้องกลับเป็น "พัก" (ลูกค้ายังไม่จ่าย) และเปิดช่วงพักเดิมคืน
  IF OLD.status = 'cancelled' THEN
    SELECT p.id, p.end_kind INTO v_latest
      FROM contract_pauses p WHERE p.contract_id = NEW.id
     ORDER BY p.paused_from DESC, p.created_at DESC LIMIT 1;
    IF v_latest.end_kind = 'cancelled' THEN
      IF NEW.status <> 'paused' THEN
        RAISE EXCEPTION 'this contract was cancelled while paused; restore it as paused'
          USING ERRCODE = 'CP008',
                HINT = 'สัญญานี้ยกเลิกระหว่างพัก — คืนสถานะได้เป็น "พักสัญญา" เท่านั้น แล้วค่อยกด "กลับมาต่อ"';
      END IF;
      UPDATE contract_pauses p
         SET resumed_at = NULL, resumed_by = NULL, end_kind = NULL, updated_at = now()
       WHERE p.id = v_latest.id;
      RETURN NEW;
    END IF;
  END IF;

  -- ผลตรวจ security L1: ตรวจจาก "สถานะจริงของแถวพัก" (ไม่พึ่งค่า session) —
  --   เข้า 'paused' ต้องมีช่วงพักเปิดอยู่ (pause_contract สร้างก่อน UPDATE) ·
  --   ออกจาก 'paused' (ยกเว้นยกเลิก) ต้องไม่มีช่วงพักเปิด (resume_contract ปิดก่อน UPDATE)
  IF (NEW.status = 'paused'
      AND NOT EXISTS (SELECT 1 FROM contract_pauses p WHERE p.contract_id = NEW.id AND p.resumed_at IS NULL))
     OR (OLD.status = 'paused' AND NEW.status <> 'cancelled'
         AND EXISTS (SELECT 1 FROM contract_pauses p WHERE p.contract_id = NEW.id AND p.resumed_at IS NULL)) THEN
    RAISE EXCEPTION 'contract pause status is changed through pause_contract / resume_contract'
      USING ERRCODE = 'CP008',
            HINT = 'เปลี่ยนสถานะพักสัญญาได้จากปุ่ม "พักสัญญา" / "กลับมาต่อ" เท่านั้น';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.contracts_pause_status_guard() FROM PUBLIC, anon, authenticated;

-- ชื่อ "contracts_p…" → BEFORE trigger ลำดับกลาง (ก่อน contracts_zz_import_batch_guard ที่ต้องอยู่หลังสุด — เทส 55)
CREATE TRIGGER contracts_pause_status_guard
  BEFORE INSERT OR UPDATE OF status ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_pause_status_guard();

CREATE FUNCTION public.contracts_pause_close_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'paused' AND NEW.status = 'cancelled' THEN
    UPDATE contract_pauses p
       SET resumed_at = greatest(p.paused_from,
                                 coalesce((NEW.cancelled_at AT TIME ZONE 'Asia/Bangkok')::date,
                                          (now() AT TIME ZONE 'Asia/Bangkok')::date)),
           resumed_by = auth.uid(), end_kind = 'cancelled', updated_at = now()
     WHERE p.contract_id = NEW.id AND p.resumed_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.contracts_pause_close_on_cancel() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER contracts_pause_close_on_cancel
  AFTER UPDATE OF status ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_pause_close_on_cancel();

-- =====================================================================
-- 4. ระหว่างพัก: ห้าม routine ในเดือนที่พัก · ห้ามเก็บ/ไม่เก็บ IG ของสัญญาที่พักอยู่
-- =====================================================================
CREATE FUNCTION public.visits_pause_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.visit_type = 'routine'
     AND (TG_OP = 'INSERT'
          OR NEW.visit_date IS DISTINCT FROM OLD.visit_date
          OR NEW.visit_type IS DISTINCT FROM OLD.visit_type
          OR NEW.contract_id IS DISTINCT FROM OLD.contract_id)
     AND contract_month_paused(NEW.contract_id, NEW.visit_date) THEN
    RAISE EXCEPTION 'the contract is paused in this month; routine visits cannot be recorded'
      USING ERRCODE = 'CP009', DETAIL = to_char(NEW.visit_date, 'YYYY-MM'),
            HINT = 'เดือนนี้สัญญาพักอยู่ บันทึกบริการประจำเดือนไม่ได้ (รอบแก้ปัญหา/ติดตามบันทึกได้)';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.visits_pause_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER visits_pause_guard
  BEFORE INSERT OR UPDATE OF visit_date, visit_type, contract_id ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.visits_pause_guard();

CREATE FUNCTION public.stations_pause_collection_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ((NEW.collected_at IS NOT NULL AND NEW.collected_at IS DISTINCT FROM OLD.collected_at)
      OR (NEW.not_collected_on IS NOT NULL AND NEW.not_collected_on IS DISTINCT FROM OLD.not_collected_on))
     AND EXISTS (SELECT 1 FROM contracts c WHERE c.id = NEW.contract_id AND c.status = 'paused') THEN
    RAISE EXCEPTION 'the contract is paused; stations cannot be collected'
      USING ERRCODE = 'CP010',
            HINT = 'สัญญานี้พักอยู่ — สถานียังอยู่กับลูกค้า เก็บได้หลังสัญญาจบหรือยกเลิก';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.stations_pause_collection_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER stations_pause_collection_guard
  BEFORE UPDATE OF collected_at, not_collected_on ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.stations_pause_collection_guard();

-- =====================================================================
-- 5. "ชดเชยจากพักสัญญา" — origin บนผลของเดือน (M18) · ระบบตั้งเอง
-- =====================================================================
ALTER TABLE public.missed_service_resolutions
  ADD COLUMN origin text NOT NULL DEFAULT 'missed',
  ADD CONSTRAINT missed_service_resolutions_origin_check CHECK (origin IN ('missed', 'pause')),
  ADD CONSTRAINT missed_service_resolutions_pause_makeup_only CHECK (origin = 'missed' OR kind = 'makeup');

COMMENT ON COLUMN public.missed_service_resolutions.origin IS
  'M29 (DECISIONS 2.87): missed = make-up/waiver of a missed month · pause = "ชดเชยจากพักสัญญา" (missed_month is a paused month). Set by trigger, not by users.';

CREATE FUNCTION public.missed_resolutions_pause_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last_month date;
BEGIN
  IF contract_month_paused(NEW.contract_id, NEW.missed_month) THEN
    IF NEW.kind <> 'makeup' THEN
      RAISE EXCEPTION 'a paused month is not a missed service; it must be made up'
        USING ERRCODE = 'CP012',
              HINT = 'เดือนนี้สัญญาพักอยู่ ไม่ใช่ตกบริการ — ต้องชดเชยจากพักสัญญาให้ครบ (ไม่ชดเชยไม่ได้)';
    END IF;
    NEW.origin := 'pause';
    -- 2.87 ไม่ยืดสัญญา: หัวหน้างานชดเชยได้ภายในอายุสัญญาเดิม · host บันทึกเกินได้
    IF current_app_role() = 'recorder' THEN
      SELECT (date_trunc('month', c.start_date::timestamp) + make_interval(months => c.term_months - 1))::date
        INTO v_last_month FROM contracts c WHERE c.id = NEW.contract_id;
      IF NEW.makeup_month > v_last_month THEN
        RAISE EXCEPTION 'a pause make-up must be within the original contract term'
          USING ERRCODE = 'CP011',
                HINT = 'ชดเชยจากพักสัญญาต้องอยู่ในอายุสัญญาเดิม — เกินแล้วให้ผู้ดูแลระบบ (host) บันทึก';
      END IF;
    END IF;
  ELSE
    NEW.origin := 'missed';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.missed_resolutions_pause_origin() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER missed_resolutions_pause_origin
  BEFORE INSERT OR UPDATE ON public.missed_service_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.missed_resolutions_pause_origin();

CREATE FUNCTION public.missed_notes_pause_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF contract_month_paused(NEW.contract_id, NEW.missed_month) THEN
    RAISE EXCEPTION 'a paused month is not a missed service'
      USING ERRCODE = 'CP012', HINT = 'เดือนนี้สัญญาพักอยู่ ไม่ใช่ตกบริการ — บันทึกหมายเหตุตกบริการไม่ได้';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.missed_notes_pause_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER missed_notes_pause_guard
  BEFORE INSERT OR UPDATE ON public.missed_service_notes
  FOR EACH ROW EXECUTE FUNCTION public.missed_notes_pause_guard();

-- =====================================================================
-- 6a. list_pending_missed_services — เนื้อเดิม 20261115200000_term_months.sql ทุกบรรทัด
--     + เงื่อนไขเดียวติดป้าย "M29" (เดือนที่พักไม่ขึ้นรายการรอตัดสิน) · signature เดิม → สิทธิ์เดิมคงอยู่
-- =====================================================================
CREATE OR REPLACE FUNCTION public.list_pending_missed_services(p_branch_id uuid DEFAULT NULL, p_month date DEFAULT NULL)
RETURNS TABLE (
  contract_id           uuid,
  customer_id           uuid,
  branch_id             uuid,
  missed_month          date,
  last_service_month    date,
  makeup_deadline_month date,
  past_deadline         boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role      text := current_app_role();
  v_now_month date := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
  v_upto      date;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'not allowed to read missed services' USING ERRCODE = '42501';
  END IF;
  v_upto := least(coalesce(date_trunc('month', p_month)::date, v_now_month), v_now_month);

  RETURN QUERY
  WITH c AS (
    SELECT ct.id AS contract_id, cu.id AS customer_id, cu.branch_id,
           missed_tracking_start_month(ct.start_date, ct.stations_initialized_at) AS track_from,
           (date_trunc('month', ct.start_date) + make_interval(months => ct.term_months - 1))::date AS last_month
      FROM contracts ct
      JOIN customers cu ON cu.id = ct.customer_id
     WHERE ct.status <> 'cancelled' AND ct.cancelled_at IS NULL
       AND NOT contract_is_renewed(ct.id)                         -- 2.47 + 2.51 ถูกแทนแล้ว (Renew / New ที่ใหม่กว่า)
       AND ct.stations_initialized_at IS NOT NULL
       AND (p_branch_id IS NULL OR cu.branch_id = p_branch_id)
       AND (v_role <> 'recorder' OR contract_in_scope(ct.id))
  ), m AS (
    SELECT c.*, gs::date AS missed_month
      FROM c,
           generate_series(c.track_from, least(c.last_month, (v_upto - interval '1 month')::date),
                           interval '1 month') gs
  )
  SELECT m.contract_id, m.customer_id, m.branch_id, m.missed_month, m.last_month,
         (m.last_month + make_interval(months => missed_makeup_deadline_months()))::date,
         v_now_month > (m.last_month + make_interval(months => missed_makeup_deadline_months()))::date
    FROM m
   WHERE NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = m.contract_id AND vi.visit_type = 'routine'
                        AND vi.makeup_for_month IS NULL
                        AND vi.visit_date >= m.missed_month
                        AND vi.visit_date < (m.missed_month + interval '1 month')::date)
     AND NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = m.contract_id AND vi.makeup_for_month = m.missed_month)
     AND NOT EXISTS (SELECT 1 FROM missed_service_resolutions r
                      WHERE r.contract_id = m.contract_id AND r.missed_month = m.missed_month
                        AND r.kind = 'waived')
     AND NOT contract_month_paused(m.contract_id, m.missed_month)   -- M29 (2.52): เดือนที่พักไม่ใช่ตกบริการ
   ORDER BY m.branch_id, m.customer_id, m.contract_id, m.missed_month;
END;
$$;

REVOKE ALL ON FUNCTION public.list_pending_missed_services(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_missed_services(uuid, date) TO authenticated;

-- =====================================================================
-- 6b. list_voided_missed_services — เนื้อเดิม 20261115220000_todo_voided_missed.sql ทุกบรรทัด
--     + เงื่อนไขเดียวติดป้าย "M29" · signature เดิม (CREATE OR REPLACE) → สิทธิ์เดิมคงอยู่
-- =====================================================================
CREATE OR REPLACE FUNCTION public.list_voided_missed_services(p_branch_id uuid DEFAULT NULL, p_month date DEFAULT NULL)
RETURNS TABLE (
  contract_id           uuid,
  customer_id           uuid,
  branch_id             uuid,
  missed_month          date,
  void_reason           text,
  voided_by_contract_id uuid,
  voided_by_start_date  date,
  voided_at             timestamptz,
  note                  text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role      text := current_app_role();
  v_now_month date := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
  v_upto      date;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'not allowed to read missed services' USING ERRCODE = '42501';
  END IF;
  v_upto := least(coalesce(date_trunc('month', p_month)::date, v_now_month), v_now_month);

  RETURN QUERY
  WITH c AS (
    SELECT ct.id AS contract_id, cu.id AS customer_id, cu.branch_id,
           missed_tracking_start_month(ct.start_date, ct.stations_initialized_at) AS track_from,
           (date_trunc('month', ct.start_date) + make_interval(months => ct.term_months - 1))::date AS last_month,
           contract_renewed_by(ct.id) AS by_id
      FROM contracts ct
      JOIN customers cu ON cu.id = ct.customer_id
     WHERE ct.status <> 'cancelled' AND ct.cancelled_at IS NULL
       AND ct.stations_initialized_at IS NOT NULL
       AND (p_branch_id IS NULL OR cu.branch_id = p_branch_id)
       AND (v_role <> 'recorder' OR contract_in_scope(ct.id))
  ), r AS (
    SELECT c.*,
           CASE WHEN n.renewed_from_contract_id = c.contract_id THEN 'renewed' ELSE 'new_contract' END AS reason,
           n.start_date AS by_start,
           n.created_at AS by_created
      FROM c
      JOIN contracts n ON n.id = c.by_id
  ), m AS (
    SELECT r.*, gs::date AS missed_month
      FROM r,
           generate_series(r.track_from,
                           least(r.last_month,
                                 (v_upto - interval '1 month')::date),
                           interval '1 month') gs
  )
  SELECT m.contract_id, m.customer_id, m.branch_id, m.missed_month,
         m.reason, m.by_id, m.by_start, m.by_created, nt.note
    FROM m
    LEFT JOIN missed_service_notes nt
           ON nt.contract_id = m.contract_id AND nt.missed_month = m.missed_month
   WHERE NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = m.contract_id AND vi.visit_type = 'routine'
                        AND vi.makeup_for_month IS NULL
                        AND vi.visit_date >= m.missed_month
                        AND vi.visit_date < (m.missed_month + interval '1 month')::date)
     AND NOT EXISTS (SELECT 1 FROM visits vi
                      WHERE vi.contract_id = m.contract_id AND vi.makeup_for_month = m.missed_month)
     AND NOT EXISTS (SELECT 1 FROM missed_service_resolutions rs
                      WHERE rs.contract_id = m.contract_id AND rs.missed_month = m.missed_month
                        AND rs.kind = 'waived')
     AND NOT contract_month_paused(m.contract_id, m.missed_month)   -- M29 (2.52): เดือนที่พักไม่ใช่ตกบริการ
   ORDER BY m.branch_id, m.customer_id, m.contract_id, m.missed_month;
END;
$$;

REVOKE ALL ON FUNCTION public.list_voided_missed_services(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_voided_missed_services(uuid, date) TO authenticated, service_role;

-- =====================================================================
-- 6c. central_unready_branches — เนื้อเดิม 20261115271000_month_close_ready_notes.sql (M39b) ทุกบรรทัด
--     + เงื่อนไขเดียวติดป้าย "M29" · signature เดิม → สิทธิ์เดิมคงอยู่ (เรียกได้จาก close_month_part เท่านั้น)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.central_unready_branches(p_month text)
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
     -- M39b: มีหมายเหตุตกบริการของเดือนนั้น = บันทึกแล้ว (เฉพาะความพร้อมปิดเดือน · ต่างจาก list_pending_missed_services)
     AND NOT EXISTS (SELECT 1 FROM missed_service_notes n
                      WHERE n.contract_id = ct.id AND n.missed_month = m.d)
     AND NOT contract_month_paused(ct.id, m.d)   -- M29 (2.52): เดือนที่พักไม่ใช่ตกบริการ
   GROUP BY b.id, b.name
   ORDER BY b.name;
$$;

REVOKE ALL ON FUNCTION public.central_unready_branches(text) FROM PUBLIC, anon, authenticated, service_role;

-- =====================================================================
-- 7a. /summary — ยอดพักสัญญารายสาขา × เดือน (ไม่มี PII · สิทธิ์แบบ v_branch_summary: anon + authenticated)
--   นับเฉพาะเดือนบริการ (ไม่ก่อนเดือนเริ่ม · ไม่เกินเดือนบริการสุดท้าย) ถึงเดือนปัจจุบัน · ไม่นับตั้งแต่เดือนที่ยกเลิก
--   paused_contracts = จำนวนสัญญาที่พักในเดือนนั้น (= ไม่อยู่ใน cust ของ Dashboard) · paused_value = มูลค่าสัญญาเต็มรวม
--   "พักไปกี่เดือน" รวม = ผลรวม paused_contracts ทุกเดือน (สัญญา-เดือน)
--   ไม่ใช่ security_invoker (เหมือน v_branch_summary) เพื่อให้ anon อ่านยอดรวมได้โดยไม่เห็นตารางต้นทาง
-- =====================================================================
CREATE VIEW public.v_paused_branch_summary AS
WITH pm AS (
  SELECT ct.id AS contract_id, cu.branch_id, ct.value_total, gs::date AS month
    FROM public.contract_pauses p
    JOIN public.contracts ct ON ct.id = p.contract_id
    JOIN public.customers cu ON cu.id = ct.customer_id
    CROSS JOIN LATERAL generate_series(
      greatest(p.paused_month, date_trunc('month', ct.start_date::timestamp)::date)::timestamp,
      least(coalesce((p.resume_month - interval '1 month')::date,
                     date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date),
            (date_trunc('month', ct.start_date::timestamp) + make_interval(months => ct.term_months - 1))::date,
            date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date)::timestamp,
      interval '1 month') gs
   WHERE ct.cancelled_at IS NULL
      OR gs::date < date_trunc('month', (ct.cancelled_at AT TIME ZONE 'Asia/Bangkok'))::date
)
SELECT to_char(pm.month, 'YYYY-MM') AS month_key,
       z.name                       AS zone_name,
       b.name                       AS branch_name,
       b.division                   AS division,
       count(*)::int                AS paused_contracts,
       sum(pm.value_total)::numeric(14,2) AS paused_value
  FROM pm
  JOIN public.branches b ON b.id = pm.branch_id
  JOIN public.zones z    ON z.id = b.zone_id
 GROUP BY pm.month, z.name, b.name, b.division;

COMMENT ON VIEW public.v_paused_branch_summary IS
  'M29 (DECISIONS 2.87): paused contracts per branch per month (count + full contract value). Aggregates only, no PII.';

REVOKE ALL ON public.v_paused_branch_summary FROM PUBLIC;
GRANT SELECT ON public.v_paused_branch_summary TO anon, authenticated, service_role;

-- =====================================================================
-- 7b. /todo — สัญญาที่พักอยู่ (เตือนเมื่อพักเกิน 3 เดือน · 2.63 ระบบไม่ยกเลิกเอง)
--   months_paused = จำนวนเดือนปฏิทินที่พักถึงตอนนี้ (นับเดือนที่เริ่มพัก ถึงเดือนปัจจุบัน)
--   warn = วันนี้ > วันเริ่มพัก + 3 เดือน
--   SECURITY INVOKER (RLS ของผู้เรียก) · recorder เห็นเฉพาะสัญญาในขอบเขต · บทบาทอื่น → 42501
-- =====================================================================
CREATE FUNCTION public.list_paused_contracts(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  pause_id      uuid,
  contract_id   uuid,
  contract_no   text,
  customer_id   uuid,
  customer_name text,
  branch_id     uuid,
  value_total   numeric,
  term_months   int,
  paused_from   date,
  reason        text,
  paused_by     uuid,
  paused_at     timestamptz,
  months_paused int,
  warn          boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role      text := current_app_role();
  v_today     date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_now_month date := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'not allowed to read paused contracts' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id, ct.id, ct.contract_no, cu.id, cu.name, cu.branch_id, ct.value_total, ct.term_months::int,
         p.paused_from, p.reason, p.paused_by, p.created_at,
         ((extract(year FROM age(v_now_month::timestamp, p.paused_month::timestamp)) * 12
           + extract(month FROM age(v_now_month::timestamp, p.paused_month::timestamp)))::int + 1),
         v_today > (p.paused_from + interval '3 months')::date
    FROM contract_pauses p
    JOIN contracts ct ON ct.id = p.contract_id
    JOIN customers cu ON cu.id = ct.customer_id
   WHERE p.resumed_at IS NULL AND ct.status = 'paused'
     AND (p_branch_id IS NULL OR cu.branch_id = p_branch_id)
     AND (v_role <> 'recorder' OR contract_in_scope(ct.id))
   ORDER BY p.paused_from, cu.name, ct.contract_no;
END;
$$;

COMMENT ON FUNCTION public.list_paused_contracts(uuid) IS
  'M29: contracts currently paused (#todo / registry status page). warn = paused for more than 3 months (DECISIONS 2.63).';

-- =====================================================================
-- 7c. ค้าง / ชดเชยแล้ว ของ "ชดเชยจากพักสัญญา" รายเดือนที่พัก (2.87)
--   เฉพาะช่วงพักที่กลับมาต่อแล้ว (end_kind = 'resumed') ของสัญญาที่ไม่ถูกยกเลิก · ตั้งแต่เดือนตั้งสถานี (2.46)
--   · เดือนบริการเท่านั้น · made_up = มีการเข้าชดเชยผูกไว้ · past_term = เลยอายุสัญญาแล้วยังค้าง (recorder บันทึกไม่ได้ → host)
-- =====================================================================
CREATE FUNCTION public.list_pause_makeups(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  pause_id           uuid,
  contract_id        uuid,
  customer_id        uuid,
  branch_id          uuid,
  paused_month       date,
  last_service_month date,
  made_up            boolean,
  makeup_month       date,
  makeup_visit_id    uuid,
  recorded_by        uuid,
  recorded_at        timestamptz,
  past_term          boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role      text := current_app_role();
  v_now_month date := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('host', 'admin', 'recorder') THEN
    RAISE EXCEPTION 'not allowed to read pause make-ups' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH c AS (
    SELECT p.id AS pause_id, ct.id AS contract_id, cu.id AS customer_id, cu.branch_id,
           greatest(p.paused_month,
                    missed_tracking_start_month(ct.start_date, ct.stations_initialized_at)) AS from_month,
           (p.resume_month - interval '1 month')::date AS to_month,
           (date_trunc('month', ct.start_date::timestamp) + make_interval(months => ct.term_months - 1))::date AS last_month
      FROM contract_pauses p
      JOIN contracts ct ON ct.id = p.contract_id
      JOIN customers cu ON cu.id = ct.customer_id
     WHERE p.end_kind = 'resumed'
       AND ct.status <> 'cancelled' AND ct.cancelled_at IS NULL
       AND ct.stations_initialized_at IS NOT NULL
       AND (p_branch_id IS NULL OR cu.branch_id = p_branch_id)
       AND (v_role <> 'recorder' OR contract_in_scope(ct.id))
  ), m AS (
    SELECT c.*, gs::date AS month
      FROM c,
           generate_series(c.from_month::timestamp, least(c.to_month, c.last_month)::timestamp, interval '1 month') gs
  )
  SELECT m.pause_id, m.contract_id, m.customer_id, m.branch_id, m.month, m.last_month,
         vi.id IS NOT NULL,
         r.makeup_month, vi.id, r.decided_by, r.decided_at,
         vi.id IS NULL AND v_now_month > m.last_month
    FROM m
    LEFT JOIN visits vi ON vi.contract_id = m.contract_id AND vi.makeup_for_month = m.month
    LEFT JOIN missed_service_resolutions r
           ON r.contract_id = m.contract_id AND r.missed_month = m.month AND r.kind = 'makeup'
   ORDER BY m.branch_id, m.customer_id, m.contract_id, m.month;
END;
$$;

COMMENT ON FUNCTION public.list_pause_makeups(uuid) IS
  'M29 (DECISIONS 2.87): paused service months that must be made up ("ชดเชยจากพักสัญญา"), with who/when when made up.';

REVOKE ALL ON FUNCTION public.list_paused_contracts(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_pause_makeups(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_paused_contracts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pause_makeups(uuid) TO authenticated;
