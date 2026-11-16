import { describe, expect, it } from "vitest";

import {
  assignableTeamIds,
  canRecordService,
  describeTeamsByKind,
  isTeamAssignableToContract,
  isTeamAssignableToVisit,
  isTeamKind,
  sortTeamsByKind,
  teamUnavailableNote,
  teamsForPicker,
} from "./teamKind";

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

/** ทีมตัวอย่าง: เปิด/ปิด × บริการ/ติดตั้ง/หัวหน้างาน */
const A = { id: "tA", code: "A", kind: "service" as const, isActive: true };
const Z = { id: "tZ", code: "Z", kind: "install" as const, isActive: true };
const OLD = { id: "tO", code: "O", kind: "service" as const, isActive: false };
const SUP = { id: "tS", code: "Sup", kind: "supervisor" as const, isActive: true };
const ALL = [A, Z, OLD, SUP];

describe("ทีมที่เลือกให้งานใหม่ได้ (M26/M33)", () => {
  it("สัญญา: เปิด + ไม่ใช่ supervisor เท่านั้น (ตรง TM004/TM005)", () => {
    expect(ALL.filter(isTeamAssignableToContract).map((t) => t.code)).toEqual(["A", "Z"]);
  });

  it("การเข้าบริการ: เปิด + service/install เท่านั้น (ตรง TM004 + SV006)", () => {
    expect(ALL.filter(isTeamAssignableToVisit).map((t) => t.code)).toEqual(["A", "Z"]);
  });

  it("supervisor ที่ปิดด้วย ก็เลือกไม่ได้", () => {
    expect(isTeamAssignableToContract({ kind: "supervisor", isActive: false })).toBe(false);
  });

  it("งานใหม่ (ยังไม่มีทีม): ทีมปิดและ Sup ไม่อยู่ในตัวเลือก", () => {
    expect(teamsForPicker(ALL, [], isTeamAssignableToContract).map((t) => t.code)).toEqual(["A", "Z"]);
    expect(teamsForPicker(ALL, [], isTeamAssignableToVisit).map((t) => t.code)).toEqual(["A", "Z"]);
  });

  it("งานเก่าที่มีทีมปิด + Sup อยู่แล้ว: ยังโชว์ชื่อทีมเดิมในตัวเลือก", () => {
    const value = [A.id, OLD.id, SUP.id];
    expect(teamsForPicker(ALL, value, isTeamAssignableToContract).map((t) => t.code)).toEqual(["A", "Z", "O", "Sup"]);
  });

  it("ติ๊กทีมเดิมออกแล้ว ทีมนั้นหายจากรายการ (เพิ่มกลับไม่ได้)", () => {
    const afterUntick = [A.id, SUP.id];
    expect(teamsForPicker(ALL, afterUntick, isTeamAssignableToContract).map((t) => t.code)).toEqual(["A", "Z", "Sup"]);
  });

  it("ป้ายอธิบาย: ปิดใช้งาน / หัวหน้างาน / ปกติ = null", () => {
    expect(teamUnavailableNote(OLD)).toBe("ปิดใช้งาน");
    expect(teamUnavailableNote(SUP)).toBe("หัวหน้างาน");
    expect(teamUnavailableNote(A)).toBeNull();
  });

  it("ค่าตั้งต้นของงานใหม่ (ทีมครั้งก่อน): ตัดทีมปิด/Sup/ไม่รู้จักออก คงลำดับเดิม", () => {
    const last = [Z.id, OLD.id, A.id, SUP.id, "tX"];
    expect(assignableTeamIds(last, ALL, isTeamAssignableToVisit)).toEqual([Z.id, A.id]);
  });
});
