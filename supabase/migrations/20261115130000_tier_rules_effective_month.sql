-- M20: เกณฑ์ Tier มีหลายชุด แต่ละชุดมี "เดือนที่เริ่มใช้" (DECISIONS 2.31 · mockup settings.html FINAL)
--
-- Logic summary:
--   1. `tier_rules` เพิ่ม `effective_month` (วันที่ 1 ของเดือน) · 1 ชุด = 4 แถว (S/M/L/XL) ที่ effective_month เดียวกัน
--      · PK เปลี่ยนจาก (tier) เป็น (effective_month, tier) · เพิ่ม `id` (ให้ audit_log มี row_id) + `change_reason`
--      · แถวเดิม 4 แถว = ชุดตั้งต้น effective_month = 2000-01-01 (ค่าเดิมทุกตัว ไม่เปลี่ยน)
--   2. เดือนไหนใช้ชุดไหน = ชุดที่ effective_month ล่าสุดที่ไม่เกินเดือนนั้น
--      · DB: `tier_rules_for_month(p_month date)` · view `v_tier_rules_current` = ชุดของเดือนปัจจุบัน (เวลาไทย)
--      · TS: `rulesForMonth` / `tierOf(annual, rules, month)` ใน lib/rules/tier.ts (ตรรกะเดียวกัน)
--   3. ชุดต้องครบและต่อกันพอดี — constraint trigger `tier_rules_valid_set` (DEFERRABLE INITIALLY DEFERRED
--      ตรวจตอนจบ transaction เพราะแก้ทั้งชุดทีละแถว): S/M/L/XL ครบชุดละ 1 แถว · S เริ่ม 0 · min เรียงจากน้อยไปมาก
--      · max ของแถวหนึ่ง = min ของแถวถัดไป − 0.01 (ไม่มีช่องว่าง/ซ้อนทับ) · XL ไม่มี max · ทั้งตารางต้องเหลืออย่างน้อย 1 ชุด
--      → TR004 · RPC สั่ง SET CONSTRAINTS ... IMMEDIATE ให้ error ขึ้นทันที (ไม่ไปโผล่ตอน COMMIT)
--   4. เดือนที่ปิดแล้วคงเกณฑ์เดิม (2.31 ข้อ ก) — trigger `tier_rules_closed_month_guard` (ทุกทาง: RPC หรือเขียนตรง):
--      เพิ่ม/แก้/ลบชุดที่ช่วงมีผล [effective_month, ชุดถัดไป) ครอบเดือนที่มีแถวใน month_closures (scope ใดก็ได้)
--      ไม่ได้ → TR002 (จะเปลี่ยนเกณฑ์ของเดือนที่ปิดแล้ว) · UPDATE ที่ค่าไม่เปลี่ยนผ่านได้
--      · trigger ล็อก month_closures (SHARE) เอง → ปิดเดือนแทรกระหว่างตรวจไม่ได้ ทั้งทาง RPC และเขียนตรง
--      · ชุดตั้งต้น (เดือนแรกสุด) ลบ/ย้ายเดือนไม่ได้ → TR004 (กันเดือนเก่าไม่มีเกณฑ์)
--      · ข้อจำกัด: เดือน legacy (JAN.25–SEP.26) ที่ไม่มีแถวใน month_closures ไม่ถูกกัน — รอเจ้าของตัดสิน (ดูรายงาน M20)
--   5. บันทึกชุดใหม่: RPC `save_tier_rule_set(p jsonb)` — **host เท่านั้น** (SPEC §5 + mockup settings data-roles="host")
--      · รับ effective_month + จุดเริ่ม M/L/XL + เหตุผล → สร้าง 4 แถว (S = 0, max คำนวณให้) · เดือนเดิมซ้ำ = แทนชุดเดิม
--      · ทศนิยมเกิน 2 ตำแหน่ง → TR001 (numeric(12,2) ปัดเงียบๆ จึงต้องเช็กเอง) · ต้องหลังชุดตั้งต้น
--      · คำยืนยัน "ยืนยันแก้ไข" ตรวจที่หน้าจอ (FE) · DB บังคับ role
--   6. audit: trigger `audit_tier_rules` ใช้ `audit_trigger()` เดิม (ไม่แก้เนื้อ — กันชนกับ migration อื่น)
--      · เหตุผลอยู่ใน new_data.change_reason · ผู้แก้/เวลาอยู่ใน audit_log.changed_by/changed_at
--   7. สิทธิ์เดิมไม่เปลี่ยน: อ่าน = authenticated ทุก role (รวม viewer — เกณฑ์ไม่ใช่ข้อมูลส่วนบุคคล) · anon อ่านไม่ได้
--      · policy เขียนตรงของ host (tier_rules_host_write) คงไว้ แต่ trigger ข้อ 3–4 บังคับเหมือนทาง RPC
--   * error: TR001 ข้อมูลไม่ถูกต้อง · TR002 กระทบเดือนที่ปิดแล้ว · TR003 ไม่มีเหตุผล · TR004 ชุดเกณฑ์ไม่ครบ/ไม่ต่อกัน

