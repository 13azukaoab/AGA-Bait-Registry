-- M2: admin ลบ ลูกค้า / สัญญา / สถานี ได้ในขอบเขตหน่วยงาน (SPEC §5, §14 ข้อ 16 · DECISIONS 1.5, X4 = แบบ ก)
--
-- Logic summary:
--   * เจ้าของเลือกแบบ ก (11 พ.ย. 2026): **ลบได้เฉพาะเมื่อยังไม่มีผลบริการ**
--     ห้ามลบผลบริการตามแบบ cascade เด็ดขาด — สัญญาที่ใช้งานแล้วให้ใช้สถานะ `cancelled`
--   * ไฟล์นี้เพิ่มแค่ policy DELETE ให้ admin — ส่วน "ห้ามลบเมื่อมีข้อมูลลูก" บังคับด้วย
--     foreign key แบบ RESTRICT ที่มีอยู่แล้ว (ไม่แก้ FK เดิม) ซึ่งทำงานทุก role รวม host:
--       customers ← contracts.customer_id      RESTRICT → ลูกค้าลบได้เมื่อไม่มีสัญญาเหลือ
--       contracts ← visits.contract_id         RESTRICT → สัญญาที่มีการเข้าบริการลบไม่ได้
--       contracts ← stations.contract_id       RESTRICT → ต้องลบสถานีออกก่อน
--       stations  ← station_checks.station_id  RESTRICT → สถานีที่มีผลตรวจลบไม่ได้
--     ลบไม่ได้ = ฐานข้อมูลตอบ SQLSTATE 23503 (foreign_key_violation) แอปแปลงเป็นข้อความไทย
--   * ลำดับลบสัญญาเปล่าที่มีสถานี: ลบ stations ของสัญญานั้นก่อน แล้วจึงลบ contract
--     (ทำในคำขอเดียวกันฝั่งแอปได้) · contract_teams และ contract_files ลบตามเองด้วย CASCADE
--     (ไม่ใช่ผลบริการ)
--   * ทุกการลบลง audit_log ด้วย trigger เดิม (audit_customers / contracts / stations)
--   * ขอบเขตหน่วยงาน: ใช้ helper เดิม branch_in_scope / contract_in_scope
--     (SECURITY DEFINER) แบบเดียวกับ policy INSERT / UPDATE ของ admin
--   * ไม่มีตาราง / function ใหม่ → ไม่ต้อง GRANT เพิ่ม (authenticated มี DELETE อยู่แล้ว
--     จาก 20261110100000 · RLS เป็นตัวคุม)

CREATE POLICY customers_admin_delete ON public.customers FOR DELETE TO authenticated
  USING (public.current_app_role() = 'admin' AND public.branch_in_scope(branch_id));

CREATE POLICY contracts_admin_delete ON public.contracts FOR DELETE TO authenticated
  USING (public.current_app_role() = 'admin' AND public.contract_in_scope(id));

CREATE POLICY stations_admin_delete ON public.stations FOR DELETE TO authenticated
  USING (public.current_app_role() = 'admin' AND public.contract_in_scope(contract_id));
