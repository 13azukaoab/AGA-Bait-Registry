import { ScreenStub } from "@/components/ScreenStub";

// SPEC §8 จอ 13 — สรุปตัวเลข (public) · viewer ไม่ต้อง login · ไม่มีข้อมูลส่วนบุคคล (PDPA)
export default function SummaryPage() {
  return (
    <ScreenStub
      no={13}
      title="สรุปตัวเลข (หน้า public)"
      note="ตัวเลขรายสาขา/เขต ไม่มีข้อมูลรายลูกค้า — เปิดดูได้โดยไม่ล็อกอิน · อ่านได้เฉพาะ view/ตารางสรุป (RLS anon)"
    />
  );
}
