-- หน้าเปิดงาน: บันทึกลูกค้า + สัญญา + ทีม เป็นก้อนเดียว และกันลูกค้าซ้ำ
-- เจ้าของอนุมัติแบบ 12 พ.ย. 2026 ("เอาตามที่แนะนำ" — กันซ้ำแบบเตือน + ต้องยืนยัน · รองรับแก้แถว)
--
-- Logic summary:
--   * ปัญหาเดิม (components/customers-new/save.ts): insert ลูกค้า → สัญญา → ทีม ทีละคำสั่งจากฝั่ง
--     browser แล้ว rollback เอง ถ้าล้มกลางทาง/rollback ล้ม จะเหลือลูกค้าเปล่า (PII) หรือสัญญาไม่มีทีม
--     · หาลูกค้าเดิมด้วยชื่อตรงตัว → เว้นวรรคต่างกัน / กดพร้อมกัน 2 เครื่อง = ลูกค้าซ้ำ
--     (Dashboard นับลูกค้าเกิน — SPEC §14 ข้อ 4) และชื่อตรงกันแต่คนละคนถูกรวมกันเงียบๆ
--   * `customers.name_key` = ชื่อ "จัดรูป" (คอลัมน์ generated คำนวณเอง ผู้ใช้กรอกไม่ได้):
--       ลบอักขระมองไม่เห็น (U+200B/C/D, U+2060, U+FEFF) · ช่องว่างทุกชนิดรวม NBSP เหลือช่องเดียว ·
--       ตัดหัวท้าย · อังกฤษเป็นพิมพ์เล็ก · **ไม่ตัดคำนำหน้า** (คุณ / บริษัท / บจก.) เพราะตัดผิด = รวมคนละคน
--     `name` ยังเก็บตามที่พิมพ์ (หน้าจอแสดงชื่อเดิม)
--   * `save_job_opening(...)` — 1 การเรียก = 1 transaction ล้มตรงไหนย้อนทั้งหมด
--       - **SECURITY INVOKER**: ทุกคำสั่งข้างในวิ่งผ่าน RLS ของผู้เรียก (admin ได้เฉพาะสาขาในขอบเขต ·
--         recorder ทำไม่ได้) ไม่ใช้ service role
--       - p_contract_id NULL = เปิดงานใหม่ · มีค่า = แก้สัญญาเดิม (แก้ได้แค่สัญญา + ทีม + เปลี่ยนไปใช้
--         ลูกค้ารายอื่นในสาขาเดียวกัน · **ไม่แก้ชื่อลูกค้า** เพราะลูกค้า 1 คนมีหลายสัญญา)
--       - ลูกค้า: p_customer_id (เลือกรายเดิม / Renew) → ต้องอยู่สาขาเดียวกัน (AG002) ·
--         ไม่เลือก → ล็อก (สาขา + name_key) ด้วย pg_advisory_xact_lock ก่อนค้น → กันกดพร้อมกันได้
--         ลูกค้าซ้ำ (คนที่ 2 รอคนแรก commit แล้วจะเห็นลูกค้าที่เพิ่งสร้าง) · เจอชื่อตรงในสาขาและ
--         ไม่ได้ยืนยันว่า "คนละราย" → AG001 พร้อมรายชื่อที่ตรง (DETAIL เป็น JSON) ไม่บันทึกอะไรเลย
--       - ใช้ลูกค้าเดิม: ประเภทลูกค้าไม่ถูกเขียนทับ · คืน existing_customer_type ให้หน้าจอเตือนเอง
--       - ทีม (แก้แถว): ลบเฉพาะทีมที่หายไป + เพิ่มทีมใหม่ (audit อ่านง่ายกว่าลบหมดแล้วใส่ใหม่)
--       - RLS ที่ปฏิเสธ UPDATE/DELETE จะ "ไม่ error แค่ 0 แถว" → ตรวจ FOUND แล้วแปลงเป็น 42501 เอง
--       - Renew = ลูกค้าคนเดิม: trigger contracts_renewal_same_customer (M9) ตรวจเหมือนเดิม (P0001)
--   * `delete_job_opening(p_contract_id)` — ก้อนเดียวเหมือนกัน (INVOKER):
--       สัญญาปิด/ยกเลิก → AG005 · มีผลบริการ (visits) หรือผลตรวจสถานี → AG003 ·
--       ไม่พบ/มองไม่เห็น → AG004 · ลบสัญญา (ทีม/ไฟล์/สถานีตาม CASCADE · ไฟล์ใน Storage ลงคิว
--       ลบด้วย trigger ของ 20261112110100) → ลบลูกค้าที่ไม่เหลือสัญญา
--   * error code ที่หน้าจอต้องแปล (describeDbError):
--       AG001 ชื่อซ้ำในสาขา ต้องเลือก "ใช้รายเดิม" หรือ "เป็นคนละราย" (p_confirm_new_customer)
--       AG002 ลูกค้าที่เลือกไม่อยู่สาขานี้ / ไม่พบ
--       AG003 ลบไม่ได้ มีผลบริการแล้ว (ให้ใช้สถานะยกเลิก)
--       AG004 ไม่พบสัญญา (ถูกลบไปแล้ว หรือไม่มีสิทธิ์)
--       AG005 ลบไม่ได้ สัญญาปิด/ยกเลิกแล้ว
--       เดิม: 42501 ไม่มีสิทธิ์/นอกขอบเขต · 23505 เลขสัญญาซ้ำ · 23503 ทีม/ลูกค้าอ้างอิงไม่มีอยู่ ·
--             23514 ข้อมูลไม่ผ่านเงื่อนไข · P0001 Renew ผูกคนละลูกค้า
--   * audit: trigger audit เดิมของ customers / contracts / contract_teams ทำงานทุกคำสั่งข้างใน
--   * สิทธิ์: authenticated เรียกได้ · anon ไม่ได้ (REVOKE ตรงตัว — Supabase ให้ EXECUTE กับ anon
--     อัตโนมัติผ่าน default privileges · ดู 20261110120000)

