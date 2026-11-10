import { ScreenStub } from "@/components/ScreenStub";

// SPEC §8 จอ 2 — หน้า "ต้องทำ" (หน้าแรกหลัง login) + แดชบอร์ดสถานะงาน
export default function TodoPage() {
  return (
    <ScreenStub
      no={2}
      title='หน้า "ต้องทำ"'
      note="ลูกค้าที่ยังไม่กรอกรอบเดือนนี้ · สัญญาใกล้หมดใน 90 วัน · กล่องเหยื่อรอถอด + แดชบอร์ดสถานะงาน"
    />
  );
}
