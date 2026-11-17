/**
 * ทดลองนำเข้าทะเบียนเขต 1 (OCT.26) จากไฟล์จริง — dry-run ไม่เขียนฐานข้อมูล (phase 6 · SPEC §15 ข้อ 1)
 *
 * - ไฟล์จริงอยู่ใน fixtures/ (ไม่ commit · มีข้อมูลลูกค้า) → ไม่เจอไฟล์ = skip เอง (CI ไม่มีไฟล์)
 * - ตำแหน่งไฟล์: env AGA_FIXTURES_DIR หรือ <repo>/fixtures
 * - ตั้ง env AGA_DRYRUN_OUT=<path>.json เพื่อเขียนผลสรุป (ตัวเลข + เลขแถว Excel เท่านั้น ไม่มีชื่อ/เบอร์/ที่อยู่)
 * - เทสนี้ตรวจแค่ "ไม่มีแถวหาย + ตัวเลขภายในสอดคล้องกัน" ไม่บังคับให้ตรง §15
 *   (ตัวเลขอ้างอิงมีหลายแหล่งและรอเจ้าของตัดสิน — ผลเทียบอยู่ใน docs/ผลทดลองนำเข้าเขต1-OCT26.md)
 */
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TIER_RULES } from "../rules/__fixtures__/tierRules";
import { dryRunRegistrySheet, type BranchDryRun } from "./registryDryRun";
import { readXlsx } from "./xlsx/readXlsx";

const FIXTURES_DIR = process.env.AGA_FIXTURES_DIR ?? resolve(process.cwd(), "fixtures");
const ZONE1_FILE = join(FIXTURES_DIR, "OCT.26_เขต 1 ปี 2026 (พุทธมณฑล, นครปฐม, หัวหิน).xlsx");
const MONTHS = ["2026-09", "2026-10"];

describe.skipIf(!existsSync(ZONE1_FILE))("dry-run ทะเบียนเขต 1 OCT.26 (ไฟล์จริง)", () => {
  const results: BranchDryRun[] = existsSync(ZONE1_FILE)
    ? readXlsx(ZONE1_FILE).map((s) => dryRunRegistrySheet(s.name, s.rows, { rules: TIER_RULES, months: MONTHS }))
    : [];

  it("อ่านได้ครบ 3 สาขาของเขต 1", () => {
    expect(results.map((r) => r.branch).sort()).toEqual(["นครปฐม", "พุทธมณฑล", "หัวหิน"].sort());
    results.forEach((r) => expect(r.area).toBe("เขต 1"));
  });

  it("ทุกแถวสัญญาถูกจัดกลุ่ม (ready + mustFix) ไม่มีแถวหาย", () => {
    for (const r of results) {
      expect(r.contractRows).toBeGreaterThan(0);
      expect(r.strict.ready + r.strict.mustFix).toBe(r.contractRows);
      expect(r.lenient.ready + r.lenient.mustFix).toBe(r.contractRows);
      expect(r.strict.ready + r.strict.mustFix + r.strict.skipped).toBe(r.dataRows);
      // lenient ตัดแค่ปัญหาประเภท/ทีม → ต้องผ่านไม่น้อยกว่า strict
      expect(r.lenient.ready).toBeGreaterThanOrEqual(r.strict.ready);
    }
  });

  it("snapshot ภายในสอดคล้องกัน (cust = ผลรวมจำนวน tier · value = ผลรวมมูลค่า tier)", () => {
    for (const r of results) {
      for (const m of MONTHS) {
        for (const row of [r.snapshots[m]!.strict, r.snapshots[m]!.lenient]) {
          const counts = row.s1 + row.s3 + row.m1 + row.m3 + row.l1 + row.l3 + row.xl1 + row.xl3;
          expect(row.cust).toBe(counts);
          expect(row.value).toBeCloseTo(row.vS + row.vM + row.vL + row.vXL, 2);
        }
      }
    }
  });

  it("พบบล็อกสรุปท้ายชีททุกสาขา (ใช้เป็นตัวเทียบแหล่งเดียวกัน)", () => {
    for (const r of results) expect(r.inSheetSummary).not.toBeNull();
  });

  it("เขียนผลสรุป (ถ้าตั้ง AGA_DRYRUN_OUT)", () => {
    const out = process.env.AGA_DRYRUN_OUT;
    if (out) writeFileSync(out, JSON.stringify(results, null, 2), "utf8");
    expect(true).toBe(true);
  });
});
