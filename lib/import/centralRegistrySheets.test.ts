/** ตารางชีท → สาขา ของทะเบียนส่วนกลาง (ไม่ใช้ไฟล์จริง) */
import { describe, expect, it } from "vitest";
import { BRANCHES, BRANCH_NAMES } from "../dashboard/branches";
import {
  CENTRAL_REGISTRY_FILES_OCT26,
  registryTargetBranches,
  resolveRegistrySheet,
} from "./centralRegistrySheets";

describe("CENTRAL_REGISTRY_FILES_OCT26", () => {
  const targets = registryTargetBranches();

  it("ชื่อสาขาปลายทางสะกดตรง lib/dashboard/branches.ts ทุกตัวอักษร", () => {
    for (const t of targets) expect(BRANCH_NAMES.has(t), t).toBe(true);
  });

  it("ครบ 24 สาขาส่วนกลาง ไม่ซ้ำ (21 สาขานอกเขต 1)", () => {
    expect(new Set(targets).size).toBe(targets.length);
    const central = BRANCHES.filter((b) => b.division === "central").map((b) => b.branch);
    expect([...targets].sort()).toEqual([...central].sort());
    const zone1 = CENTRAL_REGISTRY_FILES_OCT26.find((f) => f.zone === "เขต 1")!;
    expect(targets.length - Object.keys(zone1.sheets).length).toBe(21);
  });

  it("สาขาอยู่ในเขตเดียวกับไฟล์", () => {
    for (const f of CENTRAL_REGISTRY_FILES_OCT26) {
      for (const t of Object.values(f.sheets)) {
        if (typeof t !== "string") continue;
        expect(BRANCHES.find((b) => b.branch === t)!.area).toBe(f.zone);
      }
    }
  });

  it("ชีทที่สะกดต่างจาก master จับคู่ตามตาราง · ลพบุรี = ข้าม · ชีทไม่รู้จัก = throw", () => {
    const z2 = CENTRAL_REGISTRY_FILES_OCT26.find((f) => f.zone === "เขต 2")!;
    const z9 = CENTRAL_REGISTRY_FILES_OCT26.find((f) => f.zone === "เขต 9")!;
    expect(resolveRegistrySheet(z2, "พระราม4")).toEqual({ kind: "branch", branch: "พระราม 4" });
    expect(resolveRegistrySheet(z9, "ลพบุรี")).toMatchObject({ kind: "skip", reason: expect.stringContaining("SPEC §6.5") });
    expect(() => resolveRegistrySheet(z2, "พระราม 4")).toThrow(/ไม่อยู่ในตาราง/);
    expect(() => resolveRegistrySheet(z2, "Sheet1")).toThrow(/ห้ามเดา/);
  });
});
