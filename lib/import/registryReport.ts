/**
 * สร้างเอกสารจากผล dry-run ทะเบียนรายสาขา (phase 6 · DECISIONS 2.70) — pure function คืน string
 *
 * Logic summary:
 *   - "รายการให้สาขายืนยัน": รวมแถวที่ไม่ผ่าน strict (strictProblems) + แถวที่สั่งกันไว้ (heldRows)
 *     → แปลง "ชนิดปัญหา" เป็นข้อความภาษาคนให้สาขา + สิ่งที่ขอให้สาขาตอบ (describeProblem)
 *     → แยกหัวข้อ "ลูกค้าซ้ำ" (กลุ่มเลขแถว · 2.59 แอดมินแก้เอง ไม่มีเครื่องมือรวม)
 *   - "ตารางแปลงประเภทลูกค้า": สร้างจาก CUSTOMER_TYPE_MAPPINGS + จำนวนแถวจริงต่อสาขา (ไม่พิมพ์ตารางเอง)
 *     แสดงรหัสทะเบียน/ข้อเสนอทุกตัว (แม้ 0 แถว) + กฎเดิม (legacy) เฉพาะที่มีแถวโดน
 *   - ⚠ PDPA: ใช้ได้เฉพาะ เลขแถว Excel · ชนิดปัญหา (ตัดค่าจริงแล้ว) · จำนวน — ห้ามมีชื่อ/เบอร์/ที่อยู่/เลขสัญญา/ชื่อผู้ขาย
 */
import { CUSTOMER_TYPE_MAPPINGS, type CustomerTypeMappingSource } from "./customerTypes";
import type { BranchDryRun } from "./registryDryRun";

export interface ProblemText {
  /** ปัญหาที่พบ (ภาษาคน) */
  problem: string;
  /** สิ่งที่ขอให้สาขาตอบ */
  ask: string;
}

