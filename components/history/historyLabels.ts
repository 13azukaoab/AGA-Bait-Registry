/**
 * คำเรียกภาษาไทยของตาราง / ช่องข้อมูล / ค่า enum ในหน้าประวัติการแก้ไข (pure — ไม่เรียกฐานข้อมูล)
 *
 * Logic summary:
 *   * `tableName` ของ audit_log → "ประเภทข้อมูล" (DataKind) 8 กลุ่มตาม mockup · ตารางที่ไม่รู้จัก = "other" (ไม่พัง)
 *   * ชื่อช่องมาจากคอลัมน์จริงใน supabase/migrations · ช่องที่ไม่รู้จักใช้ชื่อคอลัมน์ตรงๆ (ไม่ทิ้งการเปลี่ยนแปลงเงียบๆ)
 *   * NOISE_KEYS = ช่องที่ระบบประทับเอง ไม่ใช่การแก้ของคน → ไม่แสดงใน diff
 */

export type DataKind = "service" | "contract" | "customer" | "station" | "file" | "port" | "closure" | "setting" | "other";

export const DATA_KINDS: ReadonlyArray<{ code: DataKind; label: string }> = [
  { code: "service", label: "ผลบริการ" },
  { code: "contract", label: "สัญญา" },
  { code: "customer", label: "ลูกค้า" },
  { code: "station", label: "สถานี" },
  { code: "file", label: "ไฟล์แนบ" },
  { code: "port", label: "Port ต่างจังหวัด" },
  { code: "closure", label: "ปิดเดือน" },
  { code: "setting", label: "ตั้งค่า / ผู้ใช้" },
  { code: "other", label: "อื่นๆ" },
];

const TABLE_KIND: Record<string, DataKind> = {
  visits: "service",
  visit_teams: "service",
  station_checks: "service",
  station_works: "service",
  missed_service_resolutions: "service",
  missed_service_notes: "service",
  contracts: "contract",
  contract_teams: "contract",
  customers: "customer",
  customer_phones: "customer",
  stations: "station",
  contract_files: "file",
  monthly_branch_snapshots: "port",
  month_closures: "closure",
  month_closure_overrides: "closure",
  tier_rules: "setting",
  app_settings: "setting",
  profiles: "setting",
  teams: "setting",
  customer_types: "setting",
  positions: "setting",
};

/** ตารางของการปิดเดือน — ไม่นับเป็น "แก้หลังปิด" (ตรงกับ list_post_close_edits) */
export const CLOSURE_TABLES: readonly string[] = ["month_closures", "month_closure_overrides"];

export function kindOfTable(table: string): DataKind {
  return TABLE_KIND[table] ?? "other";
}

export function kindLabel(kind: DataKind): string {
  return DATA_KINDS.find((k) => k.code === kind)?.label ?? "อื่นๆ";
}

/** ตารางที่อยู่ในกลุ่มนี้ (ใช้สร้างตัวกรอง table_name IN) */
export function tablesOfKinds(kinds: readonly string[]): string[] {
  return Object.keys(TABLE_KIND).filter((t) => kinds.includes(TABLE_KIND[t]));
}

/** ตารางทั้งหมดที่รู้จัก (ใช้กับตัวกรอง "อื่นๆ" = table_name NOT IN รายการนี้) */
export function knownTables(): string[] {
  return Object.keys(TABLE_KIND);
}

/** ชื่อเรียกของแถว เช่น "สัญญา" "สถานี" (ใช้ในประโยค "เพิ่ม/ลบ …") */
const TABLE_NOUN: Record<string, string> = {
  visits: "การเข้าบริการ",
  visit_teams: "ทีมที่เข้าบริการ",
  station_checks: "ผลตรวจสถานี",
  station_works: "งานที่สถานี",
  missed_service_resolutions: "การจัดการตกบริการ",
  missed_service_notes: "บันทึกตกบริการ",
  contracts: "สัญญา",
  contract_teams: "ทีมประจำสัญญา",
  customers: "ลูกค้า",
  customer_phones: "เบอร์ติดต่อลูกค้า",
  stations: "สถานี",
  contract_files: "ไฟล์แนบ",
  monthly_branch_snapshots: "ตัวเลข Port",
  month_closures: "การปิดเดือน",
  month_closure_overrides: "การแก้ผู้ปิดเดือน",
  tier_rules: "เกณฑ์ Tier",
  app_settings: "ค่าตั้งระบบ",
  profiles: "บัญชีผู้ใช้",
  teams: "ทีม",
  customer_types: "ประเภทลูกค้า",
  positions: "ตำแหน่ง",
};

export function tableNoun(table: string): string {
  return TABLE_NOUN[table] ?? "ข้อมูล";
}

/** ช่องที่ระบบประทับเอง — ไม่แสดงเป็นการแก้ของคน */
export const NOISE_KEYS: ReadonlySet<string> = new Set([
  "id",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
  "name_key",
]);

