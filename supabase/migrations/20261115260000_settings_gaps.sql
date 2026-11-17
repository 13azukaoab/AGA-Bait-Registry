-- M38: ช่องว่างหน้าตั้งค่า 3 ข้อ (DECISIONS 2.71 · เจ้าของ 17 พ.ย. 2026)
--
-- Logic summary:
--   1. ประเภทลูกค้า: `customer_types.is_active` (ปิดใช้งาน) + `hint` (คำอธิบาย/tooltip ≤ 120 ตัวอักษร ตาม mockup)
--      - เขียนแบบเดิม: host แก้ตารางตรงผ่าน RLS `customer_types_host_write` (ไม่มี RPC ใหม่ — ไม่เพิ่มทางเขียน)
--        · audit ผ่าน trigger `audit_customer_types` เดิม (20261115170000 · AFTER INSERT/UPDATE/DELETE ทุกคอลัมน์)
--      - hint: NULL = ไม่มีคำอธิบาย · ห้ามเป็นช่องว่างล้วน / ยาวเกิน 120 → 23514 (FE ส่ง NULL เมื่อเว้นว่าง)
--      - ประเภทที่ปิดใช้: ลูกค้าเดิมคงค่าเดิม · เลือกให้ลูกค้าใหม่ / เปลี่ยนลูกค้าไปใช้ประเภทนี้ไม่ได้ → CT002
--        · ด่าน = BEFORE trigger บน `customers` (ทุกทางที่เขียน: save_job_opening, เขียนตรง, import)
--          ทำงานเฉพาะ INSERT ที่มีประเภท หรือ UPDATE ที่ "เปลี่ยน" ประเภท — บันทึกซ้ำค่าเดิม / แก้ชื่อลูกค้าผ่านได้
--        · ล็อกแถวประเภท (FOR SHARE) → host ปิดใช้แทรกระหว่างบันทึกลูกค้าไม่ได้ (รอกันตามลำดับ)
--        · ไม่ได้แทนที่ฟังก์ชันใดเลย
--      - หน้าจอกรอง dropdown ด้วย is_active เอง (ฝั่ง FE)
--   2. `preview_tier_rule_change(p_effective_month, p_rules)` — ดูอย่างเดียว · host เท่านั้น
--      - p_rules รูปเดียวกับ save_tier_rule_set: {"min_m": n, "min_l": n, "min_xl": n} (ตรวจแบบเดียวกัน → TR006)
--      - ขอบเขต: สัญญาที่มีเดือนบริการ ≥ p_effective_month (เดือนบริการสุดท้าย = เดือนเริ่ม + term_months − 1)
--        และยังไม่ถูกยกเลิกภายในเดือนนั้น (cancelled_at เดือนเดียวกันหรือก่อน = ไม่นับ — ตรงกับ buildBranchSnapshot)
--      - Tier ตอนนี้ = ชุดเกณฑ์ที่ใช้กับ p_effective_month (`tier_rules_for_month`) · Tier หลังแก้ = S จากชุดเดียวกัน
--        + จุดเริ่ม M/L/XL จาก p_rules · ไม่มีตัวเลขเกณฑ์ในโค้ด (กฎ CLAUDE ข้อ 3)
--      - มูลค่าต่อปี = `contract_annual_value(value_total, term_months)` ตรงกับ lib/rules `annualValueForTerm`:
--        ≤ 12 เดือน = มูลค่าจริง · 36 = ÷ 3 · อื่น = × 12 ÷ m · กลุ่มสี 36 → '3' อื่น → '1' (Custom นับ "1 ปี")
--      - คืนตัวเลขรวมเท่านั้น (from_tier, to_tier, term_group, contract_count) — ไม่มีชื่อลูกค้า/เลขสัญญา/สาขา
--      - ข้อจำกัด: ถ้ามีชุดเกณฑ์ล่วงหน้าหลัง p_effective_month อยู่แล้ว ชุดใหม่จะมีผลแค่ถึงก่อนชุดนั้น
--        แต่ตัวเลขนี้นับสัญญาทุกตัวที่มีเดือนบริการ ≥ p_effective_month (เป็นตัวเลขประมาณการ)
--   3. `list_notification_read_status()` — host เท่านั้น · 1 แถวต่อผู้ใช้ (ทุกแถวใน profiles)
--      - has_unread_position_change / unread_count / oldest_unread_at ของแจ้งเตือน kind = 'position_changed'
--      - ไม่คืน payload / ข้อความ · ไม่แก้ RLS ของ user_notifications (ยังอ่านได้เฉพาะของตัวเอง)
--   * error ใหม่: CT002 (ประเภทลูกค้าปิดใช้แล้ว) · TR006 (ข้อมูลตัวอย่างเกณฑ์ไม่ถูกต้อง)
--   * ไม่แตะ audit_trigger · ไม่แทนที่ function เดิม · RLS เดิมไม่เปลี่ยน

