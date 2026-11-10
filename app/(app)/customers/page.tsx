import { ScreenStub } from "@/components/ScreenStub";

// SPEC §8 จอ 3–4 — ทะเบียนลูกค้า/สัญญา (ตารางแบบ Excel) + รายละเอียดลูกค้า
export default function CustomersPage() {
  return (
    <ScreenStub
      no={3}
      title="ทะเบียนลูกค้า / สัญญา"
      note="ตารางแบบ Excel (พิมพ์ในช่อง, Tab/Enter, sort, filter, copy-paste) + รายละเอียดลูกค้า/สัญญา/สถานี"
    />
  );
}
