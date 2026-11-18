import { describe, expect, it } from "vitest";

import {
  canDeactivate,
  flattenCodes,
  groupTypes,
  headcountLabel,
  moveGroup,
  moveItem,
  newTypeCode,
  normName,
  orderWithNewAtGroupEnd,
  parseHeadcount,
  validateTeam,
  validateType,
  validateWorkload,
  type CustomerTypeRow,
} from "./settingsLogic";

// ข้อมูลสมมติ
const TYPES: CustomerTypeRow[] = [
  { code: "a", label: "วัด", groupLabel: "ศาสนา", sortOrder: 1, isActive: true, hint: null },
  { code: "b", label: "โบสถ์", groupLabel: "ศาสนา", sortOrder: 2, isActive: true, hint: null },
  { code: "c", label: "ร้านอาหาร", groupLabel: "ธุรกิจ", sortOrder: 3, isActive: true, hint: null },
  { code: "d", label: "โรงแรม", groupLabel: "ธุรกิจ", sortOrder: 4, isActive: true, hint: null },
];

describe("validateWorkload", () => {
  it("ช่วง 0 < x ≤ 300 ทศนิยมไม่เกิน 2", () => {
    expect(validateWorkload(30)).toBeNull();
    expect(validateWorkload(0.01)).toBeNull();
    expect(validateWorkload(300)).toBeNull();
    expect(validateWorkload(0)).toBeTruthy();
    expect(validateWorkload(300.01)).toBeTruthy();
    expect(validateWorkload(30.123)).toBeTruthy();
    expect(validateWorkload(null)).toBeTruthy();
  });
});

describe("ทีม", () => {
  it("headcount: 0–99 จำนวนเต็ม · 0 แสดง —", () => {
    expect(parseHeadcount("0")).toBe(0);
    expect(parseHeadcount(" 12 ")).toBe(12);
    expect(parseHeadcount("99")).toBe(99);
    expect(parseHeadcount("100")).toBeNull();
    expect(parseHeadcount("-1")).toBeNull();
    expect(parseHeadcount("1.5")).toBeNull();
    expect(parseHeadcount("")).toBeNull();
    expect(headcountLabel(0)).toBe("—");
    expect(headcountLabel(8)).toBe("8");
  });
  it("สร้างทีม: รหัส 1–4 ตัว ไม่ซ้ำแบบไม่สนตัวพิมพ์", () => {
    const ok = { code: "P", name: "ทีม P", kind: "service" as const, headcount: "3" };
    expect(validateTeam(ok, "create", ["A", "Sup"])).toEqual({});
    expect(validateTeam({ ...ok, code: "sup" }, "create", ["A", "Sup"]).code).toContain("มีอยู่แล้ว");
    expect(validateTeam({ ...ok, code: "ABCDE" }, "create", []).code).toBeTruthy();
    expect(validateTeam({ ...ok, code: "a-1" }, "create", []).code).toBeTruthy();
  });
  it("แก้ไขไม่ตรวจรหัส · ต้องมีชื่อ ประเภท และจำนวนคน", () => {
    expect(validateTeam({ code: "", name: "x", kind: "install", headcount: "0" }, "edit", [])).toEqual({});
    const e = validateTeam({ code: "", name: " ", kind: "", headcount: "x" }, "edit", []);
    expect(Object.keys(e).sort()).toEqual(["headcount", "kind", "name"]);
  });
  it("ทีมระบบปิดไม่ได้", () => {
    expect(canDeactivate({ isSystem: true })).toBe(false);
    expect(canDeactivate({ isSystem: false })).toBe(true);
  });
});

describe("ประเภทลูกค้า", () => {
  it("จัดกลุ่มตามลำดับ + flatten", () => {
    const g = groupTypes(TYPES);
    expect(g.map((x) => x.label)).toEqual(["ศาสนา", "ธุรกิจ"]);
    expect(flattenCodes(g)).toEqual(["a", "b", "c", "d"]);
  });
  it("sort_order สลับกันหมวดก็ยังจัดตามลำดับสมาชิกแรก", () => {
    const g = groupTypes([
      { code: "x", label: "X", groupLabel: "G2", sortOrder: 1, isActive: true, hint: null },
      { code: "y", label: "Y", groupLabel: "G1", sortOrder: 2, isActive: true, hint: null },
      { code: "z", label: "Z", groupLabel: "G2", sortOrder: 3, isActive: true, hint: null },
    ]);
    expect(g.map((x) => [x.label, x.items.map((i) => i.code)])).toEqual([["G2", ["x", "z"]], ["G1", ["y"]]]);
  });
  it("ย้ายประเภท/หมวด · ชนขอบไม่เปลี่ยน · ไม่แก้อาร์เรย์เดิม", () => {
    const g = groupTypes(TYPES);
    expect(flattenCodes(moveItem(g, 0, 1, -1))).toEqual(["b", "a", "c", "d"]);
    expect(flattenCodes(moveItem(g, 0, 0, -1))).toEqual(["a", "b", "c", "d"]);
    expect(flattenCodes(moveGroup(g, 0, 1))).toEqual(["c", "d", "a", "b"]);
    expect(flattenCodes(moveGroup(g, 1, 1))).toEqual(["a", "b", "c", "d"]);
    expect(flattenCodes(g)).toEqual(["a", "b", "c", "d"]);
  });
  it("ชื่อซ้ำไม่สนเว้นวรรค/ตัวพิมพ์ (ยกเว้นตัวเอง)", () => {
    expect(normName(" โรง แรม ")).toBe("โรงแรม");
    expect(validateType({ label: "โรง แรม", group: "ธุรกิจ" }, TYPES).label).toBeTruthy();
    expect(validateType({ label: "โรงแรม", group: "ธุรกิจ" }, TYPES, "d")).toEqual({});
    expect(validateType({ label: " ", group: "" }, TYPES)).toEqual({ label: expect.any(String), group: expect.any(String) });
  });
  it("รหัสใหม่ไม่ซ้ำและเข้ารูป ct_xxxxxxxx", () => {
    expect(newTypeCode(["a"])).toMatch(/^ct_[0-9a-f]{8}$/);
    let n = 0;
    const seq = () => (n++ < 8 ? 0 : 0.99); // รอบแรกได้ ct_00000000 ซ้ำ → สุ่มใหม่
    expect(newTypeCode(["ct_00000000"], seq)).toBe("ct_ffffffff");
  });
  it("ประเภทใหม่ต่อท้ายหมวด · หมวดใหม่ต่อท้ายสุด", () => {
    const g = groupTypes(TYPES);
    expect(orderWithNewAtGroupEnd(g, "n", "ศาสนา")).toEqual(["a", "b", "n", "c", "d"]);
    expect(orderWithNewAtGroupEnd(g, "n", "ใหม่")).toEqual(["a", "b", "c", "d", "n"]);
  });
});
