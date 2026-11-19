/**
 * ชนิดข้อมูลของหน้า "ประวัติการแก้ไข" (/admin/history · SPEC §8.2 · mockup FINAL docs/mockup/history-log.html)
 *
 * Logic summary (ทั้งโฟลเดอร์ components/history/):
 *   * ข้อมูลหลักมาจากตาราง `audit_log` (แก้/ลบ/เพิ่มของตารางที่ผูก trigger) — host อ่านได้ผ่าน RLS เท่านั้น
 *   * "การกรอกปกติ" ของ visits ไม่ลง audit_log (DECISIONS 4.3) → รวมเป็นกลุ่มต่อคนต่อวันจากตาราง `visits`
 *     (created_by / created_at) เฉพาะเมื่อผู้ใช้เปิดโหมด "รวมการกรอกปกติ"
 *   * เวลา (`changedAt`) เก็บเป็น string ดิบจาก PostgREST (ความละเอียดไมโครวินาที) ห้ามผ่าน Date
 *     เพราะ keyset cursor ต้องเทียบค่าเดียวกับในฐานข้อมูลเป๊ะๆ
 *   * ⚠ PDPA: old/new ของแถวมีข้อมูลลูกค้า — ห้าม log ลง console/server ห้ามใส่ใน URL
 */

/** แถวดิบจาก audit_log (แปลง snake_case → camelCase ที่ชั้น historyData) */
export type AuditAction = "insert" | "update" | "delete";

export interface AuditRow {
  id: string;
  tableName: string;
  rowId: string | null;
  action: AuditAction;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  changedBy: string | null;
  /** string ดิบจาก PostgREST เช่น 2026-11-09T07:21:33.123456+00:00 */
  changedAt: string;
  branchId: string | null;
  contractId: string | null;
  /** YYYY-MM */
  monthKey: string | null;
  actorPositionCode: string | null;
}

/** ข้อมูลอ้างอิงที่ server โหลดมาครั้งเดียวต่อหน้า */
export interface BranchRef {
  id: string;
  name: string;
  division: "central" | "province";
  zoneId: string;
  zoneName: string;
}

export interface PersonRef {
  userId: string;
  displayName: string;
}

export interface PositionRef {
  code: string;
  /** ชื่อสั้น (short_name_th) ถ้าไม่มีใช้ชื่อเต็ม */
  label: string;
}

export interface ClosureRef {
  /** YYYY-MM */
  monthKey: string;
  scope: "central" | "province";
  closedAt: string | null;
  lastResyncAt: string | null;
}

export interface ContractInfo {
  id: string;
  contractNo: string;
  customerName: string;
}

export interface HistoryRefs {
  branches: BranchRef[];
  people: PersonRef[];
  positions: PositionRef[];
  closures: ClosureRef[];
}

/** ตัวกรองที่ผู้ใช้เลือก — ทุกค่าเป็น id / enum / วันที่ (ไม่มีข้อความอิสระ จึงใส่ใน URL ได้) */
export interface HistoryFilters {
  /** YYYY-MM-DD (เวลาไทย) รวมวันนี้ */
  from: string;
  to: string;
  /** user id ของผู้แก้ */
  people: string[];
  zones: string[];
  branches: string[];
  /** contract id (uuid) — ค้นจากเลขสัญญาแล้วแปลงเป็น id ก่อนเก็บ */
  contractId: string | null;
  /** YYYY-MM */
  months: string[];
  /** รหัสประเภทข้อมูล (DataKind) */
  kinds: string[];
  actions: AuditAction[];
  postCloseOnly: boolean;
}

export type ViewMode = "table" | "timeline";
export type DisplayMode = "changes" | "all";

/** รายการเดียวที่แสดงในหน้า: เหตุการณ์จาก audit_log หรือกลุ่มการกรอกปกติ */
export interface AuditEntry {
  type: "audit";
  key: string;
  /** เวลาเรียงลำดับ (ISO ดิบ) */
  at: string;
  row: AuditRow;
}

export interface VisitGroupEntry {
  type: "group";
  key: string;
  /** เวลาล่าสุดของกลุ่ม (ISO ดิบ) — ใช้เรียง */
  at: string;
  firstAt: string;
  userId: string | null;
  /** วันที่ไทย YYYY-MM-DD */
  day: string;
  branchIds: string[];
  count: number;
  visitIds: string[];
}

export type HistoryEntry = AuditEntry | VisitGroupEntry;
