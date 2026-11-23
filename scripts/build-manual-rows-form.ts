/**
 * สร้าง "แบบฟอร์มกรอกแถวที่นำเข้าไม่ได้" (DECISIONS 2.104) เป็นไฟล์ .xlsx ใน fixtures/ — ไม่แตะฐานข้อมูล
 * (ตรรกะ: lib/import/manualRowsForm.ts · วิธีกรอก: docs/แบบฟอร์มกรอกแถวที่นำเข้าไม่ได้.md)
 *
 * วิธีรัน (จากโฟลเดอร์โปรเจกต์ · ใช้ไฟล์ทะเบียน OCT.26 8 ไฟล์ + ไฟล์เปิดงาน 2 ไฟล์ใน fixtures):
 *   npx vite-node --config vitest.config.ts scripts/build-manual-rows-form.ts -- --fixtures "<path>/fixtures"
 *   ตัวเลือก: --out "<path>/fixtures/<ชื่อไฟล์>.xlsx" (ค่าเริ่มต้น = fixtures/แบบฟอร์มกรอกแถวที่นำเข้าไม่ได้-OCT26.xlsx)
 *             --overwrite (ไฟล์มีอยู่แล้ว = หยุด กันทับไฟล์ที่แอดมินกำลังกรอก)
 *
 * ด่านกันพลาด (PDPA — ไฟล์ผลลัพธ์มีชื่อ เบอร์ ที่อยู่ลูกค้า):
 *   - เขียนได้เฉพาะ path ที่ git ignore อยู่ (ตรวจด้วย git check-ignore ของ repo ที่ไฟล์อยู่) · ไม่ ignore = หยุด
 *   - ต้องได้ 121 แถว และชุด (สาขา, แถว) ต้องตรงเอกสาร docs/รายการกรอกมือ-*.md ทุกแถว · ไม่ตรง = หยุด
 *   - พิมพ์เฉพาะ path · จำนวนแถวต่อสาขา · จำนวนช่องที่มีค่า/ว่างต่อคอลัมน์ (ไม่พิมพ์ค่าในเซลล์)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hasAllCentralFiles, loadCentralRegistry, loadSellerIndex } from "../lib/import/centralRegistryFiles";
import { CUSTOMER_TYPES, CUSTOMER_TYPE_MAPPINGS } from "../lib/import/customerTypes";
import {
  FIXED_NO,
  FIXED_YES,
  FORM_COLUMNS,
  buildManualFormRows,
  countFilledByColumn,
  formHeaders,
  formRowValues,
  manualRowKey,
  parseManualListMarkdown,
} from "../lib/import/manualRowsForm";
import { buildXlsx } from "../lib/import/xlsx/writeXlsx";
import { flag, hasFlag } from "./_cloudCli";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXPECTED_ROWS = 121;
const MANUAL_LIST_DOCS = ["docs/รายการกรอกมือ-เขต1-OCT26.md", "docs/รายการกรอกมือ-21สาขา-OCT26.md"];
export const DEFAULT_FORM_NAME = "แบบฟอร์มกรอกแถวที่นำเข้าไม่ได้-OCT26.xlsx";

/**
 * ปลายทางต้องอยู่ในโฟลเดอร์ชื่อ fixtures และ path `fixtures/<ชื่อไฟล์>` ต้องถูก ignore ตาม .gitignore ของ repo นี้
 * (ตรวจกับ repo ของสคริปต์ — .gitignore อยู่ใน git จึงเหมือนกันทุก worktree) · ไม่ผ่าน = throw
 */
function assertGitIgnored(path: string): void {
  if (basename(dirname(path)) !== "fixtures") {
    throw new Error("ไฟล์ปลายทางต้องอยู่ในโฟลเดอร์ fixtures/ — หยุด (ไฟล์มีข้อมูลลูกค้า)");
  }
  try {
    execFileSync("git", ["check-ignore", "-q", `fixtures/${basename(path)}`], { cwd: REPO_ROOT, stdio: "ignore" });
  } catch {
    throw new Error("ไฟล์ปลายทางไม่ถูก git ignore — หยุด (ไฟล์มีข้อมูลลูกค้า ต้องอยู่ใน fixtures/ เท่านั้น)");
  }
}

