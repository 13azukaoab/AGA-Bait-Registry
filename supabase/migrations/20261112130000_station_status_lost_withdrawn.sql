-- ก้อน ② (ส่วนแรก) สถานะสถานีใหม่ 2 ค่า — เจ้าของเลือก ง1 (12 พ.ย. 2026)
-- แบบเต็ม: docs/plans/2026-11-12-service-entry-schema.md
--
-- Logic summary:
--   * `lost`      = สถานีหาย (งานซ่อม "สถานีหาย") — หักจากจำนวนที่ใช้งาน ไม่ลบแถว
--   * `withdrawn` = ถอนสถานีออกกลางสัญญา (งานซ่อม "ถอนสถานีออก") — หักจากจำนวนที่ใช้งาน ไม่ลบแถว
--   * แยกจาก `removed` (ถอดกล่อง AG = จบปัญหา §7.5) และ `collected_at` (เก็บคืนตอนหมดสัญญา §7.8)
--     เพื่อไม่ให้ตัวเลขกล่อง AG และรายการรอเก็บสถานีเพี้ยน
--   * แยกไฟล์เพราะ `ALTER TYPE … ADD VALUE` ใช้ค่าใหม่ใน transaction เดียวกันไม่ได้ —
--     ไฟล์ถัดไป (20261112130100) จึงอ้างค่าเหล่านี้ได้
--   * คำถามค้าง X2 (ความหมายของ `eliminated` / `pending_removal`) ยังตัดสินแยกได้ ไม่กระทบไฟล์นี้

ALTER TYPE public.station_status ADD VALUE IF NOT EXISTS 'lost';
ALTER TYPE public.station_status ADD VALUE IF NOT EXISTS 'withdrawn';
