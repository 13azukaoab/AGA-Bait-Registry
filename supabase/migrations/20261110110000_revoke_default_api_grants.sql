-- ตัดสิทธิ์ส่วนเกินของ role API ให้เครื่องกับ cloud เหมือนกัน — SPEC §5, PDPA
--
-- ทำไมต้องมีไฟล์นี้ (เจอตอนรันเทส pgTAP ในเครื่อง 10 พ.ย. 2026):
--   * ฐานข้อมูล **ในเครื่อง** (`supabase db reset`) รัน migration ด้วย role postgres
--     → ALTER DEFAULT PRIVILEGES ของ Supabase ทำงาน → ตารางใหม่ได้สิทธิ์แถมให้
--       anon / authenticated / service_role ครบทุก action โดยอัตโนมัติ
--   * ฐานข้อมูล **บน cloud** (`supabase db push`) รันด้วย login role ชั่วคราว
--     → default privileges ไม่ทำงาน → ได้เฉพาะสิทธิ์ที่เขียนไว้ใน migration เท่านั้น
--   * ผลคือสิทธิ์ 2 ที่ไม่ตรงกัน เทสในเครื่องจึงทำนายของจริงบน cloud ไม่ได้
--
-- ไฟล์นี้จึง REVOKE สิทธิ์ส่วนเกินออกให้ชัดเจน (idempotent — ถ้าไม่มีสิทธิ์อยู่แล้ว
-- คำสั่งก็ไม่ทำอะไร) ผลลัพธ์สุดท้ายเท่ากันทั้งในเครื่องและบน cloud
--
-- แนวทางที่เจ้าของเลือก 10 พ.ย. 2026: **กัน 2 ชั้น** (สิทธิ์ + RLS)
--   anon ที่ไม่ล็อกอินต้องถูกปฏิเสธตั้งแต่ชั้นสิทธิ์ (SQLSTATE 42501) ไม่ใช่แค่เห็น 0 แถว
--   เผื่อวันหน้ามีใครเขียน RLS policy พลาด ข้อมูลลูกค้าก็ยังไม่รั่ว

-- =====================================================================
-- 1. anon: ตัดสิทธิ์ทุกตารางที่ไม่ใช่ข้อมูลสรุปสาธารณะ
--    (ตารางข้อมูลส่วนบุคคล/ระบบถูก REVOKE ไปแล้วใน 20261110100000
--     ไฟล์นี้เพิ่มตารางอ้างอิงซึ่งในเครื่องยังได้สิทธิ์ default ติดมา)
-- =====================================================================
REVOKE ALL ON
  public.zones,
  public.branches,
  public.teams,
  public.customer_types,
  public.tier_rules,
  public.positions,
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

-- =====================================================================
-- 2. anon: monthly_branch_snapshots อ่านได้อย่างเดียว (ข้อมูล Dashboard สาธารณะ)
-- =====================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.monthly_branch_snapshots FROM anon;
GRANT SELECT ON public.monthly_branch_snapshots TO anon;

-- =====================================================================
-- 3. authenticated: audit_log อ่านอย่างเดียว ห้ามแก้/ลบประวัติ
--    (log เขียนด้วย trigger SECURITY DEFINER อยู่แล้ว — CLAUDE.md ข้อ 7)
-- =====================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.audit_log FROM authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
