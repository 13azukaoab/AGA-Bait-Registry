import { ScreenStub } from "@/components/ScreenStub";

// SPEC §8 จอ 1 — เข้าสู่ระบบ (host/admin/recorder) · viewer ไม่ต้อง login
export default function LoginPage() {
  return (
    <ScreenStub
      no={1}
      title="เข้าสู่ระบบ"
      note="host / admin / recorder เข้าด้วยบัญชีที่ Host สร้างให้ — viewer ดูหน้าสรุปแบบ public ไม่ต้อง login"
    />
  );
}
