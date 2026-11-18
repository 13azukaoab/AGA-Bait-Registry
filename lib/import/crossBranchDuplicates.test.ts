/** เลขสัญญาซ้ำข้ามสาขา (ข้อมูลสมมติ) */
import { describe, expect, it } from "vitest";
import { DUPLICATE_ACROSS_BRANCH_REASON, findCrossBranchDuplicates } from "./crossBranchDuplicates";
import type { RegistryRow } from "./registrySheet";

const row = (excelRow: number, no: string): RegistryRow => ({ excelRow, raw: { เลขที่สัญญา: no }, phoneDigits: "" });

describe("findCrossBranchDuplicates", () => {
  it("กันทุกแถวของเลขที่ซ้ำข้ามสาขา · ซ้ำในสาขาเดียวกันไม่นับ · ไม่สนช่องว่าง/ตัวพิมพ์", () => {
    const holds = findCrossBranchDuplicates([
      { branch: "พุทธมณฑล", rows: [row(225, "CT25-0000001"), row(10, "CT26-0000009"), row(11, "CT26-0000009")] },
      { branch: "สุวินทวงศ์", rows: [row(77, " ct25-0000001"), row(5, "CT26-0000002")] },
      { branch: "สาทร", rows: [row(6, "")] },
    ]);
    expect([...holds.keys()].sort()).toEqual(["พุทธมณฑล", "สุวินทวงศ์"].sort());
    expect(holds.get("พุทธมณฑล")).toEqual([{ excelRow: 225, reason: DUPLICATE_ACROSS_BRANCH_REASON }]);
    expect(holds.get("สุวินทวงศ์")).toEqual([{ excelRow: 77, reason: DUPLICATE_ACROSS_BRANCH_REASON }]);
  });

  it("ไม่มีซ้ำ → ว่าง", () => {
    expect(findCrossBranchDuplicates([{ branch: "สาทร", rows: [row(6, "CT26-0000001")] }]).size).toBe(0);
  });
});
