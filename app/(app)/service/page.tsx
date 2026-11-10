import { ScreenStub } from "@/components/ScreenStub";

// SPEC §8 จอ 5 — กรอกผลบริการรายเดือน (IG/IC) แบบ exception
export default function ServicePage() {
  return (
    <ScreenStub
      no={5}
      title="กรอกผลบริการรายเดือน (IG/IC)"
      note="เลือกสาขา + เดือน → ตารางลูกค้า · กรอกแบบ exception (เฉพาะจุดที่พบปลวก) · สรุปสถานีในพื้นที่"
    />
  );
}