-- =====================================================================
-- 1. customer_types: is_active + hint
-- =====================================================================
ALTER TABLE public.customer_types
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN hint text,
  ADD CONSTRAINT customer_types_hint_check
    CHECK (hint IS NULL OR (char_length(hint) <= 120 AND btrim(hint) <> ''));

COMMENT ON COLUMN public.customer_types.is_active IS
  'M38: false = ปิดใช้ — ไม่โผล่ใน dropdown · ลูกค้าเดิมคงค่าเดิม · เลือกให้ลูกค้าใหม่/เปลี่ยนมาใช้ไม่ได้ (CT002)';
COMMENT ON COLUMN public.customer_types.hint IS
  'M38: คำอธิบาย (tooltip ตอนเลือก) ≤ 120 ตัวอักษร · NULL = ไม่มี';

-- ด่านประเภทที่ปิดใช้ (SECURITY DEFINER: ล็อกแถว FOR SHARE ต้องใช้สิทธิ์ UPDATE — ผู้เรียก recorder/admin ไม่มี)
CREATE FUNCTION public.customers_customer_type_active_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active boolean;
BEGIN
  IF NEW.customer_type IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.customer_type IS NOT DISTINCT FROM OLD.customer_type THEN
    RETURN NEW; -- บันทึกซ้ำค่าเดิม → ลูกค้าเดิมคงประเภทที่ปิดใช้ได้
  END IF;

  SELECT ct.is_active INTO v_active
    FROM public.customer_types ct
   WHERE ct.code = NEW.customer_type
     FOR SHARE;

  -- ไม่พบรหัส → ปล่อยให้ FK แจ้ง 23503 ตามเดิม
  IF v_active IS FALSE THEN
    RAISE EXCEPTION 'ประเภทลูกค้านี้ปิดใช้งานแล้ว เลือกประเภทอื่น' USING ERRCODE = 'CT002';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER customers_customer_type_active_guard
  BEFORE INSERT OR UPDATE OF customer_type ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.customers_customer_type_active_guard();

