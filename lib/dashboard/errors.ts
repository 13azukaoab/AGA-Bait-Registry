/**
 * รหัส error สั้นๆ ของการส่ง Dashboard — เก็บลง `sync_logs.error_code` (≤ 40 ตัวอักษร)
 * และให้หน้าจอ 10 (Dashboard Sync) เลือกข้อความแนะนำวิธีแก้ได้ (M27)
 *
 * รหัสที่มาจาก GitHub ใช้รูป `github_<status>` (เช่น `github_401` = token ใช้ไม่ได้ · `github_502` = GitHub ขัดข้อง)
 * ไม่ประกาศไว้ในชนิดนี้เพราะ status มีได้หลายค่า
 */
export type DashboardSyncErrorCode =
  /** ไม่ได้ตั้ง env (`DASHBOARD_GITHUB_TOKEN` ฯลฯ) */
  | "config_missing"
  /** ไฟล์ที่สร้างผิดรูปแบบ §9.1 (ไม่ครบ 43 สาขา / ฟิลด์ไม่ครบ / key เดือนผิด) */
  | "invalid_data"
  /** ไฟล์ใหม่ไม่มีบางเดือนที่บน Dashboard มีอยู่ — ห้ามส่ง (ประวัติจะหาย) */
  | "months_dropped"
  /** ไม่มีแถว legacy (เดือนก่อนเริ่มใช้ระบบ) ในฐานข้อมูลเลย */
  | "legacy_missing"
  /** เดือนส่วนกลางที่ปิดแล้วไม่มี snapshot ที่เก็บไว้ (ห้ามคำนวณใหม่เอง — CLAUDE.md กฎ 7) */
  | "closed_snapshot_missing"
  /** ไม่พบ `index.html` บน repo Dashboard */
  | "index_missing"
  /** `index.html` ไม่มีบรรทัด `const DATA = …;` (โครงหน้าเปลี่ยน) */
  | "index_marker_missing"
  /** อ่านข้อมูลจากฐานข้อมูลไม่สำเร็จ */
  | "load_failed"
  | "unknown";

/** error ที่รู้สาเหตุ — พก `code` ไปบันทึก `sync_logs.error_code` */
export class DashboardSyncError extends Error {
  constructor(
    readonly code: DashboardSyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DashboardSyncError";
  }
}
