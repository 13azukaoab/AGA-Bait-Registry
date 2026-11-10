-- ถอนสิทธิ์ EXECUTE ของ anon บน function ทุกตัวใน schema public (SPEC §5, PDPA)
--
-- Logic summary:
--   * anon (viewer ไม่ล็อกอิน) ใช้แค่ monthly_branch_snapshots (policy USING (true)) กับ
--     view v_branch_summary (รันด้วยสิทธิ์เจ้าของ view) — ไม่ต้องเรียก function ใดเลย
--   * แต่ function ช่วยตรวจสิทธิ์ (current_app_role, current_division_scope, is_host,
--     *_in_scope, contract_files_writable ฯลฯ) เดิม anon เรียกผ่าน RPC ได้ ทำให้ลองถาม
--     "สัญญา id นี้อยู่ในขอบเขตไหม" เพื่อเดาว่ามี id อยู่จริงได้ → ปิดทั้งหมด
--   * ต้อง REVOKE จาก anon **ตรงตัว** และจาก PUBLIC ด้วย: default privileges ของ Supabase
--     ในเครื่องให้ EXECUTE กับ anon ตรงๆ ส่วน PostgreSQL ให้ PUBLIC โดยปริยาย
--   * กันกระทบผู้ใช้ที่ล็อกอิน: ก่อน REVOKE จดว่า authenticated / service_role เรียก
--     function นั้นได้อยู่ไหม แล้ว GRANT คืนตรงตัวให้เหมือนเดิม (บางตัวเคยได้ผ่าน PUBLIC)
--   * ข้าม function ที่เป็นของ extension (pg_depend deptype 'e')
--   * trigger function ไม่ต้องใช้สิทธิ์ EXECUTE ตอนทำงาน (PostgreSQL ตรวจตอนสร้าง trigger
--     เท่านั้น) จึงปิด anon ได้โดย trigger ยังทำงานปกติ
--   * function ใหม่ในอนาคต: ต้องใส่ REVOKE ... FROM PUBLIC, anon ในไฟล์ของตัวเองเสมอ

DO $$
DECLARE
  f          record;
  v_auth_ok  boolean;
  v_svc_ok   boolean;
BEGIN
  FOR f IN
    SELECT p.oid, p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass
                          AND d.objid = p.oid
                          AND d.deptype = 'e')
  LOOP
    v_auth_ok := has_function_privilege('authenticated', f.oid, 'EXECUTE');
    v_svc_ok  := has_function_privilege('service_role',  f.oid, 'EXECUTE');

    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.sig);

    IF v_auth_ok THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
    IF v_svc_ok THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END IF;
  END LOOP;
END;
$$;
