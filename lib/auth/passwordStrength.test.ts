import { describe, expect, it } from "vitest";

import { translatePasswordUpdateError } from "./passwordErrors";
import {
  PASSWORD_MIN_LENGTH,
  checkPasswordStrength,
  describePasswordIssues,
} from "./passwordStrength";

describe("checkPasswordStrength (DECISIONS 2.69)", () => {
  it("ขั้นต่ำคือ 8", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it("ผ่านเมื่อครบทุกข้อ", () => {
    expect(checkPasswordStrength("Abcdefg1")).toEqual([]);
  });

  it("ยาว 7 ไม่ผ่าน / ยาว 8 ผ่าน (ขอบเขต)", () => {
    expect(checkPasswordStrength("Abcdef1")).toEqual(["too_short"]);
    expect(checkPasswordStrength("Abcdefg1")).toEqual([]);
  });

  it("ไม่มีตัวพิมพ์ใหญ่", () => {
    expect(checkPasswordStrength("abcdefg1")).toEqual(["no_uppercase"]);
  });

  it("ไม่มีตัวพิมพ์เล็ก", () => {
    expect(checkPasswordStrength("ABCDEFG1")).toEqual(["no_lowercase"]);
  });

  it("ไม่มีตัวเลข", () => {
    expect(checkPasswordStrength("Abcdefgh")).toEqual(["no_digit"]);
  });

  it("รายงานทุกข้อที่ไม่ผ่านพร้อมกัน", () => {
    expect(checkPasswordStrength("")).toEqual([
      "too_short",
      "no_uppercase",
      "no_lowercase",
      "no_digit",
    ]);
  });

  it("ช่องว่างนับเป็นอักขระ (ไม่ตัดหัวท้าย) แต่ไม่ช่วยให้ครบเงื่อนไข", () => {
    expect(checkPasswordStrength("Ab1     ")).toEqual([]); // 8 ตัวรวมช่องว่าง
    expect(checkPasswordStrength("        ")).toEqual(["no_uppercase", "no_lowercase", "no_digit"]);
  });

  it("อักขระไทยนับความยาวได้ แต่ไม่นับเป็นตัวพิมพ์เล็ก/ใหญ่", () => {
    expect(checkPasswordStrength("สวัสดีAa1")).toEqual([]);
    expect(checkPasswordStrength("สวัสดีครับ1")).toEqual(["no_uppercase", "no_lowercase"]);
  });
});

describe("describePasswordIssues", () => {
  it("ผ่าน → null", () => {
    expect(describePasswordIssues([])).toBeNull();
  });
  it("บอกชัดว่าขาดอะไร", () => {
    const text = describePasswordIssues(["too_short", "no_uppercase", "no_digit"]);
    expect(text).toContain("ยาวอย่างน้อย 8 ตัวอักษร");
    expect(text).toContain("ตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว");
    expect(text).toContain("ตัวเลขอย่างน้อย 1 ตัว");
    expect(text).not.toContain("ตัวพิมพ์เล็ก");
  });
});

describe("translatePasswordUpdateError", () => {
  it("weak_password (ความยาว) → ข้อความไทย ไม่โชว์ข้อความดิบ", () => {
    const text = translatePasswordUpdateError({
      code: "weak_password",
      message: "Password should be at least 8 characters.",
      reasons: ["length"],
    });
    expect(text).toBe("รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร");
    expect(text).not.toMatch(/[A-Za-z]{4}/);
  });

  it("weak_password (ตัวอักษรไม่ครบ) → บอกกติกาครบ", () => {
    const text = translatePasswordUpdateError({
      code: "weak_password",
      message: "Password should contain at least one character of each",
      reasons: ["characters"],
    });
    expect(text).toContain("ตัวพิมพ์เล็ก");
    expect(text).toContain("ตัวพิมพ์ใหญ่");
    expect(text).toContain("ตัวเลข");
  });

  it("weak_password (pwned) → ข้อความรหัสรั่ว", () => {
    expect(
      translatePasswordUpdateError({ code: "weak_password", reasons: ["pwned"] }),
    ).toContain("รั่วไหล");
  });

  it("ไม่มี code แต่ข้อความเข้าข่าย weak → ยังแปลได้", () => {
    expect(
      translatePasswordUpdateError({ message: "Password should be at least 8 characters" }),
    ).toContain("รหัสผ่านใหม่");
  });

  it("same_password → ข้อความไทย", () => {
    expect(
      translatePasswordUpdateError({
        code: "same_password",
        message: "New password should be different from the old password.",
      }),
    ).toBe("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม");
  });

  it("error อื่น → ข้อความกลาง ไม่รั่วข้อความดิบ", () => {
    const text = translatePasswordUpdateError({ message: "Database error saving user" });
    expect(text).toContain("เปลี่ยนรหัสผ่านไม่สำเร็จ");
    expect(text).not.toContain("Database");
  });
});
