/**
 * แผนเติมวันที่จากไฟล์เปิดงานจริง (ไม่ต่อ DB) — ตรวจความสอดคล้องของตัวเลข
 * - ไฟล์จริงอยู่ใน fixtures/ (ไม่ commit · มีข้อมูลลูกค้า) → ไม่ครบ = skip เอง (CI ไม่มีไฟล์)
 * - ⚠ assert เฉพาะจำนวน ห้าม toEqual กับค่าที่มาจากแถวลูกค้า
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { JOB_OPENING_FILES, hasAllCentralFiles } from "./centralRegistryFiles";
import { REGISTRY_IMPORT_BATCH_OCT26 } from "./centralRegistrySheets";
import { planJobOpeningBackfill, summarizeBackfill } from "./jobOpeningBackfill";
import { REGISTRY_CONTRACTS_OCT26, loadJobOpeningIndex, loadRegistryBackfillContext } from "./jobOpeningBackfillFiles";

const FIXTURES_DIR = process.env.AGA_FIXTURES_DIR ?? resolve(process.cwd(), "fixtures");
const HAS_FILES = hasAllCentralFiles(FIXTURES_DIR) && JOB_OPENING_FILES.every((f) => existsSync(join(FIXTURES_DIR, f.file)));

describe.skipIf(!HAS_FILES)("เติมวันรับ Mail / วันบริการจากไฟล์เปิดงาน 2569 (ไฟล์จริง)", () => {
  const index = HAS_FILES ? loadJobOpeningIndex(FIXTURES_DIR) : null;
  const registry = HAS_FILES ? loadRegistryBackfillContext(FIXTURES_DIR) : null;

  it("ชุดเป้าหมาย = แผนนำเข้า 2,369 สัญญา · ตัวเลขรวมสอดคล้องกัน", () => {
    const plan = planJobOpeningBackfill(index!, registry!.targets, { fillBatches: [REGISTRY_IMPORT_BATCH_OCT26] });
    const s = summarizeBackfill(index!, plan, registry!.notFound);
    expect(registry!.targets).toHaveLength(REGISTRY_CONTRACTS_OCT26);
    expect(s.plan.matched + s.notFound.total).toBe(s.plan.jobContracts);
    expect(Object.values(s.notFound.byReason).reduce((a, b) => a + b, 0)).toBe(s.notFound.total);
    // ไม่มีชีทเดือนไหนหายจากการหาหัวตาราง (ม.ค.–พ.ย. 26)
    expect(s.sheets.filter((x) => x.contractRows > 0)).toHaveLength(11);
    expect(s.sheetsSkipped).toEqual(["2569:Reference", "2569:รายชื่อเซลล์"]);
    for (const f of ["mail", "service", "time"] as const) {
      // โหมดไฟล์ถือว่าช่องว่างทั้งหมด → ทุกสัญญาที่จับคู่ได้ = เติม / conflict / อ่านไม่ได้ / ว่าง (เวลา: + ไม่มีวันที่)
      const accounted = s.plan.fills[f] + s.plan.conflict[f] + s.plan.problemOnly[f] + s.plan.noValue[f] + (f === "time" ? s.plan.timeNoDate : 0);
      expect(accounted, f).toBe(s.plan.matched);
      expect(s.plan.alreadySame[f] + s.plan.alreadyDifferent[f], f).toBe(0);
    }
    const months = Object.keys(s.targetsByStartMonth);
    for (const m of months) {
      const filled = s.fillsByStartMonth[m]?.mail ?? 0;
      const without = s.targetsWithoutJobByStartMonth[m] ?? 0;
      expect(filled + without, m).toBeLessThanOrEqual(s.targetsByStartMonth[m]!);
    }
    expect(plan.updates.every((u) => Object.keys(u.set).length > 0)).toBe(true);
  });

  it("เวลาที่จะเติมมีวันที่บริการคู่เสมอ (CHECK เวลาต้องมีวันที่)", () => {
    const plan = planJobOpeningBackfill(index!, registry!.targets, { fillBatches: [REGISTRY_IMPORT_BATCH_OCT26] });
    expect(plan.updates.filter((u) => u.set.first_service_time && !u.set.first_service_date && !u.requireServiceDate)).toEqual([]);
  });
});
