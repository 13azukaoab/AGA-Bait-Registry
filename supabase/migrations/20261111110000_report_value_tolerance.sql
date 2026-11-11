-- M6 (จ) ส่วนเพิ่ม: เทียบมูลค่ายอดรายงานแบบยอมคลาด 0.005 บาท ให้ตรงกับฝั่งแอป
--
-- Logic summary:
--   * 20261111100100 เทียบ report_value กับผลรวมมูลค่า 8 tier ด้วย `=` เป๊ะ
--   * ฝั่งแอป `lib/dashboard/manualRow.ts` (`checkReportTotals`) ยอมคลาดเคลื่อน
--     MONEY_EPSILON = 0.005 บาท (กันเศษทศนิยม) → ถ้า DB เทียบเป๊ะ แอปผ่านแต่ DB ปฏิเสธได้
--   * กฎใหม่ (แถว source = 'manual' เท่านั้น · ไม่กรอก = ผ่าน):
--       report_value : |report_value − (v_s1 + … + v_xl3)| <= 0.005
--       report_cust  : ต้องตรงเป๊ะ (ไม่เปลี่ยน — constraint เดิมคงไว้)
--   * หมายเหตุ: คอลัมน์มูลค่าเป็น numeric(14,2) ค่าที่ส่งมาเกิน 2 ตำแหน่งจะถูกปัดตอนบันทึก
--     แล้วจึงตรวจ CHECK — ฝั่งแอปควรปัดมูลค่าเป็น 2 ตำแหน่งก่อนเทียบ/ส่ง เพื่อให้ผลตรงกัน 100%
--   * ไม่มีตาราง / function ใหม่ → ไม่มี GRANT/REVOKE

ALTER TABLE public.monthly_branch_snapshots
  DROP CONSTRAINT snapshots_manual_report_value_matches;

ALTER TABLE public.monthly_branch_snapshots
  ADD CONSTRAINT snapshots_manual_report_value_matches
    CHECK (
      source <> 'manual'
      OR report_value IS NULL
      OR abs(report_value - (v_s1 + v_s3 + v_m1 + v_m3 + v_l1 + v_l3 + v_xl1 + v_xl3)) <= 0.005
    );