-- =====================================================================
-- 1. ชื่อจัดรูป
-- =====================================================================
CREATE FUNCTION public.customer_name_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT lower(btrim(regexp_replace(
           translate(coalesce(p_name, ''), E'​‌‍⁠﻿', ''),
           E'[[:space:]   ]+', ' ', 'g')));
$$;

ALTER TABLE public.customers
  ADD COLUMN name_key text GENERATED ALWAYS AS (public.customer_name_key(name)) STORED;

CREATE INDEX customers_branch_name_key_idx ON public.customers (branch_id, name_key);

-- =====================================================================
-- 2. บันทึก (สร้าง / แก้)
-- =====================================================================
CREATE FUNCTION public.save_job_opening(
  p_branch_id                uuid,
  p_customer_name            text,
  p_customer_type            text,
  p_contract_no              text,
  p_start_date               date,
  p_end_date                 date,
  p_term_years               integer,
  p_value_total              numeric,
  p_sale_type                public.sale_type,
  p_team_ids                 uuid[]  DEFAULT '{}',
  p_contract_id              uuid    DEFAULT NULL,
  p_customer_id              uuid    DEFAULT NULL,
  p_confirm_new_customer     boolean DEFAULT false,
  p_sale_name                text    DEFAULT NULL,
  p_am_name                  text    DEFAULT NULL,
  p_is_urgent                boolean DEFAULT false,
  p_renewed_from_contract_id uuid    DEFAULT NULL,
  p_mail_received_date       date    DEFAULT NULL,
  p_first_service_date       date    DEFAULT NULL,
  p_first_service_time       time    DEFAULT NULL,
  p_note                     text    DEFAULT NULL
)
RETURNS TABLE (
  contract_id            uuid,
  customer_id            uuid,
  reused_customer        boolean,
  existing_customer_type text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_customer_id   uuid;
  v_customer_type text;
  v_old_customer  uuid;
  v_reused        boolean := false;
  v_contract_id   uuid;
  v_key           text;
  v_matches       jsonb;
  v_team_ids      uuid[] := ARRAY(SELECT DISTINCT t FROM unnest(coalesce(p_team_ids, '{}')) t
                                   WHERE t IS NOT NULL);
BEGIN
  -- ---------- โหมดแก้: สัญญาต้องมีอยู่และมองเห็น ----------
  IF p_contract_id IS NOT NULL THEN
    SELECT c.customer_id INTO v_old_customer FROM contracts c WHERE c.id = p_contract_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
    END IF;
  END IF;

  -- ---------- ลูกค้า ----------
  IF p_customer_id IS NOT NULL OR p_contract_id IS NOT NULL THEN
    -- เลือกรายเดิม (หรือคงรายเดิมของสัญญาที่แก้)
    v_customer_id := coalesce(p_customer_id, v_old_customer);
    SELECT cu.customer_type INTO v_customer_type
      FROM customers cu WHERE cu.id = v_customer_id AND cu.branch_id = p_branch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'customer is not in this branch' USING ERRCODE = 'AG002';
    END IF;
    v_reused := true;
  ELSE
    v_key := customer_name_key(p_customer_name);
    IF v_key = '' THEN
      RAISE EXCEPTION 'customer name is required' USING ERRCODE = '23514';
    END IF;

    -- กันกดพร้อมกัน: ชื่อ+สาขาเดียวกันเข้าทีละรายการ (ปลดเองเมื่อจบ transaction)
    PERFORM pg_advisory_xact_lock(
      hashtextextended('public.customers:' || p_branch_id::text || ':' || v_key, 0));

    IF NOT p_confirm_new_customer THEN
      SELECT jsonb_agg(jsonb_build_object(
               'customer_id', cu.id,
               'name', cu.name,
               'customer_type', cu.customer_type,
               'latest_contract_no', (SELECT c.contract_no FROM contracts c
                                       WHERE c.customer_id = cu.id
                                       ORDER BY c.start_date DESC LIMIT 1))
             ORDER BY cu.created_at)
        INTO v_matches
        FROM customers cu
       WHERE cu.branch_id = p_branch_id AND cu.name_key = v_key;
      IF v_matches IS NOT NULL THEN
        RAISE EXCEPTION 'a customer with this name already exists in this branch'
          USING ERRCODE = 'AG001', DETAIL = v_matches::text;
      END IF;
    END IF;

    INSERT INTO customers (branch_id, name, customer_type)
    VALUES (p_branch_id, btrim(p_customer_name), nullif(btrim(p_customer_type), ''))
    RETURNING id INTO v_customer_id;
  END IF;

  -- ---------- สัญญา ----------
  IF p_contract_id IS NULL THEN
    INSERT INTO contracts (
      customer_id, contract_no, start_date, end_date, term_years, value_total, sale_type,
      sale_name, am_name, is_urgent, renewed_from_contract_id, mail_received_date,
      first_service_date, first_service_time, note)
    VALUES (
      v_customer_id, p_contract_no, p_start_date, p_end_date, p_term_years, p_value_total,
      p_sale_type, nullif(btrim(p_sale_name), ''), nullif(btrim(p_am_name), ''),
      coalesce(p_is_urgent, false), p_renewed_from_contract_id, p_mail_received_date,
      p_first_service_date, p_first_service_time, nullif(btrim(p_note), ''))
    RETURNING id INTO v_contract_id;
  ELSE
    UPDATE contracts c SET
      customer_id              = v_customer_id,
      contract_no              = p_contract_no,
      start_date               = p_start_date,
      end_date                 = p_end_date,
      term_years               = p_term_years,
      value_total              = p_value_total,
      sale_type                = p_sale_type,
      sale_name                = nullif(btrim(p_sale_name), ''),
      am_name                  = nullif(btrim(p_am_name), ''),
      is_urgent                = coalesce(p_is_urgent, false),
      renewed_from_contract_id = p_renewed_from_contract_id,
      mail_received_date       = p_mail_received_date,
      first_service_date       = p_first_service_date,
      first_service_time       = p_first_service_time,
      note                     = nullif(btrim(p_note), '')
    WHERE c.id = p_contract_id
    RETURNING c.id INTO v_contract_id;
    -- RLS ไม่ให้แก้ = 0 แถวแบบไม่ error → แปลงเป็น "ไม่มีสิทธิ์"
    IF v_contract_id IS NULL THEN
      RAISE EXCEPTION 'not allowed to update this contract' USING ERRCODE = '42501';
    END IF;

    -- ทีมที่ไม่อยู่ในรายการใหม่ → ลบ
    DELETE FROM contract_teams ct
     WHERE ct.contract_id = v_contract_id AND NOT (ct.team_id = ANY (v_team_ids));
  END IF;

  -- ---------- ทีม (เพิ่มเฉพาะที่ยังไม่มี) ----------
  INSERT INTO contract_teams (contract_id, team_id)
  SELECT v_contract_id, t FROM unnest(v_team_ids) t
  ON CONFLICT DO NOTHING;

  -- ---------- เปลี่ยนไปใช้ลูกค้ารายอื่น: ลูกค้าเดิมที่ไม่เหลือสัญญาลบทิ้ง (ไม่ปล่อย PII ค้าง) ----------
  IF v_old_customer IS NOT NULL AND v_old_customer <> v_customer_id
     AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.customer_id = v_old_customer) THEN
    DELETE FROM customers cu WHERE cu.id = v_old_customer;
  END IF;

  RETURN QUERY SELECT v_contract_id, v_customer_id, v_reused,
                      CASE WHEN v_reused THEN v_customer_type END;
