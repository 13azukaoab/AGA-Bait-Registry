import { describe, it, expect } from "vitest";
import { BRANCHES, BRANCH_COUNT, BRANCH_NAMES } from "./branches";

describe("BRANCHES (SPEC §4)", () => {
  it("มีครบ 43 สาขา", () => {
    expect(BRANCH_COUNT).toBe(43);
    expect(BRANCHES).toHaveLength(43);
  });

  it("central 24 · province 19", () => {
    const central = BRANCHES.filter((b) => b.division === "central");
    const province = BRANCHES.filter((b) => b.division === "province");
    expect(central).toHaveLength(24);
    expect(province).toHaveLength(19);
  });

  it("ชื่อสาขาไม่ซ้ำ", () => {
    expect(BRANCH_NAMES.size).toBe(43);
  });

  it("เขต 9 คร่อม 2 หน่วยงาน (ปากช่อง/สระบุรี=central, ลพบุรี=province)", () => {
    const z9 = BRANCHES.filter((b) => b.area === "เขต 9");
    expect(z9.map((b) => b.branch)).toEqual(["ปากช่อง", "สระบุรี", "ลพบุรี"]);
    expect(z9.find((b) => b.branch === "ลพบุรี")?.division).toBe("province");
    expect(z9.find((b) => b.branch === "ปากช่อง")?.division).toBe("central");
  });

  it("สาขาแรกคือ พุทธมณฑล เขต 1 (ลำดับตาม SPEC §4)", () => {
    expect(BRANCHES[0]).toMatchObject({ area: "เขต 1", branch: "พุทธมณฑล" });
  });
});
