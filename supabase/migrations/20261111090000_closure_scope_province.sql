-- M4: ใช้คำ `province` คำเดียวทั้งระบบ (SPEC §14 ข้อ 17 ฉ, DECISIONS 7.8)
--
-- Logic summary:
--   * enum `closure_scope` เดิมเป็น ('central', 'provincial') แต่ `branches.division`
--     ใช้ 'province' → แอปต้องแปลงไปมาระหว่าง 2 คำ เสี่ยงพิมพ์ผิด
--   * `ALTER TYPE ... RENAME VALUE` เปลี่ยนชื่อ label ในที่เดียว แถวที่มีอยู่ใน
--     `month_closures` เปลี่ยนตามทันที (enum เก็บเป็นเลขภายใน ไม่ต้อง UPDATE แถว)
--   * policy ของ month_closures อ้างเฉพาะ 'central' จึงไม่ต้องแก้
--   * audit_log.old_data / new_data ที่บันทึกไว้ก่อนหน้า (jsonb) ยังเป็นคำเดิม
--     'provincial' — เป็นประวัติ ไม่แก้ย้อนหลัง
--   * ไม่มี function / table ใหม่ในไฟล์นี้ จึงไม่มี GRANT/REVOKE

ALTER TYPE public.closure_scope RENAME VALUE 'provincial' TO 'province';