const FIELD_LABEL: Record<string, string> = {
  // ลูกค้า
  name: "ชื่อ",
  address: "ที่อยู่",
  phone: "เบอร์โทร",
  contact_name: "ชื่อผู้ติดต่อ",
  customer_type: "ประเภทลูกค้า",
  branch_id: "สาขา",
  contact_updated_at: "เวลาแก้ข้อมูลติดต่อ",
  contact_cross_team: "แก้โดยทีมอื่น",
  // สัญญา
  contract_no: "เลขที่สัญญา",
  customer_id: "ลูกค้า",
  start_date: "วันเริ่มสัญญา",
  end_date: "วันสิ้นสุดสัญญา",
  term_months: "อายุสัญญา (เดือน)",
  value_total: "มูลค่า",
  sale_type: "ประเภทการขาย",
  status: "สถานะ",
  sale_name: "ชื่อฝ่ายขาย",
  am_name: "ชื่อ AM",
  cancelled_at: "วันที่ยกเลิก",
  closed_at: "วันที่ปิด",
  renewed_from_contract_id: "ต่อจากสัญญาเดิม",
  renew_unlinked_reason: "เหตุผลต่อสัญญาโดยไม่ผูกเดิม",
  mail_received_date: "วันที่รับเอกสาร",
  first_service_date: "วันบริการครั้งแรก",
  first_service_time: "เวลาบริการครั้งแรก",
  is_urgent: "งานด่วน",
  // สถานี
  code: "รหัส",
  type: "ชนิด",
  installed_at: "วันที่ติดตั้ง",
  station_no: "เลขสถานี",
  point_label: "ชื่อจุดติดตั้ง",
  removed_at: "วันที่ถอน",
  collected_at: "วันที่เก็บ",
  pending_removal_month: "เดือนรอถอน",
  // การเข้าบริการ
  contract_id: "สัญญา",
  visit_date: "วันที่เข้าบริการ",
  visit_type: "ประเภทการเข้า",
  team_id: "ทีม",
  duration_min: "ระยะเวลา (นาที)",
  start_time: "เวลาเริ่ม",
  end_time: "เวลาเสร็จ",
  internal_inspection: "ตรวจภายใน",
  signed_by_proxy: "เซ็นแทน",
  timber_pcs: "ไม้ (ชิ้น)",
  bait_ig_ic_g: "เหยื่อ IG/IC (กรัม)",
  bait_ag_g: "เหยื่อ AG (กรัม)",
  powder_chemical: "ผงเคมี",
  first_install: "ติดตั้งครั้งแรก",
  note: "หมายเหตุ",
  makeup_for_month: "ทำชดเชยเดือน",
  // ผลตรวจสถานี
  visit_id: "การเข้าบริการ",
  station_id: "สถานี",
  follow_up_no: "ครั้งที่ติดตาม",
  termite_caste: "ชนิดปลวก",
  termite_group: "กลุ่มปลวก",
  bait_added_g: "เหยื่อที่เติม (กรัม)",
  bait_eaten_pct: "เหยื่อถูกกิน (%)",
  install_bait_g: "เหยื่อตอนติดตั้ง (กรัม)",
  powder_points: "จุดที่ใส่ผง",
  timber_replaced: "เปลี่ยนไม้",
  checked: "ตรวจแล้ว",
  // Port
  month_key: "เดือน",
  source: "ที่มา",
  report_cust: "จำนวนลูกค้า (รายงาน)",
  report_value: "มูลค่า (รายงาน)",
  // ปิดเดือน
  scope: "ส่วน",
  closed_by: "ผู้ปิด",
  last_resync_at: "คำนวณใหม่ล่าสุด",
  last_resync_by: "ผู้คำนวณใหม่",
  reopened_at: "เปิดใหม่เมื่อ",
  // ผู้ใช้ / ตั้งค่า
  display_name: "ชื่อที่แสดง",
  username: "ชื่อผู้ใช้",
  role: "สิทธิ์",
  position_code: "ตำแหน่ง",
  is_active: "เปิดใช้งาน",
  division_scope: "ขอบเขตงาน",
  effective_month: "มีผลตั้งแต่เดือน",
  change_reason: "เหตุผลที่แก้",
  go_live_month: "เดือนเริ่มใช้งานจริง",
  headcount: "จำนวนคน",
  // ไฟล์
  file_name: "ชื่อไฟล์",
  version: "เวอร์ชัน",
  hint: "คำใบ้",
};

const V_FIELDS = /^v_(s|m|l|xl)([13])$/;
const TIER_NAME: Record<string, string> = { s: "S", m: "M", l: "L", xl: "XL" };

export function fieldLabel(key: string): string {
  const hit = FIELD_LABEL[key];
  if (hit) return hit;
  const m = V_FIELDS.exec(key);
  if (m) return `มูลค่า ${TIER_NAME[m[1]]}${m[2]}`;
  return key;
}

/** ค่า enum / ข้อความรหัส → ภาษาไทย (ไม่รู้จัก = คืนค่าเดิม) */
const VALUE_LABEL: Record<string, string> = {
  new: "ขายใหม่",
  renew: "ต่อสัญญา",
  active: "ใช้งาน",
  expired_pending_collection: "หมดอายุ รอเก็บสถานี",
  closed: "ปิดแล้ว",
  cancelled: "ยกเลิก",
  eliminated: "กำจัดแล้ว",
  pending_removal: "รอถอน",
  removed: "ถอนแล้ว",
  routine: "ประจำเดือน",
  problem: "ปัญหา",
  follow_up: "ติดตาม",
  central: "ส่วนกลาง",
  province: "ต่างจังหวัด",
  computed: "คำนวณ",
  legacy: "ข้อมูลเดิม",
  manual: "กรอกมือ",
  host: "host",
  admin: "แอดมิน",
  recorder: "หัวหน้างาน",
  viewer: "ผู้ดูทั่วไป",
};

export function valueLabel(raw: string): string {
  return VALUE_LABEL[raw] ?? raw;
}

export const ACTION_LABEL: Record<"insert" | "update" | "delete", string> = {
  insert: "เพิ่ม",
  update: "แก้",
  delete: "ลบ",
};
