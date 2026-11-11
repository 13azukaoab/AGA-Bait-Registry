-- ลบสัญญาเปล่าแล้วสถานีหายตามอัตโนมัติ (เจ้าของตัดสิน 11 พ.ย. 2026 · SPEC §14 ข้อ 16 · DECISIONS X4 = แบบ ก)
--
-- Logic summary:
--   * เดิม stations.contract_id เป็น ON DELETE RESTRICT → admin/host ต้องลบสถานีทีละตัวก่อน
--     จึงลบสัญญาได้ (ดูหมายเหตุใน 20261111090200 — ไฟล์นี้แทนที่พฤติกรรมนั้น)
--   * เปลี่ยนเป็น ON DELETE CASCADE: ลบสัญญา → สถานีของสัญญานั้นถูกลบตาม
--   * ผลบริการยังปลอดภัย เพราะ FK อีก 2 ตัวคง RESTRICT ไว้ (ไม่แตะ):
--       visits.contract_id         → contracts  RESTRICT
--       station_checks.station_id  → stations   RESTRICT
--     สัญญาที่มีการเข้าบริการ หรือสถานีที่มีผลตรวจ **แม้แถวเดียว** → ลบไม่ได้ทั้งก้อน
--     (ทั้งคำสั่ง rollback · SQLSTATE 23503)
--   * สถานีที่ถูกลบตามยังลง audit_log ด้วย trigger audit_stations เดิม (action = delete)
--     contract_id อยู่ในแถว audit · branch_id อาจว่างเพราะแถวสัญญาถูกลบไปก่อนแล้ว
--     (พฤติกรรมเดียวกับที่บันทึกไว้ใน 20261110090400)
--   * ไม่มีตาราง / function ใหม่ → ไม่มี GRANT/REVOKE

ALTER TABLE public.stations DROP CONSTRAINT stations_contract_id_fkey;
ALTER TABLE public.stations
  ADD CONSTRAINT stations_contract_id_fkey
  FOREIGN KEY (contract_id) REFERENCES public.contracts (id) ON DELETE CASCADE;
