-- GRANT ให้ role ของ API (anon / authenticated / service_role) — SPEC §5, PDPA
--
-- ทำไมต้องมีไฟล์นี้ (root cause ที่เจอตอนส่ง migration ขึ้น cloud 10 พ.ย. 2026):
--   * บน Supabase ตารางที่สร้างผ่าน SQL Editor จะได้สิทธิ์อัตโนมัติจาก
--     ALTER DEFAULT PRIVILEGES ของ role postgres/supabase_admin
--   * แต่ `supabase db push` รันด้วย login role ชั่วคราว ตารางที่สร้างจึงไม่เข้าเงื่อนไข
--     default privileges นั้น → ไม่มีสิทธิ์ติดมาเลย
--   * ผลคือ PostgREST ตอบ "permission denied for table ..." (SQLSTATE 42501) ทุกตาราง
--     ทั้ง anon, authenticated และ service_role และ RLS ที่เขียนไว้ไม่ได้ถูกใช้งานเลย
--     เพราะถูกด่าน GRANT ปัดตกก่อน
--
-- หลักการของไฟล์นี้:
--   * GRANT = เปิดประตูให้ PostgREST เห็นตาราง · RLS = ด่านจริงที่คุมว่าใครเห็น/แก้แถวไหน
--     (policy ทั้ง 48 ข้อใน 20261104100318_rls_policies.sql และไฟล์ 10 พ.ย. ยังทำงานเหมือนเดิม)
--   * anon (= viewer, ไม่ล็อกอิน) ได้สิทธิ์เฉพาะข้อมูลสรุปที่ไม่มีข้อมูลส่วนบุคคล
--     (`monthly_branch_snapshots` + `v_branch_summary`) ตาม CLAUDE.md ข้อ 2 (PDPA)
--   * `audit_log` เขียนด้วย trigger ที่เป็น SECURITY DEFINER (เขียนในนามเจ้าของตาราง)
--     ผู้ใช้จึงไม่ต้องมีสิทธิ์เขียนเอง — ให้ SELECT อย่างเดียว เพื่อกันการแก้/ลบประวัติ
--     (CLAUDE.md ข้อ 7: ทุกการแก้ต้องลง audit_log)
--
-- หมายเหตุสำหรับ migration ใหม่ในอนาคต:
--   ตารางใหม่ทุกตาราง **ต้องใส่ GRANT ของตัวเองมาในไฟล์ migration นั้น** เพราะ
--   ALTER DEFAULT PRIVILEGES ผูกกับ role ที่สร้าง object และ login role ของ CLI
--   เปลี่ยนไปทุกครั้งที่ push จึงพึ่งค่า default ไม่ได้

-- =====================================================================
-- 1. สิทธิ์เข้าถึง schema
-- =====================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- =====================================================================
-- 2. ตารางอ้างอิง + ตารางงาน + ตารางระบบ
--    ให้ authenticated และ service_role ครบ 4 action แล้วให้ RLS เป็นตัวคุมจริง
--    (เช่น ตารางอ้างอิง: policy ยอมให้ host เท่านั้นที่เขียนได้)
-- =====================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.zones,
  public.branches,
  public.teams,
  public.customer_types,
  public.tier_rules,
  public.positions,
  public.profiles,
  public.customers,
  public.contracts,
  public.contract_teams,
  public.stations,
  public.visits,
  public.station_checks,
  public.month_closures,
  public.monthly_branch_snapshots
TO authenticated, service_role;

-- =====================================================================
-- 3. audit_log — อ่านอย่างเดียวสำหรับผู้ใช้ (RLS จำกัดให้เฉพาะ host อ่านได้)
--    trigger ที่เขียน log เป็น SECURITY DEFINER จึงไม่ต้องให้สิทธิ์ INSERT กับผู้ใช้
--    service_role ได้ INSERT ไว้สำหรับงานเบื้องหลัง (cron/sync) ที่ต้องบันทึกเอง
-- =====================================================================
GRANT SELECT         ON public.audit_log TO authenticated;
GRANT SELECT, INSERT ON public.audit_log TO service_role;

-- =====================================================================
-- 4. anon (viewer ไม่ล็อกอิน) — เฉพาะข้อมูลสรุปที่ไม่มีข้อมูลส่วนบุคคล
--    policy `snapshots_select_public` เปิดให้ anon อ่าน monthly_branch_snapshots อยู่แล้ว
--    ส่วน v_branch_summary ถูก GRANT ไว้ตั้งแต่ 20261104100327_summary_view.sql
-- =====================================================================
GRANT SELECT ON public.monthly_branch_snapshots TO anon;
GRANT SELECT ON public.v_branch_summary         TO service_role;

-- =====================================================================
-- 5. กันพลาด: ยืนยันว่า anon ไม่มีสิทธิ์ใดๆ กับตารางที่มีข้อมูลส่วนบุคคล/ตารางระบบ
--    (idempotent — ถ้าไม่เคยมีสิทธิ์อยู่แล้วคำสั่งนี้ก็ไม่ทำอะไร)
-- =====================================================================
REVOKE ALL ON
  public.customers,
  public.contracts,
  public.contract_teams,
  public.stations,
  public.visits,
  public.station_checks,
  public.profiles,
  public.audit_log,
  public.month_closures
FROM anon;