function cleanKind(kind: string): string {
  return kind
    .replace(/"…"/g, "")
    .replace(/\(…\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** ชนิดปัญหา (จาก kindOf) → ข้อความให้สาขา */
export function describeProblem(kind: string): ProblemText {
  const text = cleanKind(kind);
  const term = /^ระยะสัญญาไม่ใช่ (.+)$/.exec(text);
  if (term) {
    return {
      problem: `ช่องมูลค่า ${term[1]} แต่วันเริ่ม–วันสิ้นสุดไม่ใช่ ${term[1]}`,
      ask: "สัญญานี้กี่ปี/กี่เดือน + วันเริ่ม–วันสิ้นสุดที่ถูกต้อง",
    };
  }
  if (text.startsWith("วันเริ่มสัญญา")) return { problem: text, ask: "วันเริ่มสัญญาที่ถูกต้อง" };
  if (text.startsWith("วันสิ้นสุด")) return { problem: text, ask: "วันสิ้นสุดสัญญาที่ถูกต้อง" };
  if (text.startsWith("เลขที่สัญญาไม่ครบ")) {
    return { problem: "เลขที่สัญญาไม่ครบ 7 หลัก", ask: "เลขที่สัญญาที่ถูกต้อง (รูปแบบ CTyy-nnnnnnn)" };
  }
  if (text === "ไม่มีมูลค่า") return { problem: "ไม่มีมูลค่าสัญญา", ask: "มูลค่าสัญญา และเป็นสัญญา 1 ปี หรือ 3 ปี" };
  if (text === "ไม่มีประเภทลูกค้า" || text.startsWith("ไม่รู้จักประเภท")) {
    return { problem: text, ask: "ประเภทลูกค้า (H = บ้าน / T = ทาวน์โฮม / R = ห้อง หรือประเภทอื่น)" };
  }
  return { problem: text, ask: "ตรวจและแก้ไขแถวนี้" };
}

export interface ConfirmationItem {
  branch: string;
  excelRow: number;
  problems: string[];
  asks: string[];
}

/** รายการให้สาขายืนยัน (แถวไม่ผ่าน + แถวที่กันไว้) เรียงตามสาขาตามลำดับผล แล้วตามเลขแถว */
export function buildConfirmationItems(results: BranchDryRun[]): ConfirmationItem[] {
  const items: ConfirmationItem[] = [];
  for (const r of results) {
    const branchItems: ConfirmationItem[] = [];
    for (const p of r.strictProblems) {
      const texts = p.kinds.map(describeProblem);
      branchItems.push({
        branch: r.branch,
        excelRow: p.excelRow,
        problems: texts.map((t) => t.problem),
        asks: [...new Set(texts.map((t) => t.ask))],
      });
    }
    for (const h of r.heldRows) {
      branchItems.push({
        branch: r.branch,
        excelRow: h.excelRow,
        problems: [h.reason],
        asks: ["ยืนยันว่ามูลค่าถูกต้อง หรือแจ้งมูลค่าที่ถูก"],
      });
    }
    branchItems.sort((a, b) => a.excelRow - b.excelRow);
    items.push(...branchItems);
  }
  return items;
}

export interface ConfirmationMeta {
  title: string;
  /** ชื่อไฟล์ทะเบียนต้นทาง (ไม่ใช่ path ในเครื่อง) */
  sourceFile: string;
  generatedOn: string;
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|");
}

/** เอกสาร markdown "รายการให้สาขายืนยัน" — ส่งต่อให้สาขาได้ (ไม่มีข้อมูลลูกค้า) */
export function renderConfirmationMarkdown(results: BranchDryRun[], meta: ConfirmationMeta): string {
  const items = buildConfirmationItems(results);
  const out: string[] = [];
  out.push(`# ${meta.title}`, "");
  out.push(`> ไฟล์ทะเบียน: \`${meta.sourceFile}\` · สร้างจากผล dry-run วันที่ ${meta.generatedOn}`);
  out.push("> \"แถว\" = เลขแถวในไฟล์ Excel ของสาขา (เปิดชีทของสาขาแล้วดูเลขแถวซ้ายมือ)");
  out.push("> เอกสารนี้ไม่มีชื่อ เบอร์โทร หรือที่อยู่ลูกค้า · แถวในรายการนี้จะ **ยังไม่ถูกนำเข้า** จนกว่าสาขาจะตอบ แถวอื่นนำเข้าตามปกติ");
  out.push("");

  const total = items.length;
  const dupTotal = results.reduce(
    (n, r) => n + r.duplicates.samePhoneDifferentName.length + r.duplicates.sameName.length,
    0,
  );
  out.push("## สรุป", "");
  out.push("| สาขา | แถวที่ต้องยืนยัน | กลุ่มที่อาจเป็นลูกค้าซ้ำ |", "|---|---|---|");
  for (const r of results) {
    const n = items.filter((i) => i.branch === r.branch).length;
    const d = r.duplicates.samePhoneDifferentName.length + r.duplicates.sameName.length;
    out.push(`| ${r.branch} | ${n} | ${d} |`);
  }
  out.push(`| **รวม** | **${total}** | **${dupTotal}** |`, "");

  for (const r of results) {
    const mine = items.filter((i) => i.branch === r.branch);
    const dups = r.duplicates;
    out.push(`## ${r.branch}`, "");
    if (mine.length === 0) {
      out.push("ไม่มีแถวที่ต้องยืนยัน", "");
    } else {
      out.push("### แถวที่ต้องยืนยันก่อนนำเข้า", "");
      out.push("| แถว | ปัญหาที่พบ | สิ่งที่ขอให้สาขาตอบ |", "|---|---|---|");
      for (const i of mine) {
        out.push(`| ${i.excelRow} | ${cell(i.problems.join(" · "))} | ${cell(i.asks.join(" · "))} |`);
      }
      out.push("");
    }
    if (dups.samePhoneDifferentName.length + dups.sameName.length > 0) {
      out.push("### ลูกค้าซ้ำ (แอดมินสาขาตรวจและแก้เอง · ไม่กระทบการนำเข้า)", "");
      out.push("ระบบนับต่อสัญญา จึงนำเข้าได้ตามปกติ แต่ขอให้แอดมินตรวจว่าเป็นลูกค้ารายเดียวกันหรือกรอกซ้ำ");
      out.push("ถ้าเป็นแถวที่กรอกซ้ำ (สัญญาเดียวกันกรอก 2 ครั้ง) ให้แจ้งกลับ เพราะจะทำให้นับเกิน", "");
      out.push("| กลุ่มแถว | ลักษณะ | สิ่งที่ขอให้สาขาตอบ |", "|---|---|---|");
      for (const g of dups.samePhoneDifferentName) {
        out.push(`| ${g.join(", ")} | เบอร์โทรเดียวกัน แต่ชื่อต่างกัน | ลูกค้ารายเดียวกันไหม (เช่น เปลี่ยนชื่อ) |`);
      }
      for (const g of dups.sameName) {
        out.push(`| ${g.join(", ")} | ชื่อเดียวกันหลายแถว | หลายสัญญาจริง หรือกรอกซ้ำ |`);
      }
      out.push("");
    }
  }
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
  registry: "รหัส/คำสะกดผิดในทะเบียน (2.70 ก1)",
  proposed: "ข้อเสนอ รอเจ้าของยืนยัน (ปิดอยู่)",
  legacy: "ตารางเดิม (task.md 2 พ.ย.)",
};

/** แถวตารางแปลงประเภท: กฎ registry/proposed ทุกตัว + legacy ที่มีแถวโดน · นับแยกสาขา */
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
  const order: CustomerTypeMappingSource[] = ["registry", "proposed", "legacy"];
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