-- =====================================================================
-- 1. คอลัมน์ใหม่ + ชุดตั้งต้น
-- =====================================================================
ALTER TABLE public.tier_rules
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN effective_month date,
  ADD COLUMN change_reason text;

UPDATE public.tier_rules SET effective_month = DATE '2000-01-01';

ALTER TABLE public.tier_rules
  ALTER COLUMN effective_month SET NOT NULL,
  ADD CONSTRAINT tier_rules_effective_month_first_day
    CHECK (effective_month = date_trunc('month', effective_month)::date),
  ADD CONSTRAINT tier_rules_id_key UNIQUE (id);

ALTER TABLE public.tier_rules DROP CONSTRAINT tier_rules_pkey;
ALTER TABLE public.tier_rules ADD PRIMARY KEY (effective_month, tier);

COMMENT ON COLUMN public.tier_rules.effective_month IS
  'M20 (DECISIONS 2.31): เดือนที่ชุดเกณฑ์เริ่มใช้ (วันที่ 1) — เดือนใดใช้ชุดที่ effective_month ล่าสุดไม่เกินเดือนนั้น';
COMMENT ON COLUMN public.tier_rules.change_reason IS
  'M20: เหตุผลที่บันทึกชุดเกณฑ์นี้ (บังคับเมื่อบันทึกผ่าน save_tier_rule_set · ชุดตั้งต้น = NULL)';