END;
$$;

-- =====================================================================
-- 3. ลบ
-- =====================================================================
CREATE FUNCTION public.delete_job_opening(p_contract_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_status      public.contract_status;
  v_deleted     uuid;
BEGIN
  SELECT c.customer_id, c.status INTO v_customer_id, v_status
    FROM contracts c WHERE c.id = p_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found' USING ERRCODE = 'AG004';
  END IF;

  IF v_status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'a closed or cancelled contract cannot be deleted' USING ERRCODE = 'AG005';
  END IF;

  IF EXISTS (SELECT 1 FROM visits v WHERE v.contract_id = p_contract_id)
     OR EXISTS (SELECT 1 FROM station_checks sc JOIN stations s ON s.id = sc.station_id
                 WHERE s.contract_id = p_contract_id) THEN
    RAISE EXCEPTION 'a contract with service results cannot be deleted' USING ERRCODE = 'AG003';
  END IF;

  DELETE FROM contracts c WHERE c.id = p_contract_id RETURNING c.id INTO v_deleted;
  IF v_deleted IS NULL THEN
    RAISE EXCEPTION 'not allowed to delete this contract' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM contracts c WHERE c.customer_id = v_customer_id) THEN
    DELETE FROM customers cu WHERE cu.id = v_customer_id;
  END IF;
END;
$$;

-- =====================================================================
-- 4. สิทธิ์ (ไฟล์นี้ไม่มีตารางใหม่ · function ใหม่ทุกตัวต้องกำหนดเองที่นี่)
-- =====================================================================
REVOKE ALL ON FUNCTION public.customer_name_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_name_key(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.customer_name_key(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, integer, numeric, public.sale_type, uuid[], uuid, uuid,
  boolean, text, text, boolean, uuid, date, date, time, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, integer, numeric, public.sale_type, uuid[], uuid, uuid,
  boolean, text, text, boolean, uuid, date, date, time, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_job_opening(
  uuid, text, text, text, date, date, integer, numeric, public.sale_type, uuid[], uuid, uuid,
  boolean, text, text, boolean, uuid, date, date, time, text) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_job_opening(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_job_opening(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_job_opening(uuid) TO authenticated;