function instructionRows(): string[][] {
  const rows: string[][] = [
    ["คำอธิบายแบบฟอร์ม (ฉบับเต็ม: docs/แบบฟอร์มกรอกแถวที่นำเข้าไม่ได้.md)"],
    [""],
    ["1. แก้เฉพาะคอลัมน์ตั้งแต่ \"แก้แล้ว (ใช่/ไม่)\" ไปทางขวา · คอลัมน์ ลำดับ ถึง ข้อความช่วงวันที่ เป็นข้อมูลอ้างอิง ห้ามแก้"],
    [`2. แก้ค่าครบแล้วเปลี่ยนช่อง "แก้แล้ว" เป็น ${FIXED_YES} · ยังไม่แก้/ไม่แน่ใจ ให้คง ${FIXED_NO} (ระบบไม่นำเข้าแถวนั้น)`],
    ["3. วันที่พิมพ์ วว/ดด/ปปปป ปี ค.ศ. เช่น 15/01/2026 (ห้ามใช้ปี พ.ศ.)"],
    ["4. ระยะสัญญา: 1 ปี = ใส่มูลค่าทั้งสัญญาในช่อง 1 ปี · 3 ปี = ใส่มูลค่าทั้งสัญญาในช่อง 3 ปี (ไม่หารต่อปี)"],
    ["   Custom (1–35 เดือน ที่ไม่ใช่ 12) = ใส่มูลค่าทั้งสัญญาในช่อง 1 ปี + ใส่จำนวนเดือนในช่อง \"จำนวนเดือน\" · ใส่มูลค่าช่องเดียวเท่านั้น"],
    ["5. วันสิ้นสุดต้องตรงกับระยะสัญญา (วันเริ่ม + จำนวนเดือน − 1 วัน) · คลาดเกิน 45 วัน (สัญญาสั้นกว่า 12 เดือน: 7 วัน) = ไม่ผ่าน"],
    ["6. เบอร์โทร: พิมพ์ 0 นำหน้า หลายเบอร์คั่นด้วย / · ชื่อผู้ติดต่อใส่ช่อง \"ชื่อผู้ติดต่อ\" หรือพิมพ์ต่อท้ายเบอร์ก็ได้"],
    ["7. ห้ามแก้ชื่อหัวคอลัมน์ ห้ามเพิ่ม/ลบแถว ห้ามเปลี่ยนชื่อชีท · บันทึกเป็น .xlsx เหมือนเดิม"],
    [""],
    ["ประเภทลูกค้าที่ใช้ได้ (master 14 ค่า)"],
    ...CUSTOMER_TYPES.map((t) => [t]),
    [""],
    ["รหัส/คำในทะเบียนที่ระบบแปลงให้อัตโนมัติ (ใส่ได้)", "แปลงเป็น"],
    ...CUSTOMER_TYPE_MAPPINGS.filter((m) => m.source === "registry").map((m) => [m.from, m.to]),
  ];
  return rows;
}

function main(): void {
  const dir = flag("--fixtures") ?? process.env.AGA_FIXTURES_DIR;
  if (!dir) throw new Error("ต้องระบุ --fixtures <โฟลเดอร์ fixtures> (หรือ env AGA_FIXTURES_DIR)");
  if (!hasAllCentralFiles(dir)) throw new Error("ไฟล์ทะเบียน OCT.26 ไม่ครบ 8 ไฟล์ในโฟลเดอร์ที่ระบุ");
  const out = resolve(flag("--out") ?? join(dir, DEFAULT_FORM_NAME));
  if (!out.toLowerCase().endsWith(".xlsx")) throw new Error("--out ต้องเป็นไฟล์ .xlsx");
  // ต้องอยู่ในโฟลเดอร์ --fixtures ตรงตัว (กัน path อย่าง docs/fixtures/ ที่ชื่อโฟลเดอร์ตรงแต่ไม่ถูก ignore)
  if (resolve(dirname(out)) !== resolve(dir)) throw new Error("--out ต้องอยู่ในโฟลเดอร์เดียวกับ --fixtures — หยุด (ไฟล์มีข้อมูลลูกค้า)");
  assertGitIgnored(out);
  if (existsSync(out) && !hasFlag("--overwrite")) {
    throw new Error("ไฟล์แบบฟอร์มมีอยู่แล้ว — หยุด (กันทับไฟล์ที่แอดมินกำลังกรอก) · ถ้าตั้งใจสร้างใหม่ให้ใส่ --overwrite");
  }

  const central = loadCentralRegistry(dir);
  const rows = buildManualFormRows(
    central.sheets.map((s) => ({
      file: s.spec.file,
      sheet: s.sheet,
      branch: s.branch,
      grid: s.grid,
      parsed: s.parsed,
      holdRows: central.holds.get(s.branch),
      excludeRows: s.excludeRows,
    })),
    loadSellerIndex(dir),
  );

  // ตรวจกับเอกสารที่เจ้าของเห็น (ไม่มีข้อมูลลูกค้า)
  if (rows.length !== EXPECTED_ROWS) throw new Error(`ได้ ${rows.length} แถว ไม่ใช่ ${EXPECTED_ROWS} — หยุด ตรวจไฟล์ทะเบียน`);
  const docKeys = new Set(
    MANUAL_LIST_DOCS.flatMap((p) => parseManualListMarkdown(readFileSync(join(REPO_ROOT, p), "utf8"))).map((r) =>
      manualRowKey(r.branch, r.excelRow),
    ),
  );
  const formKeys = new Set(rows.map((r) => manualRowKey(r.branch, Number(r.excelRow))));
  const onlyForm = [...formKeys].filter((k) => !docKeys.has(k));
  const onlyDoc = [...docKeys].filter((k) => !formKeys.has(k));
  if (docKeys.size !== EXPECTED_ROWS || onlyForm.length || onlyDoc.length) {
    throw new Error(`แถวไม่ตรงเอกสารรายการกรอกมือ (เฉพาะฟอร์ม: ${onlyForm.join(", ") || "-"} · เฉพาะเอกสาร: ${onlyDoc.join(", ") || "-"}) — หยุด`);
  }

  const xlsx = buildXlsx([
    {
      name: "แบบฟอร์ม",
      header: true,
      rows: [formHeaders(), ...rows.map(formRowValues)],
      columns: FORM_COLUMNS.map((c) => ({ width: c.width, list: c.list })),
    },
    { name: "คำอธิบาย", rows: instructionRows(), columns: [{ width: 90 }, { width: 30 }] },
  ]);
  writeFileSync(out, xlsx);

  const byBranch: Record<string, number> = {};
  for (const r of rows) byBranch[r.branch] = (byBranch[r.branch] ?? 0) + 1;
  console.log(
    JSON.stringify(
      {
        file: out,
        rows: rows.length,
        matchesManualListDocs: true,
        byBranch,
        columns: countFilledByColumn(rows),
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (e: unknown) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
