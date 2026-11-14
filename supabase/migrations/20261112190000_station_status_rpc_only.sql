-- M16: สถานะสถานีที่ "งานบริการ" เป็นคนตั้ง เปลี่ยนได้ผ่าน RPC เท่านั้น
--      (เจ้าของอนุมัติ 14 พ.ย. 2026 — DECISIONS 2.28, 2.29)
--
-- Logic summary:
--   ขยาย trigger `stations_finished_status_guard` (M15, 20261112180000) — ชื่อเดิม เปลี่ยนเฉพาะเนื้อฟังก์ชัน
--   ด่านทำงานเฉพาะเมื่อผู้ใช้เขียนตารางเอง (current_user = authenticated) · ฟังก์ชันระบบแบบ SECURITY DEFINER
--   (service_work_apply / service_work_undo / service_ag_removal_restore / Renew) ทำในนามเจ้าของตาราง → ไม่ติด
--
--   1. (2.24 M15 + 2.28 M16) กล่องที่ "ถอดแล้ว" (removed) / "กำจัดแล้ว" (eliminated) — **recorder และ admin**
--      - เปลี่ยน `status` / `removed_at` ของแถวเหล่านี้ตรงไม่ได้ → 42501
--      - เปลี่ยน "เข้า" removed / eliminated ตรงไม่ได้ (ข้ามการจำค่าก่อนถอด M14) — ยกเว้นขั้นท้ายของ
--        save_service_visit (ด่าน aga.service_visit เปิดอยู่)
--        · admin ไม่มีทางเปิดด่านนี้ได้: save_service_visit / delete_service_visit ปฏิเสธ admin ก่อนตั้งค่า
--          และผู้ใช้เรียก set_config ผ่าน REST ไม่ได้ → สำหรับ admin ข้อยกเว้นนี้ไม่มีผล (= กันหมด)
--      - admin ไม่มีหน้าจอเปลี่ยนสถานะสถานีอยู่แล้ว (แอปเปลี่ยนสถานะผ่าน RPC ทั้งหมด) → ปิดเฉพาะช่องข้ามหน้าจอ
--   2. (2.29 M16) สถานี "หาย" (lost) / "ถอนออก" (withdrawn) — **recorder**
--      - เปลี่ยน "เข้า" lost / withdrawn ตรงไม่ได้ → 42501
--      - เปลี่ยน `status` / `removed_at` ของแถวที่เป็น lost / withdrawn ตรงไม่ได้ → 42501
--      - ทางที่ถูก: งานซ่อม "สถานีหาย / ถอนสถานีออก" ใน save_service_visit (service_work_apply) และย้อนผ่าน
--        save_service_visit (เอางานออก) / delete_service_visit (service_work_undo) — ทั้งคู่ SECURITY DEFINER
--        จึงไม่ต้องมีข้อยกเว้นด่าน: ขั้นท้ายของ save_service_visit (SECURITY INVOKER) ไม่เคยตั้ง lost/withdrawn
--        และไม่แตะสถานีที่ไม่ใช่ active/pending_removal
--      - ผล: ทุกสถานี lost/withdrawn ที่เกิดหลังจากนี้มี `station_works.effects.prev` ตรงกับจริง
--        (ไม่มีกรณีงานถูกย้อนทับสถานะที่ผู้ใช้แก้เองทีหลัง)
--   3. ยังแก้ได้ตามเดิม: point_label · collected_at ของทุกสถานี · active ↔ pending_removal · ช่องอื่นของ admin
--      (code / station_no / installed_at ฯลฯ ตาม policy เดิม) · host แก้ตรงได้ทุกอย่าง (ออกแบบ M14)
--   4. ยังไม่ตัดสิน: admin + lost/withdrawn → ตอนนี้ **ยังเปลี่ยนตรงได้** (ส่งตัวเลือกให้หมวด 2 · ห้ามเดา)
--      ถ้าเลือก "กันเหมือน recorder" → เพิ่ม 'admin' ใน v_service_roles ของข้อ 2 (บรรทัดเดียว)
--   * ไม่แตะ save_service_visit / delete_service_visit → advisory lock / F / ด่าน aga.service_visit /
--     REVOKE anon / audit_log / signature RPC / SV010 (X9 = ก) คงเดิมทั้งหมด
--   * เทส: supabase/tests/31_station_status_rpc_only.test.sql

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

  -- ---------- 2. หาย / ถอนออก: recorder (M16, 2.29) — ผ่านงานซ่อมเท่านั้น ----------
  -- admin ยังไม่ตัดสิน (ดูหัวไฟล์ข้อ 4) → ถ้าเลือกกัน ให้เพิ่ม 'admin' ในรายการนี้
  IF v_role IN ('recorder') THEN
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

-- แทนที่ด้วย OR REPLACE คงสิทธิ์เดิม — ย้ำอีกครั้งกันพลาด (trigger function: ไม่มีใครเรียกตรงได้)
REVOKE ALL ON FUNCTION public.stations_finished_status_guard() FROM PUBLIC, anon, authenticated;