-- =====================================================================
-- 2. ชุดต้องครบและต่อกันพอดี (ตรวจตอนจบ transaction)
-- =====================================================================
CREATE FUNCTION public.tier_rules_check_set(p_month date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tiers text[];
  v_mins  numeric[];
  v_maxs  numeric[];
  i       int;
BEGIN
  SELECT array_agg(tier ORDER BY min_annual, tier),
         array_agg(min_annual ORDER BY min_annual, tier),
         array_agg(max_annual ORDER BY min_annual, tier)
    INTO v_tiers, v_mins, v_maxs
    FROM tier_rules WHERE effective_month = p_month;

  IF v_tiers IS NULL THEN
    -- ทั้งชุดถูกลบ — ได้ แต่ทั้งตารางต้องเหลืออย่างน้อย 1 ชุด
    IF NOT EXISTS (SELECT 1 FROM tier_rules) THEN
      RAISE EXCEPTION 'ต้องมีเกณฑ์ Tier อย่างน้อย 1 ชุด' USING ERRCODE = 'TR004';
    END IF;
    RETURN;
  END IF;

  IF v_tiers IS DISTINCT FROM ARRAY['S', 'M', 'L', 'XL'] THEN
    RAISE EXCEPTION 'ชุดเกณฑ์ % ต้องมี S, M, L, XL ครบอย่างละ 1 แถว เรียงตามมูลค่า (ได้ %)',
      to_char(p_month, 'YYYY-MM'), v_tiers USING ERRCODE = 'TR004';
  END IF;
  IF v_mins[1] <> 0 THEN
    RAISE EXCEPTION 'ชุดเกณฑ์ %: Tier S ต้องเริ่มที่ 0', to_char(p_month, 'YYYY-MM') USING ERRCODE = 'TR004';
  END IF;
  FOR i IN 1..3 LOOP
    IF v_mins[i + 1] <= v_mins[i] THEN
      RAISE EXCEPTION 'ชุดเกณฑ์ %: จุดเริ่มต้องเรียงจากน้อยไปมาก', to_char(p_month, 'YYYY-MM')
        USING ERRCODE = 'TR004';
    END IF;
    IF v_maxs[i] IS DISTINCT FROM v_mins[i + 1] - 0.01 THEN
      RAISE EXCEPTION 'ชุดเกณฑ์ %: ปลายช่วง % ต้องเท่ากับจุดเริ่ม % − 0.01 (ห้ามมีช่องว่าง/ซ้อนทับ)',
        to_char(p_month, 'YYYY-MM'), v_tiers[i], v_tiers[i + 1] USING ERRCODE = 'TR004';
    END IF;
  END LOOP;
  IF v_maxs[4] IS NOT NULL THEN
    RAISE EXCEPTION 'ชุดเกณฑ์ %: Tier XL ต้องไม่มีปลายช่วง', to_char(p_month, 'YYYY-MM') USING ERRCODE = 'TR004';
  END IF;
END;
$$;

CREATE FUNCTION public.tier_rules_valid_set_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.tier_rules_check_set(OLD.effective_month);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.tier_rules_check_set(NEW.effective_month);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER tier_rules_valid_set
  AFTER INSERT OR UPDATE OR DELETE ON public.tier_rules
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tier_rules_valid_set_trigger();

-- =====================================================================
-- 3. เดือนที่ปิดแล้วคงเกณฑ์เดิม (ทุกทางที่เขียน)
-- =====================================================================
CREATE FUNCTION public.tier_rules_closed_month_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month    date;
  v_next     date;
  v_baseline date;
  v_closed   text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;

  -- กันปิดเดือนแทรกระหว่างตรวจ (ทุกทาง ไม่ใช่แค่ RPC) — ปิดเดือนรอจนรายการนี้ commit
  LOCK TABLE public.month_closures IN SHARE MODE;

  -- ชุดตั้งต้น (เดือนแรกสุด) ลบหรือย้ายเดือนไม่ได้ — ไม่งั้นเดือนเก่าไม่มีเกณฑ์ (แก้ค่าได้ถ้าไม่กระทบเดือนที่ปิด)
  IF TG_OP <> 'INSERT' THEN
    SELECT min(effective_month) INTO v_baseline FROM tier_rules;
    IF OLD.effective_month = v_baseline
       AND (TG_OP = 'DELETE' OR NEW.effective_month <> OLD.effective_month) THEN
      RAISE EXCEPTION 'ชุดเกณฑ์ตั้งต้น (%) ลบหรือย้ายเดือนไม่ได้', to_char(v_baseline, 'YYYY-MM')
        USING ERRCODE = 'TR004';
    END IF;
  END IF;

  -- ช่วงที่ชุดนี้มีผล = ตั้งแต่ effective_month ถึงก่อนชุดถัดไป
  -- (ทั้งตอนเพิ่ม/แก้ และตอนลบ — ลบแล้วช่วงนี้กลับไปใช้ชุดก่อนหน้า)
  FOREACH v_month IN ARRAY ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.effective_month END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.effective_month END
  ] LOOP
    CONTINUE WHEN v_month IS NULL;
    SELECT min(effective_month) INTO v_next FROM tier_rules WHERE effective_month > v_month;
    SELECT max(public.normalize_month_key(mc.month_key)) INTO v_closed
      FROM month_closures mc
     WHERE public.normalize_month_key(mc.month_key) >= to_char(v_month, 'YYYY-MM')
       AND (v_next IS NULL OR public.normalize_month_key(mc.month_key) < to_char(v_next, 'YYYY-MM'));
    IF v_closed IS NOT NULL THEN
      RAISE EXCEPTION 'เกณฑ์ที่เริ่มใช้ % จะกระทบเดือน % ที่ปิดแล้ว — เลือกเดือนเริ่มใช้หลังเดือนที่ปิดล่าสุด',
        to_char(v_month, 'YYYY-MM'), v_closed USING ERRCODE = 'TR002';
    END IF;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER tier_rules_closed_month_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.tier_rules
  FOR EACH ROW EXECUTE FUNCTION public.tier_rules_closed_month_guard();

