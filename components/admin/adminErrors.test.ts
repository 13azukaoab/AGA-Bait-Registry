import { describe, expect, it } from "vitest";

import { describeAdminError, failureFromDb, parseCounts } from "./adminErrors";

describe("describeAdminError", () => {
  const known = [
    "UNAUTHENTICATED", "FORBIDDEN", "PS001", "PS002", "PS003", "SELF_TARGET", "LAST_HOST", "NOT_FOUND", "INVALID_INPUT",
    "USERNAME_TAKEN", "BAD_CONFIRM", "UPSTREAM_ERROR", "TM001", "TM002", "TM003", "TM004", "TM005", "TM006", "CT001",
    "23505", "23503", "23514", "42501", "TR001", "TR002", "TR003", "TR004", "TR005", "WL001", "AS001",
  ];
  it("ทุกรหัสที่ใช้มีข้อความภาษาไทย (ไม่ตกไปข้อความกลาง)", () => {
    const generic = describeAdminError("ไม่รู้จัก");
    for (const code of known) {
      const text = describeAdminError(code);
      expect(text, code).toMatch(/[฀-๿]/);
      if (code !== "UPSTREAM_ERROR") expect(text, code).not.toBe(generic);
    }
  });
  it("รหัสแปลก = ข้อความกลาง (ไม่โชว์ข้อความดิบ)", () => {
    expect(describeAdminError("XX999", { message: "secret internal detail" })).not.toContain("secret");
  });
  it("TR002/TR005 ดึงเดือนจากข้อความด้วย pattern เข้มเท่านั้น", () => {
    expect(describeAdminError("TR002", { message: "จะกระทบเดือน 2026-10 ที่ปิดแล้ว" })).toContain("2026-10");
    expect(describeAdminError("TR005", { message: "ต้องเริ่มตั้งแต่ (2026-10)" })).toContain("2026-10");
    expect(describeAdminError("TR002", { message: "ไม่มีเดือน" })).not.toContain("undefined");
  });
  it("TM001/TM003 อ่านจำนวนจาก DETAIL JSON — รูปแบบแปลกไม่ใส่", () => {
    expect(describeAdminError("TM001", { detail: '{"contracts":3,"visits":0,"users":1}' })).toContain("สัญญา 3");
    expect(describeAdminError("TM001", { detail: '{"contracts":3,"visits":0,"users":1}' })).toContain("ผู้ใช้ 1");
    expect(describeAdminError("TM001", { detail: "ไม่ใช่ json" })).not.toContain("สัญญา");
    expect(parseCounts('{"a":-1}')).toBeNull();
    expect(parseCounts('{"a":"x"}')).toBeNull();
    expect(parseCounts('[1]')).toBeNull();
  });
});

describe("failureFromDb", () => {
  it("ใช้ code ของ DB · ไม่มี code = UPSTREAM_ERROR", () => {
    expect(failureFromDb({ code: "WL001", message: "x" })).toMatchObject({ ok: false, code: "WL001" });
    expect(failureFromDb({ message: "x" })).toMatchObject({ ok: false, code: "UPSTREAM_ERROR" });
  });
});
