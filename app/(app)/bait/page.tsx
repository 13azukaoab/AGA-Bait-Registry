import { ScreenStub } from "@/components/ScreenStub";

// SPEC §8 จอ 6 — กล่องเหยื่อ (AG): S ติดตั้ง → ติดตาม F แยกจุด → รอถอด/ถอด
export default function BaitPage() {
  return (
    <ScreenStub
      no={6}
      title="กล่องเหยื่อ (AG)"
      note="S ติดตั้ง (+เพิ่มจุด) · ติดตาม F แยกจุด (เหยื่อ step 50 + สัดส่วนปลวก + สถานะ) · รอถอด/ถอด · สรุปการใช้เหยื่อ"
    />
  );
}
