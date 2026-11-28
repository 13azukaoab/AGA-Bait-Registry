-- Tier XXL (DECISIONS 2.112 · 2.113 · 2.115 · เจ้าของ 28 พ.ย. 2026 · ทำหลัง go-live)
--
-- Logic summary:
--   1. Tier ใหม่ 'XXL' สูงกว่า XL · เกณฑ์อยู่ใน `tier_rules` แบบเดียวกับ M/L/XL (กฎ CLAUDE ข้อ 3 — ไม่มีตัวเลขในโค้ด)
--      - CHECK `tier_rules_tier_check` รับ 'XXL' เพิ่ม
--      - 1 ชุดเกณฑ์ = 4 แถว (S/M/L/XL — ไม่มี XXL) **หรือ** 5 แถว (S/M/L/XL/XXL)
--        · ชุด 5 แถว: ปลายช่วง XL = จุดเริ่ม XXL − 0.01 · XXL ไม่มีปลายช่วง · ชุด 4 แถว: กติกาเดิมทุกข้อ (XL ไม่มีปลายช่วง)
--        · ด่านเดิม `tier_rules_check_set` (constraint trigger tier_rules_valid_set) รองรับทั้ง 2 แบบ → TR004
--   2. **ไม่เติม XXL ให้ชุดเกณฑ์ที่มีอยู่แล้ว** (2.115: มีผลตั้งแต่เดือนที่บันทึกเกณฑ์ · เดือนที่ปิดแล้วคงเดิม)
--      - ชุดตั้งต้น 2000-01-01 และชุดที่บันทึกไว้ก่อน = ไม่มี XXL → เดือนเหล่านั้นไม่มีสัญญา XXL (ผลเหมือนก่อน migration ทุกบิต)
--      - migration นี้ไม่เพิ่มแถวข้อมูลใดๆ (ไม่ seed 300,000) — host บันทึกชุดใหม่ที่มี XXL ผ่านหน้าตั้งค่า
--        (ค่าตั้งต้นตาม 2.115 = 300,000 บาท/ปี · หน้าตั้งค่าช่องที่ 5 = งานหมวด 1)
--   3. `save_tier_rule_set(p)` (เนื้อ M25 20261115170000 ทุกบรรทัด + บล็อก "XXL"):
--      - รับ `min_xxl` (ไม่บังคับ) · ไม่ส่ง / ส่ง null = ชุดนี้ไม่มี XXL (payload 3 ช่องของหน้าจอเดิมใช้ได้เหมือนเดิม)
--      - ตรวจแบบเดียวกับ M/L/XL (number · > 0 · ≤ 9,999,999,999.99 · ทศนิยม ≤ 2) + ต้องมากกว่า XL อย่างน้อย 0.02 → TR001
--      - บันทึกเดือนเดิมซ้ำโดยไม่มี min_xxl → ลบแถว XXL เดิมของเดือนนั้น (ไม่งั้นชุดค้าง 5 แถวที่ปลาย XL ผิด → TR004)
--      - เขียน 2 คำสั่ง → ตั้ง tier_rules_valid_set เป็น DEFERRED ก่อนเขียน แล้ว IMMEDIATE ตอนจบ (ตรวจทั้งชุดครั้งเดียว)
--   4. `preview_tier_rule_change(p_effective_month, p_rules)` (เนื้อ M38 20261115260000 + บล็อก "XXL"):
--      - รับ `min_xxl` (ไม่บังคับ) กติกาเดียวกับ save → TR006 · ชุดปัจจุบันที่มี XXL จัด XXL ได้ตามแถวใน tier_rules
--      - เรียงผล S, M, L, XL, XXL
--   5. Snapshot / Dashboard (2.112): ฐานข้อมูลไม่มีฟังก์ชันคำนวณ snapshot (คำนวณใน lib/rules buildBranchSnapshot)
--      → XXL1 รวมเข้า xl1 · XXL3 รวมเข้า xl3 · มูลค่า XXL รวมเข้า vXL ทำฝั่ง TS · ตาราง monthly_branch_snapshots ไม่เปลี่ยน
--      · เดือนที่ปิดแล้วไม่คำนวณใหม่เอง (กฎ CLAUDE ข้อ 7)
--   * ไม่แตะ audit_trigger · ไม่แตะ tier_rules_closed_month_guard (ด่าน TR002/TR005 ใช้กับแถว XXL เหมือนแถวอื่น)
--   * RLS เดิมไม่เปลี่ยน (อ่าน = authenticated ทุก role · เขียนตรง = host · RPC = host)

