import { ScreenStub } from "@/components/ScreenStub";

// SPEC §8 จอ 7 — นำเข้าสัญญาจาก Excel (วาง/อัปโหลด → ตรวจ → ยืนยัน)
export default function ImportPage() {
  return (
    <ScreenStub
      no={7}
      title="นำเข้าสัญญาจาก Excel"
      note="อัปโหลด/วางข้อมูล → แสดงตัวอย่าง + รายการแถวที่ผิด → ยืนยันจึงบันทึก (อ้างกฎล้างข้อมูลใน mockup)"
    />
  );
}