-- =====================================================================
-- 4. audit (ใช้ audit_trigger เดิม ไม่แก้เนื้อฟังก์ชัน)
-- =====================================================================
CREATE TRIGGER audit_tier_rules
  AFTER INSERT OR UPDATE OR DELETE ON public.tier_rules
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- =====================================================================
-- 5. อ่านชุดเกณฑ์ของเดือน
-- =====================================================================
-- SECURITY INVOKER: อ่านตาม RLS ของผู้เรียก (tier_rules อ่านได้ทุก authenticated)
CREATE FUNCTION public.tier_rules_for_month(p_month date)
RETURNS SETOF public.tier_rules
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT r.*
    FROM tier_rules r
   WHERE r.effective_month = (SELECT max(x.effective_month) FROM tier_rules x
                               WHERE x.effective_month <= date_trunc('month', p_month)::date)
   ORDER BY r.min_annual
$$;

-- ชุดที่ใช้กับเดือนปัจจุบัน (เวลาไทย) — คอลัมน์เดิม + effective_month ให้หน้าจอเปลี่ยนจาก `tier_rules` ได้บรรทัดเดียว
CREATE VIEW public.v_tier_rules_current
WITH (security_invoker = true) AS
SELECT tier, min_annual, max_annual, effective_month
  FROM public.tier_rules_for_month((now() AT TIME ZONE 'Asia/Bangkok')::date);

