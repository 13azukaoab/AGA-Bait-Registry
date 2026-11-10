import { ScreenStub } from "@/components/ScreenStub";

// SPEC §8 จอ 14 — รอเก็บสถานี (หมดสัญญา) · เห็นเฉพาะภายใน ไม่ส่ง Dashboard
export default function CollectionPage() {
  return (
    <ScreenStub
      no={14}
      title="รอเก็บสถานี (หมดสัญญา)"
      note="ลูกค้าหมดสัญญา รอเก็บสถานี IG/IC คืน: ต้องเก็บ/เก็บแล้ว/คงเหลือ · ปิดสัญญาเมื่อเก็บครบ (SPEC §7.8)"
    />
  );
}
