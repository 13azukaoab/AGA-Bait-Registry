/**
 * ส่งออกทะเบียนเป็นไฟล์ CSV (เปิดใน Excel ได้ · UTF-8 มี BOM ให้ภาษาไทยไม่เพี้ยน) — pure function
 *
 * Logic summary:
 *   * คอลัมน์ตามตารางส่งออกของ mockup: # · ชื่อลูกค้า · เลขที่สัญญา · สาขา · เขต · ประเภท · เริ่ม · สิ้นสุด ·
 *     มูลค่าสัญญา · ต่อปี · Tier · สถานี · สถานะ (วันที่เป็น ค.ศ. DD/MM/YYYY)
 *   * Tier ในไฟล์ = ตัวอักษรกลุ่ม + ปี (เช่น XL1) · Custom ใส่ระยะเดือนต่อท้ายในคอลัมน์ "ระยะสัญญา (เดือน)" แยก
 *   * ป้องกัน CSV/formula injection: ข้อความที่ขึ้นต้นด้วย = + - @ (หรือ tab/CR) ใส่ ' นำหน้า · ตัวเลขไม่แตะ
 *   * ใช้ตัวกรอง/ลำดับเดียวกับที่เห็นในหน้า (ผู้เรียกโหลดข้อมูลมาให้) — ที่นี่แค่แปลงเป็นข้อความ
 */
import { colorGroup } from "@/lib/rules";

import { fmtDate, STATUS_LABEL } from "./registryStatus";
import type { RegistryRow } from "./registryTypes";

const HEADER = [
  "#",
  "ชื่อลูกค้า",
  "เลขที่สัญญา",
  "สาขา",
  "เขต",
  "ประเภท",
  "เริ่ม",
  "สิ้นสุด",
  "ระยะสัญญา (เดือน)",
  "มูลค่าสัญญา",
  "ต่อปี",
  "Tier",
  "สถานี",
  "สถานะ",
] as const;

/** ป้ายแบบ XL1 / S3 (กลุ่มสีตามระยะ) · null = "" */
export function tierText(row: Pick<RegistryRow, "tier" | "termMonths">): string {
  return row.tier ? `${row.tier}${colorGroup(row.termMonths)}` : "";
}

/** ข้อความหนึ่งช่อง: กัน formula injection + ครอบเครื่องหมายคำพูดเมื่อจำเป็น */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function registryCsv(rows: readonly RegistryRow[]): string {
  const lines: string[] = [HEADER.join(",")];
  rows.forEach((r, i) => {
    lines.push(
      [
        i + 1,
        r.customerName,
        r.contractNo,
        r.branchName,
        r.zoneName,
        r.customerTypeLabel,
        fmtDate(r.startDate),
        fmtDate(r.endDate),
        r.termMonths,
        r.valueTotal,
        Math.round(r.annualValue * 100) / 100,
        tierText(r),
        r.stationCount,
        STATUS_LABEL[r.status],
      ]
        .map(csvCell)
        .join(","),
    );
  });
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** ชื่อไฟล์ เช่น AGA-ทะเบียนลูกค้า-สัญญา-2026-11-20.csv */
export function registryFileName(todayIso: string): string {
  return `AGA-ทะเบียนลูกค้า-สัญญา-${todayIso}.csv`;
}