-- =====================================================================
-- 6. RPC บันทึกชุดเกณฑ์ (host เท่านั้น)
--    p = {"effective_month": "2027-01" | "2027-01-01", "min_m": 30000, "min_l": 50000, "min_xl": 100000,
--         "reason": "..."}
--    คืน {"effective_month": "2027-01-01", "rules": [{tier, min_annual, max_annual}, ...]}
-- =====================================================================
CREATE FUNCTION public.save_tier_rule_set(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month_txt text := p ->> 'effective_month';
  v_month     date;
  v_reason    text := btrim(coalesce(p ->> 'reason', ''));
  v_keys      text[] := ARRAY['min_m', 'min_l', 'min_xl'];
  v_mins      numeric[] := ARRAY[]::numeric[];
  v_val       numeric;
  v_baseline  date;
  k           text;
BEGIN
  IF NOT public.is_host() THEN
    RAISE EXCEPTION 'บันทึกเกณฑ์ Tier ได้เฉพาะผู้ดูแลระบบ (host)' USING ERRCODE = '42501';
  END IF;

  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'ข้อมูลไม่ถูกต้อง' USING ERRCODE = 'TR001';
  END IF;

  IF v_month_txt IS NULL OR v_month_txt !~ '^\d{4}-(0[1-9]|1[0-2])(-01)?$' THEN
    RAISE EXCEPTION 'เดือนเริ่มใช้ต้องเป็นรูปแบบ YYYY-MM' USING ERRCODE = 'TR001';
  END IF;
  v_month := to_date(left(v_month_txt, 7) || '-01', 'YYYY-MM-DD');

  FOREACH k IN ARRAY v_keys LOOP
    IF jsonb_typeof(p -> k) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'ต้องระบุ % เป็นตัวเลข', k USING ERRCODE = 'TR001';
    END IF;
    v_val := (p ->> k)::numeric;
    IF v_val <= 0 OR v_val >= 10000000000 THEN
      RAISE EXCEPTION '% ต้องมากกว่า 0 และไม่เกิน 9,999,999,999.99', k USING ERRCODE = 'TR001';
    END IF;
    IF v_val <> round(v_val, 2) THEN
      RAISE EXCEPTION '% มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง', k USING ERRCODE = 'TR001';
    END IF;
    v_mins := v_mins || v_val;
  END LOOP;
  -- ห่างกันอย่างน้อย 0.02 (และ M >= 0.02) — ไม่งั้นปลายช่วง (= จุดเริ่มถัดไป − 0.01) ไม่มากกว่าจุดเริ่มของตัวเอง
  IF NOT (v_mins[1] >= 0.02 AND v_mins[2] - v_mins[1] >= 0.02 AND v_mins[3] - v_mins[2] >= 0.02) THEN
    RAISE EXCEPTION 'จุดเริ่ม M < L < XL ต้องเรียงจากน้อยไปมาก (ห่างกันอย่างน้อย 0.02)' USING ERRCODE = 'TR001';
  END IF;

  IF v_reason = '' THEN
    RAISE EXCEPTION 'ต้องระบุเหตุผลที่แก้เกณฑ์' USING ERRCODE = 'TR003';
  END IF;
  IF length(v_reason) > 500 THEN
    RAISE EXCEPTION 'เหตุผลยาวได้ไม่เกิน 500 ตัวอักษร' USING ERRCODE = 'TR001';
  END IF;

  -- กันบันทึกชนกัน (การล็อก month_closures อยู่ใน trigger guard)
  LOCK TABLE public.tier_rules IN SHARE ROW EXCLUSIVE MODE;

  SELECT min(effective_month) INTO v_baseline FROM tier_rules;
  IF v_baseline IS NOT NULL AND v_month <= v_baseline THEN
    RAISE EXCEPTION 'เดือนเริ่มใช้ต้องหลังชุดตั้งต้น (%)', to_char(v_baseline, 'YYYY-MM') USING ERRCODE = 'TR001';
  END IF;

  INSERT INTO tier_rules AS t (effective_month, tier, min_annual, max_annual, change_reason)
  VALUES
    (v_month, 'S',  0,          v_mins[1] - 0.01, v_reason),
    (v_month, 'M',  v_mins[1],  v_mins[2] - 0.01, v_reason),
    (v_month, 'L',  v_mins[2],  v_mins[3] - 0.01, v_reason),
    (v_month, 'XL', v_mins[3],  NULL,             v_reason)
  ON CONFLICT (effective_month, tier) DO UPDATE
    SET min_annual    = EXCLUDED.min_annual,
        max_annual    = EXCLUDED.max_annual,
        change_reason = EXCLUDED.change_reason;

  -- ให้ TR004 ขึ้นทันที · หมายเหตุ: มีผลกับส่วนที่เหลือของ transaction ผู้เรียกด้วย
  -- (ผ่าน PostgREST = 1 คำสั่งต่อ transaction ไม่กระทบ)
  SET CONSTRAINTS public.tier_rules_valid_set IMMEDIATE;

  RETURN jsonb_build_object(
    'effective_month', to_char(v_month, 'YYYY-MM-DD'),
    'rules', (SELECT jsonb_agg(jsonb_build_object('tier', tier, 'min_annual', min_annual,
                                                  'max_annual', max_annual) ORDER BY min_annual)
                FROM tier_rules WHERE effective_month = v_month)
  );
END;
$$;

-- =====================================================================
-- 7. สิทธิ์ (function + view ใหม่ทุกตัว)
-- =====================================================================
REVOKE ALL ON FUNCTION public.tier_rules_check_set(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tier_rules_valid_set_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tier_rules_closed_month_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tier_rules_for_month(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tier_rules_for_month(date) TO authenticated;
REVOKE ALL ON FUNCTION public.save_tier_rule_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_tier_rule_set(jsonb) TO authenticated;

REVOKE ALL ON public.v_tier_rules_current FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_tier_rules_current TO authenticated;
