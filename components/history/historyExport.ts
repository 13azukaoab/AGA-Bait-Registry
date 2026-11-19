/**
 * ส่งออกประวัติเป็น CSV (เปิดใน Excel ได้) — pure function สร้างข้อความ + ตัวช่วยดาวน์โหลดฝั่ง browser
 *
 * Logic summary:
 *   * โปรเจกต์ยังไม่มีไลบรารี .xlsx (ห้ามเพิ่ม dependency เอง) → ส่งออกเป็น CSV: นำหน้าด้วย UTF-8 BOM
 *     ให้ Excel อ่านภาษาไทยถูก · ครอบทุกเซลล์ด้วยเครื่องหมายคำพูด · ขึ้นบรรทัดใหม่แบบ CRLF
 *   * กัน CSV/formula injection: ชื่อลูกค้าเป็นข้อความที่ผู้ใช้พิมพ์ — เซลล์ที่ขึ้นต้นด้วย = + - @ TAB CR
 *     ใส่ ' นำหน้า ไม่ให้ Excel ตีเป็นสูตร
 *   * ส่งออกทุกแถวที่ตรงตัวกรอง (ผู้เรียกวนโหลดครบทุกหน้าก่อน) · กลุ่มการกรอกปกติ = 1 แถวพร้อมจำนวน
 *   * ไฟล์มีข้อมูลลูกค้า (PDPA) — สร้างและดาวน์โหลดในเครื่องผู้ใช้เท่านั้น ไม่ส่งไปที่ไหน
 */
import { bangkokDay, changePhrase, describeAudit, type FormatCtx } from "./historyDiff";
import { ACTION_LABEL, kindLabel, kindOfTable } from "./historyLabels";
import type { AuditRow, ContractInfo, HistoryEntry } from "./historyTypes";

export interface ExportCtx extends FormatCtx {
  positionLabel: (code: string | null) => string;
  contract: (id: string | null) => ContractInfo | null;
  /** ผลตรวจ "แก้หลังปิด" ของแถว audit */
  isPostClose: (row: AuditRow) => boolean;
}

export const EXPORT_HEADERS: readonly string[] = [
  "วันที่",
  "เวลา",
  "ใคร",
  "ตำแหน่ง",
  "สาขา",
  "เลขที่สัญญา",
  "ลูกค้า",
  "ประเภทข้อมูล",
  "การกระทำ",
  "รายละเอียด",
  "จำนวนรายการ (กลุ่มกรอกปกติ)",
  "แก้หลังปิดเดือน",
  "เดือนของข้อมูล",
];

/** เซลล์ CSV: กัน formula injection + ครอบเครื่องหมายคำพูด */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function timeOf(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms + 7 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function entryToCsvRow(e: HistoryEntry, ctx: ExportCtx, personPosition: (userId: string | null) => string): string[] {
  if (e.type === "group") {
    const first = timeOf(e.firstAt);
    const last = timeOf(e.at);
    const branches = e.branchIds.map((b) => ctx.branchName(b) ?? "").filter(Boolean);
    return [
      e.day,
      first === last ? last : `${first}–${last}`,
      e.userId ? (ctx.personName(e.userId) ?? "") : "",
      personPosition(e.userId),
      branches.join(" / "),
      "",
      "",
      "ผลบริการ",
      ACTION_LABEL.insert,
      `กรอกผลบริการประจำเดือน ${e.count} รายการ`,
      String(e.count),
      "",
      "",
    ];
  }
  const r = e.row;
  const d = describeAudit(r, ctx);
  const c = ctx.contract(r.contractId);
  const detail = d.changes.length ? d.changes.map(changePhrase).join("; ") : d.headline;
  return [
    bangkokDay(r.changedAt),
    timeOf(r.changedAt),
    r.changedBy ? (ctx.personName(r.changedBy) ?? "") : "ระบบ",
    ctx.positionLabel(r.actorPositionCode),
    r.branchId ? (ctx.branchName(r.branchId) ?? "") : "",
    c?.contractNo ?? "",
    c?.customerName ?? "",
    kindLabel(kindOfTable(r.tableName)),
    ACTION_LABEL[r.action],
    r.action === "update" ? detail : `${d.headline}${d.changes.length ? " — " + d.changes.map(changePhrase).join("; ") : ""}`,
    "",
    ctx.isPostClose(r) ? "ใช่" : "",
    r.monthKey ?? "",
  ];
}

/** ข้อความ CSV ทั้งไฟล์ (นำหน้าด้วย BOM) */
export function buildCsv(entries: readonly HistoryEntry[], ctx: ExportCtx, personPosition: (userId: string | null) => string): string {
  const lines = [EXPORT_HEADERS.map(csvCell).join(",")];
  for (const e of entries) lines.push(entryToCsvRow(e, ctx, personPosition).map(csvCell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** ชื่อไฟล์ เช่น AGA-ประวัติการแก้ไข-2026-11-01_2026-11-07.csv */
export function exportFileName(from: string, to: string): string {
  return `AGA-ประวัติการแก้ไข-${from}_${to}.csv`;
}

/** ดาวน์โหลดไฟล์ในเบราว์เซอร์ (เรียกจากปุ่มเท่านั้น) */
export function downloadCsv(text: string, fileName: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