-- =====================================================================
-- 2. มูลค่าต่อปี (คู่กับ lib/rules/term.ts annualValueForTerm — แก้ฝั่งหนึ่งต้องแก้อีกฝั่ง)
-- =====================================================================
CREATE FUNCTION public.contract_annual_value(p_value_total numeric, p_term_months integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
           WHEN p_term_months <= 12 THEN p_value_total
           WHEN p_term_months = 36  THEN p_value_total / 3
           ELSE p_value_total * 12 / p_term_months
         END
$$;

COMMENT ON FUNCTION public.contract_annual_value(numeric, integer) IS
  'M38: มูลค่าจัด Tier ต่อปี — ≤ 12 เดือน = มูลค่าจริง · 36 = ÷ 3 · อื่น = × 12 ÷ m (ตรงกับ annualValueForTerm)';

-- =====================================================================
-- 3. ตัวอย่างผลกระทบเมื่อแก้เกณฑ์ Tier (ดูอย่างเดียว · host)
--    p_effective_month = วันที่ 1 ของเดือน · p_rules = {"min_m": 30000, "min_l": 50000, "min_xl": 100000}
-- =====================================================================
CREATE FUNCTION public.preview_tier_rule_change(p_effective_month date, p_rules jsonb)
RETURNS TABLE (from_tier text, to_tier text, term_group text, contract_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_keys    text[] := ARRAY['min_m', 'min_l', 'min_xl'];
  v_mins    numeric[] := ARRAY[]::numeric[];
  v_val     numeric;
  v_s_min   numeric;
  v_sets    integer;
  k         text;
BEGIN
  IF NOT public.is_host() THEN
    RAISE EXCEPTION 'ดูผลกระทบเกณฑ์ Tier ได้เฉพาะผู้ดูแลระบบ (host)' USING ERRCODE = '42501';
  END IF;

  IF p_effective_month IS NULL OR p_effective_month <> date_trunc('month', p_effective_month)::date THEN
    RAISE EXCEPTION 'เดือนเริ่มใช้ต้องเป็นวันที่ 1 ของเดือน' USING ERRCODE = 'TR006';
  END IF;
  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'object' THEN
    RAISE EXCEPTION 'ข้อมูลเกณฑ์ไม่ถูกต้อง' USING ERRCODE = 'TR006';
  END IF;

  -- ตรวจแบบเดียวกับ save_tier_rule_set (TR001 → TR006)
  FOREACH k IN ARRAY v_keys LOOP
    IF jsonb_typeof(p_rules -> k) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'ต้องระบุ % เป็นตัวเลข', k USING ERRCODE = 'TR006';
    END IF;
    v_val := (p_rules ->> k)::numeric;
    IF v_val <= 0 OR v_val >= 10000000000 THEN
      RAISE EXCEPTION '% ต้องมากกว่า 0 และไม่เกิน 9,999,999,999.99', k USING ERRCODE = 'TR006';
    END IF;
    IF v_val <> round(v_val, 2) THEN
      RAISE EXCEPTION '% มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง', k USING ERRCODE = 'TR006';
    END IF;
    v_mins := v_mins || v_val;
  END LOOP;
  IF NOT (v_mins[1] >= 0.02 AND v_mins[2] - v_mins[1] >= 0.02 AND v_mins[3] - v_mins[2] >= 0.02) THEN
    RAISE EXCEPTION 'จุดเริ่ม M < L < XL ต้องเรียงจากน้อยไปมาก (ห่างกันอย่างน้อย 0.02)' USING ERRCODE = 'TR006';
  END IF;

  SELECT count(*), min(r.min_annual) FILTER (WHERE r.tier = 'S')
    INTO v_sets, v_s_min
    FROM public.tier_rules_for_month(p_effective_month) r;
  IF v_sets = 0 OR v_s_min IS NULL THEN
    RAISE EXCEPTION 'ไม่มีเกณฑ์ Tier ที่ใช้กับเดือน %', to_char(p_effective_month, 'YYYY-MM')
      USING ERRCODE = 'TR006';
  END IF;

  RETURN QUERY
  WITH cur AS (
    SELECT r.tier AS tr, r.min_annual AS mn FROM public.tier_rules_for_month(p_effective_month) r
  ),
  prop (tr, mn) AS (
    VALUES ('S'::text, v_s_min), ('M'::text, v_mins[1]), ('L'::text, v_mins[2]), ('XL'::text, v_mins[3])
  ),
  scoped AS (
    SELECT public.contract_annual_value(c.value_total, c.term_months) AS annual,
           CASE WHEN c.term_months = 36 THEN '3' ELSE '1' END AS grp
      FROM public.contracts c
     WHERE (date_trunc('month', c.start_date) + make_interval(months => c.term_months - 1))::date
             >= p_effective_month
       -- status = 'cancelled' ⇔ มี cancelled_at (CHECK contracts_cancelled_status_matches_date)
       AND (c.cancelled_at IS NULL
            OR date_trunc('month', c.cancelled_at AT TIME ZONE 'Asia/Bangkok')::date > p_effective_month)
  ),
  classified AS (
    -- ต่ำกว่าทุกเกณฑ์ (มูลค่าติดลบ) → tier ต่ำสุด เหมือน tierOf ใน lib/rules
    SELECT coalesce((SELECT x.tr FROM cur x WHERE x.mn <= s.annual ORDER BY x.mn DESC LIMIT 1),
                    (SELECT x.tr FROM cur x ORDER BY x.mn LIMIT 1)) AS f,
           coalesce((SELECT y.tr FROM prop y WHERE y.mn <= s.annual ORDER BY y.mn DESC LIMIT 1),
                    (SELECT y.tr FROM prop y ORDER BY y.mn LIMIT 1)) AS t,
           s.grp
      FROM scoped s
  )
  SELECT cl.f, cl.t, cl.grp, count(*)::integer
    FROM classified cl
   GROUP BY cl.f, cl.t, cl.grp
   ORDER BY array_position(ARRAY['S', 'M', 'L', 'XL'], cl.f),
            array_position(ARRAY['S', 'M', 'L', 'XL'], cl.t),
            cl.grp;
END;
$$;

-- =====================================================================
-- 4. สถานะอ่านแจ้งเตือน "ตำแหน่งถูกเปลี่ยน" รายผู้ใช้ (host · ไม่เห็นเนื้อหา)
-- =====================================================================
CREATE FUNCTION public.list_notification_read_status()
RETURNS TABLE (user_id uuid, has_unread_position_change boolean, unread_count integer,
               oldest_unread_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_host() THEN
    RAISE EXCEPTION 'ดูสถานะการอ่านแจ้งเตือนได้เฉพาะผู้ดูแลระบบ (host)' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.user_id,
         coalesce(u.cnt, 0) > 0,
         coalesce(u.cnt, 0)::integer,
         u.oldest
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt, min(n.created_at) AS oldest
        FROM public.user_notifications n
       WHERE n.user_id = p.user_id
         AND n.kind = 'position_changed'
         AND n.read_at IS NULL
    ) u ON true
   ORDER BY p.user_id;
END;
$$;

-- =====================================================================
-- 5. สิทธิ์
-- =====================================================================
REVOKE ALL ON FUNCTION public.customers_customer_type_active_guard() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.contract_annual_value(numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_annual_value(numeric, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.preview_tier_rule_change(date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_tier_rule_change(date, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.list_notification_read_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_notification_read_status() TO authenticated;
