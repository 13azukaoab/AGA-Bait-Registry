import { describe, expect, it } from "vitest";

import { canRecordService, describeTeamsByKind, isTeamKind, sortTeamsByKind } from "./teamKind";

describe("teamKind", () => {
  it("isTeamKind รับเฉพาะ 3 ประเภท", () => {
    expect(isTeamKind("service")).toBe(true);
    expect(isTeamKind("install")).toBe(true);
    expect(isTeamKind("supervisor")).toBe(true);
    expect(isTeamKind("A")).toBe(false);
    expect(isTeamKind(null)).toBe(false);
  });

  it("canRecordService: service/install ได้ · supervisor ไม่ได้ (ตรง SV006)", () => {
    expect(canRecordService("service")).toBe(true);
    expect(canRecordService("install")).toBe(true);
    expect(canRecordService("supervisor")).toBe(false);
  });

  it("sortTeamsByKind ไม่แก้อาร์เรย์เดิม", () => {
    const input = [
      { code: "Z", kind: "install" as const },
      { code: "A", kind: "service" as const },
    ];
    expect(sortTeamsByKind(input).map((t) => t.code)).toEqual(["A", "Z"]);
    expect(input.map((t) => t.code)).toEqual(["Z", "A"]);
  });

  it("describeTeamsByKind รวมรหัสตามประเภท · ข้ามประเภทที่ไม่มี · ทีมใหม่ปรากฏเอง", () => {
    expect(
      describeTeamsByKind([
        { code: "Z", kind: "install" },
        { code: "P", kind: "service" },
        { code: "A", kind: "service" },
        { code: "Sup", kind: "supervisor" },
      ]),
    ).toBe("ทีมบริการ A, P · ทีมติดตั้ง Z · ทีมหัวหน้างาน Sup");
    expect(describeTeamsByKind([{ code: "A", kind: "service" }])).toBe("ทีมบริการ A");
    expect(describeTeamsByKind([])).toBe("");
  });
});
