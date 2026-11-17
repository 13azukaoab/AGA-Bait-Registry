/**
 * สร้างเอกสารจากผล dry-run ทะเบียนรายสาขา (phase 6 · DECISIONS 2.70 ฉบับสุดท้าย) — pure function คืน string
 *
 * Logic summary:
 *   - "รายการแถวที่ต้องกรอกมือ": แถวที่ไม่ผ่าน strict (strictProblems) + แถวที่สั่งกันไว้ (heldRows ถ้ามี)
 *     → ไม่นำเข้าอัตโนมัติ · Admin กรอกเองในระบบ · แต่ละแถวมี สาขา · เลขแถว Excel · เหตุผล (ภาษาคน)
 *     → ไม่มีคำถามถึงสาขา และไม่ใส่ลูกค้าซ้ำ (2.59 แอดมินแก้เอง)
 *   - "ตารางแปลงประเภทลูกค้า": สร้างจาก CUSTOMER_TYPE_MAPPINGS + จำนวนแถวจริงต่อสาขา (ไม่พิมพ์ตารางเอง)
 *     แสดงรหัสทะเบียนทุกตัว (แม้ 0 แถว) + กฎเดิม (legacy) เฉพาะที่มีแถวโดน
 *   - ⚠ PDPA: ใช้ได้เฉพาะ เลขแถว Excel · ชนิดปัญหา (ตัดค่าจริงแล้ว) · จำนวน — ห้ามมีชื่อ/เบอร์/ที่อยู่/เลขสัญญา/ชื่อผู้ขาย
 */
import { CUSTOMER_TYPE_MAPPINGS, type CustomerTypeMappingSource } from "./customerTypes";
import type { BranchDryRun } from "./registryDryRun";

function cleanKind(kind: string): string {
  return kind
    .replace(/"…"/g, "")
    .replace(/\(…\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** ชนิดปัญหา (จาก kindOf) → เหตุผลภาษาคน */
export function describeProblem(kind: string): string {
  const text = cleanKind(kind);
  const term = /^ระยะสัญญาไม่ใช่ (.+)$/.exec(text);
  if (term) return `ช่องมูลค่า ${term[1]} แต่วันเริ่ม–วันสิ้นสุดไม่ใช่ ${term[1]}`;
  if (text.startsWith("เลขที่สัญญาไม่ครบ")) return "เลขที่สัญญาไม่ครบ 7 หลัก";
  if (text === "ไม่มีมูลค่า") return "ไม่มีมูลค่าสัญญา";
  return text;
}

export interface ManualEntryItem {
  branch: string;
  excelRow: number;
  reasons: string[];
}

/** รายการแถวที่ต้องกรอกมือ เรียงตามสาขา (ตามลำดับผล) แล้วตามเลขแถว */
export function buildManualEntryItems(results: BranchDryRun[]): ManualEntryItem[] {
  const items: ManualEntryItem[] = [];
  for (const r of results) {
    const mine: ManualEntryItem[] = [
      ...r.strictProblems.map((p) => ({ branch: r.branch, excelRow: p.excelRow, reasons: p.kinds.map(describeProblem) })),
      ...r.heldRows.map((h) => ({ branch: r.branch, excelRow: h.excelRow, reasons: [h.reason] })),
    ];
    mine.sort((a, b) => a.excelRow - b.excelRow);
    items.push(...mine);
  }
  return items;
}

export interface ManualEntryMeta {
  title: string;
  /** ชื่อไฟล์ทะเบียนต้นทาง (ไม่ใช่ path ในเครื่อง) */
  sourceFile: string;
  generatedOn: string;
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|");
}

/** เอกสาร markdown "รายการแถวที่ต้องกรอกมือ" (ไม่มีข้อมูลลูกค้า) */
export function renderManualEntryMarkdown(results: BranchDryRun[], meta: ManualEntryMeta): string {
  const items = buildManualEntryItems(results);
  const out: string[] = [];
  out.push(`# ${meta.title}`, "");
  out.push(`> ไฟล์ทะเบียน: \`${meta.sourceFile}\` · สร้างจากผล dry-run วันที่ ${meta.generatedOn}`);
  out.push("> \"แถว\" = เลขแถวในไฟล์ Excel ของสาขา (เปิดชีทของสาขาแล้วดูเลขแถวซ้ายมือ)");
  out.push("> แถวในรายการนี้ **ไม่ถูกนำเข้าอัตโนมัติ** เพราะตัวเลข/วันที่ไม่ตรงกัน ให้ Admin กรอกเองในระบบ · แถวอื่นนำเข้าตามปกติ");
  out.push("> เอกสารนี้ไม่มีชื่อ เบอร์โทร หรือที่อยู่ลูกค้า (PDPA)");
  out.push("");
  out.push("## สรุป", "");
  out.push("| สาขา | แถวที่ต้องกรอกมือ |", "|---|---|");
  for (const r of results) out.push(`| ${r.branch} | ${items.filter((i) => i.branch === r.branch).length} |`);
  out.push(`| **รวม** | **${items.length}** |`, "");
  out.push("## รายการ", "");
  out.push("| สาขา | แถว | เหตุผล |", "|---|---|---|");
  for (const i of items) out.push(`| ${i.branch} | ${i.excelRow} | ${cell(i.reasons.join(" · "))} |`);
  return out.join("\n");
}

export interface CustomerTypeMappingRow {
  from: string;
  to: string;
  source: CustomerTypeMappingSource;
  /** จำนวนแถวสัญญาต่อสาขา */
  counts: Record<string, number>;
  total: number;
}

const SOURCE_LABEL: Record<CustomerTypeMappingSource, string> = {
  registry: "รหัส/คำสะกดผิดในทะเบียน (2.70)",
  legacy: "ตารางเดิม (task.md 2 พ.ย.)",
};

/** แถวตารางแปลงประเภท: กฎ registry ทุกตัว + legacy ที่มีแถวโดน · นับแยกสาขา */
export function customerTypeMappingRows(results: BranchDryRun[]): CustomerTypeMappingRow[] {
  const rows: CustomerTypeMappingRow[] = [];
  for (const m of CUSTOMER_TYPE_MAPPINGS) {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const r of results) {
      let n = 0;
      for (const [value, c] of Object.entries(r.customerTypeValues)) {
        if (value.toUpperCase() === m.from.toUpperCase()) n += c;
      }
      counts[r.branch] = n;
      total += n;
    }
    if (m.source === "legacy" && total === 0) continue;
    rows.push({ from: m.from, to: m.to, source: m.source, counts, total });
  }
  const order: CustomerTypeMappingSource[] = ["registry", "legacy"];
  return rows.sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
}

/** ตารางแปลงประเภท (markdown) ให้เจ้าของตรวจ */
export function renderCustomerTypeMappingTable(results: BranchDryRun[]): string {
  const branches = results.map((r) => r.branch);
  const out: string[] = [];
  out.push(`| ค่าในทะเบียน | แปลงเป็น (master) | ที่มา | ${branches.join(" | ")} | รวม |`);
  out.push(`|---|---|---|${branches.map(() => "---").join("|")}|---|`);
  for (const row of customerTypeMappingRows(results)) {
    const counts = branches.map((b) => String(row.counts[b] ?? 0)).join(" | ");
    out.push(`| \`${row.from}\` | ${row.to} | ${SOURCE_LABEL[row.source]} | ${counts} | ${row.total} |`);
  }
  return out.join("\n");
}