-- =====================================================================
-- 1. CHECK ชื่อ tier
-- =====================================================================
ALTER TABLE public.tier_rules DROP CONSTRAINT tier_rules_tier_check;
ALTER TABLE public.tier_rules
  ADD CONSTRAINT tier_rules_tier_check CHECK (tier IN ('S', 'M', 'L', 'XL', 'XXL'));

-- =====================================================================
-- 2. ชุดต้องครบและต่อกันพอดี — 4 แถว (ไม่มี XXL) หรือ 5 แถว (มี XXL)
--    (เนื้อ M20 20261115130000 · ข้อความ/รหัส error ของชุด 4 แถวคงเดิม)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tier_rules_check_set(p_month date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tiers text[];
  v_mins  numeric[];
  v_maxs  numeric[];
  v_n     int;
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

  -- XXL: ชุดมีได้ 2 แบบ
  IF v_tiers IS DISTINCT FROM ARRAY['S', 'M', 'L', 'XL']
     AND v_tiers IS DISTINCT FROM ARRAY['S', 'M', 'L', 'XL', 'XXL'] THEN
    RAISE EXCEPTION 'ชุดเกณฑ์ % ต้องมี S, M, L, XL (และ XXL ถ้ามี) ครบอย่างละ 1 แถว เรียงตามมูลค่า (ได้ %)',
      to_char(p_month, 'YYYY-MM'), v_tiers USING ERRCODE = 'TR004';
  END IF;
  v_n := array_length(v_tiers, 1);

  IF v_mins[1] <> 0 THEN
    RAISE EXCEPTION 'ชุดเกณฑ์ %: Tier S ต้องเริ่มที่ 0', to_char(p_month, 'YYYY-MM') USING ERRCODE = 'TR004';
  END IF;
  FOR i IN 1..(v_n - 1) LOOP
    IF v_mins[i + 1] <= v_mins[i] THEN
      RAISE EXCEPTION 'ชุดเกณฑ์ %: จุดเริ่มต้องเรียงจากน้อยไปมาก', to_char(p_month, 'YYYY-MM')
        USING ERRCODE = 'TR004';
    END IF;
    IF v_maxs[i] IS DISTINCT FROM v_mins[i + 1] - 0.01 THEN
      RAISE EXCEPTION 'ชุดเกณฑ์ %: ปลายช่วง % ต้องเท่ากับจุดเริ่ม % − 0.01 (ห้ามมีช่องว่าง/ซ้อนทับ)',
        to_char(p_month, 'YYYY-MM'), v_tiers[i], v_tiers[i + 1] USING ERRCODE = 'TR004';
    END IF;
  END LOOP;
  IF v_maxs[v_n] IS NOT NULL THEN
    RAISE EXCEPTION 'ชุดเกณฑ์ %: Tier % ต้องไม่มีปลายช่วง', to_char(p_month, 'YYYY-MM'), v_tiers[v_n]
      USING ERRCODE = 'TR004';
  END IF;
END;
$$;

-- =====================================================================
-- 3. RPC บันทึกชุดเกณฑ์ (เนื้อ M25 20261115170000 ทุกบรรทัด + บล็อก "XXL")
--    p = {"effective_month": "2027-01", "min_m": 30000, "min_l": 50000, "min_xl": 100000,
--         "min_xxl": 300000 (ไม่บังคับ), "reason": "..."}
-- =====================================================================
CREATE OR REPLACE FUNCTION public.save_tier_rule_set(p jsonb)
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
  v_go_live   date;   -- M25
  v_xxl       numeric; -- XXL: NULL = ชุดนี้ไม่มี XXL
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

  -- XXL (2.115): ไม่บังคับ · ไม่ส่ง / null = ไม่มี XXL · มี = ตรวจแบบเดียวกับช่องอื่น + มากกว่า XL อย่างน้อย 0.02
  IF p ? 'min_xxl' AND jsonb_typeof(p -> 'min_xxl') <> 'null' THEN
    IF jsonb_typeof(p -> 'min_xxl') <> 'number' THEN
      RAISE EXCEPTION 'ต้องระบุ min_xxl เป็นตัวเลข' USING ERRCODE = 'TR001';
    END IF;
    v_xxl := (p ->> 'min_xxl')::numeric;
    IF v_xxl <= 0 OR v_xxl >= 10000000000 THEN
      RAISE EXCEPTION 'min_xxl ต้องมากกว่า 0 และไม่เกิน 9,999,999,999.99' USING ERRCODE = 'TR001';
    END IF;
    IF v_xxl <> round(v_xxl, 2) THEN
      RAISE EXCEPTION 'min_xxl มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง' USING ERRCODE = 'TR001';
    END IF;
    IF v_xxl - v_mins[3] < 0.02 THEN
      RAISE EXCEPTION 'จุดเริ่ม XXL ต้องมากกว่า XL (ห่างกันอย่างน้อย 0.02)' USING ERRCODE = 'TR001';
    END IF;
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

  -- M25 (M20b · DECISIONS 2.49 ①): ห้ามตั้งเกณฑ์ใหม่ก่อนเดือนเริ่มใช้ระบบ (หลังด่านชุดตั้งต้นของ M20 — TR001 เดิมคงอยู่)
  v_go_live := public.go_live_month();
  IF v_month < v_go_live THEN
    RAISE EXCEPTION 'เกณฑ์ Tier ต้องเริ่มใช้ตั้งแต่เดือนเริ่มใช้ระบบ (%) เป็นต้นไป', to_char(v_go_live, 'YYYY-MM')
      USING ERRCODE = 'TR005';
  END IF;

  -- XXL: การเขียนชุดเกณฑ์มี 2 คำสั่ง (4 แถวหลัก + แถว XXL) ระหว่างคำสั่งชุดยังไม่ต่อกัน
  -- → ตรวจตอนจบ (IMMEDIATE ด้านล่าง) ไม่ใช่ทีละคำสั่ง แม้ transaction นี้เคยตั้ง IMMEDIATE ไว้ก่อน
  SET CONSTRAINTS public.tier_rules_valid_set DEFERRED;

  INSERT INTO tier_rules AS t (effective_month, tier, min_annual, max_annual, change_reason)
  VALUES
    (v_month, 'S',  0,          v_mins[1] - 0.01, v_reason),
    (v_month, 'M',  v_mins[1],  v_mins[2] - 0.01, v_reason),
    (v_month, 'L',  v_mins[2],  v_mins[3] - 0.01, v_reason),
    (v_month, 'XL', v_mins[3],  v_xxl - 0.01,     v_reason)  -- XXL: ไม่มี XXL → NULL (เหมือนเดิม)
  ON CONFLICT (effective_month, tier) DO UPDATE
    SET min_annual    = EXCLUDED.min_annual,
        max_annual    = EXCLUDED.max_annual,
        change_reason = EXCLUDED.change_reason;

  -- XXL: มี → เพิ่ม/แก้แถว XXL · ไม่มี → ลบแถว XXL เดิมของเดือนนี้ (บันทึกเดือนเดิมซ้ำแบบไม่มี XXL)
  IF v_xxl IS NOT NULL THEN
    INSERT INTO tier_rules AS t (effective_month, tier, min_annual, max_annual, change_reason)
    VALUES (v_month, 'XXL', v_xxl, NULL, v_reason)
    ON CONFLICT (effective_month, tier) DO UPDATE
      SET min_annual    = EXCLUDED.min_annual,
          max_annual    = EXCLUDED.max_annual,
          change_reason = EXCLUDED.change_reason;
  ELSE
    DELETE FROM tier_rules WHERE effective_month = v_month AND tier = 'XXL';
  END IF;

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
-- 4. ตัวอย่างผลกระทบเมื่อแก้เกณฑ์ Tier (เนื้อ M38 20261115260000 + บล็อก "XXL")
--    p_rules = {"min_m": 30000, "min_l": 50000, "min_xl": 100000, "min_xxl": 300000 (ไม่บังคับ)}
-- =====================================================================
CREATE OR REPLACE FUNCTION public.preview_tier_rule_change(p_effective_month date, p_rules jsonb)
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
  v_xxl     numeric; -- XXL: NULL = ชุดที่เสนอไม่มี XXL
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

  -- XXL: กติกาเดียวกับ save_tier_rule_set (TR001 → TR006)
  IF p_rules ? 'min_xxl' AND jsonb_typeof(p_rules -> 'min_xxl') <> 'null' THEN
    IF jsonb_typeof(p_rules -> 'min_xxl') <> 'number' THEN
      RAISE EXCEPTION 'ต้องระบุ min_xxl เป็นตัวเลข' USING ERRCODE = 'TR006';
    END IF;
    v_xxl := (p_rules ->> 'min_xxl')::numeric;
    IF v_xxl <= 0 OR v_xxl >= 10000000000 THEN
      RAISE EXCEPTION 'min_xxl ต้องมากกว่า 0 และไม่เกิน 9,999,999,999.99' USING ERRCODE = 'TR006';
    END IF;
    IF v_xxl <> round(v_xxl, 2) THEN
      RAISE EXCEPTION 'min_xxl มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง' USING ERRCODE = 'TR006';
    END IF;
    IF v_xxl - v_mins[3] < 0.02 THEN
      RAISE EXCEPTION 'จุดเริ่ม XXL ต้องมากกว่า XL (ห่างกันอย่างน้อย 0.02)' USING ERRCODE = 'TR006';
    END IF;
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
    VALUES ('S'::text, v_s_min), ('M'::text, v_mins[1]), ('L'::text, v_mins[2]), ('XL'::text, v_mins[3]),
           ('XXL'::text, v_xxl) -- XXL: NULL = ไม่มี XXL (ตัดทิ้งด้านล่าง)
  ),
  prop_set AS (
    SELECT y.tr, y.mn FROM prop y WHERE y.mn IS NOT NULL
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
           coalesce((SELECT y.tr FROM prop_set y WHERE y.mn <= s.annual ORDER BY y.mn DESC LIMIT 1),
                    (SELECT y.tr FROM prop_set y ORDER BY y.mn LIMIT 1)) AS t,
           s.grp
      FROM scoped s
  )
  SELECT cl.f, cl.t, cl.grp, count(*)::integer
    FROM classified cl
   GROUP BY cl.f, cl.t, cl.grp
   ORDER BY array_position(ARRAY['S', 'M', 'L', 'XL', 'XXL'], cl.f),
            array_position(ARRAY['S', 'M', 'L', 'XL', 'XXL'], cl.t),
            cl.grp;
END;
$$;

-- =====================================================================
-- 5. สิทธิ์ (ทวนตามแบบเดิม — CREATE OR REPLACE คงสิทธิ์เดิมอยู่แล้ว)
-- =====================================================================
REVOKE ALL ON FUNCTION public.tier_rules_check_set(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_tier_rule_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_tier_rule_set(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.preview_tier_rule_change(date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_tier_rule_change(date, jsonb) TO authenticated;
