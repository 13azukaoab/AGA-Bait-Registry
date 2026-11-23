/**
 * แบบฟอร์มกรอกแถวที่นำเข้าไม่ได้ (2.104) จากไฟล์ทะเบียนจริง OCT.26 — ไม่เขียนฐานข้อมูล
 *
 * - ไฟล์จริงอยู่ใน fixtures/ (ไม่ commit · มีข้อมูลลูกค้า) → ไม่ครบ = skip เอง (CI / worktree ที่ไม่มีไฟล์)
 * - ตำแหน่งไฟล์: env AGA_FIXTURES_DIR หรือ <repo>/fixtures
 * - ⚠ assert เฉพาะจำนวน/เลขแถว/ชื่อสาขา ห้าม toEqual กับค่าจากแถวลูกค้า (diff ของ vitest จะพิมพ์ค่าออกมา)
 * - ไฟล์ .xlsx ที่เขียนระหว่างเทสอยู่ในโฟลเดอร์ชั่วคราวของระบบ และลบทิ้งตอนจบ
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { JOB_OPENING_FILES, hasAllCentralFiles, loadCentralRegistry, loadSellerIndex } from "./centralRegistryFiles";
import {
  FIXED_YES,
  FORM_COLUMNS,
  buildManualFormRows,
  formHeaders,
  formRowValues,
  manualRowKey,
  parseManualListMarkdown,
  readManualRowsForm,
  type FormRow,
} from "./manualRowsForm";
import { readXlsx } from "./xlsx/readXlsx";
import { buildXlsx } from "./xlsx/writeXlsx";

const FIXTURES_DIR = process.env.AGA_FIXTURES_DIR ?? resolve(process.cwd(), "fixtures");
const HAS_FILES = hasAllCentralFiles(FIXTURES_DIR) && JOB_OPENING_FILES.every((f) => existsSync(join(FIXTURES_DIR, f.file)));
const DOCS = ["docs/รายการกรอกมือ-เขต1-OCT26.md", "docs/รายการกรอกมือ-21สาขา-OCT26.md"].map((p) => resolve(process.cwd(), p));

describe.skipIf(!HAS_FILES)("แบบฟอร์มกรอกแถวที่นำเข้าไม่ได้ OCT.26 (ไฟล์จริง)", () => {
  const central = HAS_FILES ? loadCentralRegistry(FIXTURES_DIR) : { sheets: [], skipped: [], holds: new Map() };
  const rows: FormRow[] = HAS_FILES
    ? buildManualFormRows(
        central.sheets.map((s) => ({
          file: s.spec.file,
          sheet: s.sheet,
          branch: s.branch,
          grid: s.grid,
          parsed: s.parsed,
          holdRows: central.holds.get(s.branch),
          excludeRows: s.excludeRows,
        })),
        loadSellerIndex(FIXTURES_DIR),
      )
    : [];
  const known = new Set(rows.map((r) => manualRowKey(r.branch, Number(r.excelRow))));
  const tmp = mkdtempSync(join(tmpdir(), "aga-form-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("121 แถว · ชุด (สาขา, แถว) ตรงเอกสารรายการกรอกมือทุกแถว · ไม่มีแถวซ้ำ", () => {
    expect(rows).toHaveLength(121);
    const docKeys = DOCS.flatMap((p) => parseManualListMarkdown(readFileSync(p, "utf8"))).map((r) => manualRowKey(r.branch, r.excelRow));
    expect(docKeys).toHaveLength(121);
    expect([...known].sort()).toEqual([...new Set(docKeys)].sort()); // ชื่อสาขา + เลขแถว (ไม่ใช่ข้อมูลลูกค้า)
  });

  it("ทุกแถวเริ่มที่ แก้แล้ว = ไม่ · มีเหตุผล · ช่องอ้างอิงครบ", () => {
    for (const r of rows) {
      expect(r.fixed).toBe("ไม่");
      expect(r.reason.length).toBeGreaterThan(0);
      expect(r.file.endsWith(".xlsx")).toBe(true);
    }
  });

  it("เขียน .xlsx แล้วอ่านกลับ: ค่าเดิมทุกเซลล์ · ยังไม่แก้ = ไม่นำเข้าเลย", () => {
    const path = join(tmp, "form.xlsx");
    writeFileSync(path, buildXlsx([{ name: "แบบฟอร์ม", header: true, rows: [formHeaders(), ...rows.map(formRowValues)] }]));
    const grid = readXlsx(path)[0]!.rows;
    const same = rows.every((r, i) => FORM_COLUMNS.every((c, j) => (grid[i + 1]![j] ?? "") === r[c.key]));
    expect(same).toBe(true); // ไม่ใช้ toEqual (กัน diff พิมพ์ข้อมูลลูกค้า)
    const res = readManualRowsForm(grid, { knownRows: known });
    expect(res.counts).toMatchObject({ rows: 121, fixedNo: 121, accepted: 0, invalid: 0 });
  });

  it("ติ๊ก ใช่ ทุกแถวโดยไม่แก้ค่า: ทุกแถวถูกตัดสิน (ผ่าน + ไม่ผ่าน = 121) · เหตุผลไม่มีค่าจริง", () => {
    const grid = [formHeaders(), ...rows.map((r) => formRowValues({ ...r, fixed: FIXED_YES }))];
    const res = readManualRowsForm(grid, { knownRows: known });
    expect(res.counts.fixedYes).toBe(121);
    expect(res.accepted.length + res.invalid.length).toBe(121);
    // ค่าเดิมในทะเบียนผิดอยู่ จึงต้องไม่ผ่านเกือบทั้งหมด (ผ่านได้เฉพาะแถวที่ปัญหาเดิมเป็นแถวที่กันไว้ ซึ่ง OCT.26 ไม่มี)
    expect(res.invalid.length).toBeGreaterThan(100);
    const names = new Set(rows.map((r) => r.customerName).filter((n) => n.length >= 4));
    for (const p of res.invalid) for (const reason of p.reasons) for (const n of names) expect(reason.includes(n)).toBe(false);
  });
});
