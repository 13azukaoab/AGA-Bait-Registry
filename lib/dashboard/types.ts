/**
 * แถวข้อมูล 1 สาขา ในรูปแบบ dashboard_data.json — **16 ฟิลด์เป๊ะตาม SPEC §9.1**
 * (ตัด `value_annual` ของ SnapshotRow ออก — เฟส 1 ไม่ส่งเข้า Dashboard · CLAUDE.md กฎ 4 ห้ามเปลี่ยนรูปแบบ)
 * ลำดับฟิลด์ตรงตามตัวอย่าง §9.1
 */
export interface DashboardRow {
  area: string;
  branch: string;
  s1: number;
  s3: number;
  m1: number;
  m3: number;
  l1: number;
  l3: number;
  xl1: number;
  xl3: number;
  cust: number;
  vS: number;
  vM: number;
  vL: number;
  vXL: number;
  value: number;
}

/**
 * ไฟล์ dashboard_data.json ทั้งไฟล์ — key = เดือนรูปแบบ `MMM.YY` (เช่น `SEP.26`),
 * value = แถวของทุกสาขาในเดือนนั้น (ต้องครบ 43 สาขา — SPEC §9.1)
 */
export type DashboardData = Record<string, DashboardRow[]>;

/**
 * input รายเดือน key = `YYYY-MM` (normalize ก่อนเข้าฟังก์ชันเสมอ เพื่อแปลงเป็น `MMM.YY` ด้วย monthKey)
 * แถวรับเป็น DashboardRow ได้ หรือ SnapshotRow (มี value_annual เกิน — assignable ได้, จะถูกตัดทิ้งตอนแปลง)
 */
export type MonthlyRows = Record<string, readonly DashboardRow[]>;

/**
 * แหล่งข้อมูล 3 ทางตาม SPEC §9.1 — รวมกันแบบ override ต่อ (เดือน, สาขา)
 * ลำดับ precedence (ต่ำ→สูง): legacy → computed → manual (ค่าหลังทับค่าก่อน)
 * - `legacy`  เดือนก่อน go-live นำเข้าจาก dashboard_data.json เดิม
 * - `computed` ส่วนกลาง คำนวณจากทะเบียน (§7.6)
 * - `manual`  ต่างจังหวัด กรอกมือจากหน้าจอ 9
 */
export interface DashboardSources {
  legacy?: MonthlyRows;
  computed?: MonthlyRows;
  manual?: MonthlyRows;
}
