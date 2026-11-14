-- M17: admin เปลี่ยนสถานีเป็น/จาก หาย (lost) / ถอนออก (withdrawn) ตรงไม่ได้ — ต้องผ่านงานซ่อมเท่านั้น
--      (เจ้าของอนุมัติ 14 พ.ย. 2026 — DECISIONS 2.30 ตัวเลือก ก: กันเหมือนหัวหน้างาน)
--
-- Logic summary:
--   ต่อยอด trigger `stations_finished_status_guard` ของ M16 (20261112190000) — ชื่อเดิม เปลี่ยนเฉพาะเนื้อฟังก์ชัน
--   ข้อ 2 (หาย/ถอนออก) เดิมกันเฉพาะ recorder → เพิ่ม 'admin' (บรรทัดเดียวใน v_role IN (...))
--     - admin เปลี่ยน "เข้า" lost / withdrawn ตรง (REST) ไม่ได้ → 42501
--     - admin เปลี่ยน status / removed_at ของสถานีที่เป็น lost / withdrawn ตรงไม่ได้ → 42501
--     - ทางที่ถูก: งานซ่อมใน save_service_visit (service_work_apply, SECURITY DEFINER) และย้อนผ่าน
--       save_service_visit / delete_service_visit (service_work_undo)
--       หมายเหตุ: RPC ทั้งสองปฏิเสธ admin อยู่แล้ว (เฉพาะ host/recorder) → สำหรับ admin คือ "กันหมด" (เหมือนข้อ 2.28)
--     - host แก้ตรงได้ตามเดิม (current_app_role = host ไม่เข้าเงื่อนไข) · ฟังก์ชันระบบ SECURITY DEFINER ไม่ติดด่าน
--   ยังแก้ได้ตามเดิม: point_label · collected_at · active ↔ pending_removal · code / station_no / installed_at ของ admin
--   * ไม่แตะ save_service_visit / delete_service_visit → advisory lock / F / ด่าน aga.service_visit /
--     REVOKE anon / audit_log / signature RPC / SV010 คงเดิม · ไม่ทำข้อเล็ก 5 ข้อจาก M16 (เจ้าของสั่ง "ไว้ก่อน")
--   * เทส: supabase/tests/32_admin_lost_withdrawn_rpc_only.test.sql (+ ปรับข้อ 4 ใน 31_...)

CREATE OR REPLACE FUNCTION public.stations_finished_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role public.user_role;
BEGIN
  -- ฟังก์ชันระบบแบบ SECURITY DEFINER (current_user = เจ้าของตาราง) / service_role / postgres ผ่าน
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  v_role := public.current_app_role();

  -- ---------- 0. เพิ่มสถานีใหม่ (INSERT) ----------
  -- admin เพิ่มสถานีที่ "ถอด/กำจัดแล้ว" หรือมี removed_at ตั้งแต่เกิดไม่ได้ (ทางเลี่ยงข้อ 1 · ตรวจ security M16)
  -- recorder ถูกบังคับให้เริ่ม active อยู่แล้ว (stations_recorder_guard)
  IF TG_OP = 'INSERT' THEN
    IF v_role = 'admin' AND (NEW.status IN ('removed', 'eliminated') OR NEW.removed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'a new station cannot start removed or eliminated' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- ---------- 0b. removed_at (วันถอด) ระบบตั้งเองเท่านั้น: recorder + admin ----------
  -- กันตั้ง removed_at ล่วงหน้าตอนกล่องยังใช้งานอยู่ แล้วค่อยถอดผ่าน RPC (ขั้นท้าย save_service_visit ใช้
  -- coalesce(removed_at, now()) → วันถอดย้อนหลังปลอมได้ และ M14 จำค่านั้นเป็น removed_at_set)
  -- เปลี่ยนได้เฉพาะขั้นท้ายของ save_service_visit (ด่าน aga.service_visit เปิด · admin เปิดไม่ได้)
  IF v_role IN ('recorder', 'admin')
     AND NEW.removed_at IS DISTINCT FROM OLD.removed_at
     AND coalesce(current_setting('aga.service_visit', true), '') = '' THEN
    RAISE EXCEPTION 'removed_at is set by the system through save_service_visit' USING ERRCODE = '42501';
  END IF;

  -- ---------- 1. ถอดแล้ว / กำจัดแล้ว: recorder (M15) + admin (M16, 2.28) ----------
  IF v_role IN ('recorder', 'admin') THEN
    IF OLD.status IN ('removed', 'eliminated')
       AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.removed_at IS DISTINCT FROM OLD.removed_at) THEN
      RAISE EXCEPTION 'the status of a removed or eliminated station is changed through save_service_visit / delete_service_visit'
        USING ERRCODE = '42501';
    END IF;
    -- เปลี่ยน "เข้า" ถอด/กำจัด ตรงๆ ไม่ได้ — ยกเว้นขั้นท้ายของ save_service_visit (ด่าน aga.service_visit เปิด ·
    -- admin เปิดด่านนี้ไม่ได้)
    IF NEW.status IN ('removed', 'eliminated') AND NEW.status IS DISTINCT FROM OLD.status
       AND coalesce(current_setting('aga.service_visit', true), '') = '' THEN
      RAISE EXCEPTION 'stations are removed through save_service_visit' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ---------- 2. หาย / ถอนออก: recorder (M16, 2.29) + admin (M17, 2.30) — ผ่านงานซ่อมเท่านั้น ----------
  IF v_role IN ('recorder', 'admin') THEN
    IF OLD.status IN ('lost', 'withdrawn')
       AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.removed_at IS DISTINCT FROM OLD.removed_at) THEN
      RAISE EXCEPTION 'the status of a lost or withdrawn station is changed through the repair works of save_service_visit'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status IN ('lost', 'withdrawn') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'stations are marked lost or withdrawn through the repair works of save_service_visit'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- trigger เดิมชี้ฟังก์ชันชื่อเดิมอยู่แล้ว (CREATE OR REPLACE ไม่เปลี่ยน) · ย้ำสิทธิ์กันพลาด
REVOKE ALL ON FUNCTION public.stations_finished_status_guard() FROM PUBLIC, anon, authenticated;
