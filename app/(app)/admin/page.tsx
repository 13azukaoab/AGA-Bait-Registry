import { ScreenStub } from "@/components/ScreenStub";

// SPEC §8 จอ 8/10/11/12 — งานฝั่ง Host: ปิดเดือน · Dashboard Sync · จัดการผู้ใช้ · ตั้งค่า
export default function AdminPage() {
  return (
    <ScreenStub
      no={8}
      title="ผู้ดูแลระบบ (Host)"
      note="ปิดเดือน (จอ 8) · Dashboard Sync + Export สำรอง (จอ 10) · จัดการผู้ใช้ (จอ 11) · ตั้งค่าเกณฑ์ Tier/ประเภท/ทีม (จอ 12)"
    />
  );
}
