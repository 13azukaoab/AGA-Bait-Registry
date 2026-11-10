import { describe, expect, it } from "vitest";

import {
  AGA_EMAIL_DOMAIN,
  emailForUsername,
  isValidUsername,
  normalizeUsername,
} from "./username";

describe("normalizeUsername", () => {
  it("ตัดช่องว่างหัวท้ายและแปลงเป็นตัวพิมพ์เล็ก", () => {
    expect(normalizeUsername("  Somsri.K  ")).toBe("somsri.k");
  });

  it("ค่าที่ถูกต้องอยู่แล้วไม่เปลี่ยน", () => {
    expect(normalizeUsername("nat.k_01-x")).toBe("nat.k_01-x");
  });

  it("ค่าว่างได้ค่าว่าง", () => {
    expect(normalizeUsername("   ")).toBe("");
  });
});

describe("isValidUsername", () => {
  it("รับตัวอักษรเล็ก ตัวเลข จุด ขีดล่าง ขีดกลาง", () => {
    expect(isValidUsername("nat.k_01-x")).toBe(true);
    expect(isValidUsername("abc")).toBe(true);
    expect(isValidUsername("a".repeat(20))).toBe(true);
  });

  it("ปฏิเสธความยาวนอกช่วง 3–20", () => {
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("a".repeat(21))).toBe(false);
    expect(isValidUsername("")).toBe(false);
  });

  it("ปฏิเสธตัวพิมพ์ใหญ่ ภาษาไทย ช่องว่าง และอักขระพิเศษ", () => {
    expect(isValidUsername("Nat1")).toBe(false);
    expect(isValidUsername("มานี")).toBe(false);
    expect(isValidUsername("nat k")).toBe(false);
    expect(isValidUsername("nat@aga")).toBe(false);
    expect(isValidUsername("nat+1")).toBe(false);
  });

  it("ปฏิเสธการแอบใส่อีเมลเต็ม", () => {
    expect(isValidUsername("somsri.k@aga.local")).toBe(false);
  });
});

describe("emailForUsername", () => {
  it("เติมโดเมน @aga.local ให้", () => {
    expect(emailForUsername("somsri.k")).toBe(`somsri.k@${AGA_EMAIL_DOMAIN}`);
    expect(emailForUsername("somsri.k")).toBe("somsri.k@aga.local");
  });

  it("โยน error เมื่อรูปแบบ username ไม่ถูกต้อง (กันค่าแปลกหลุดไปถึง Auth)", () => {
    expect(() => emailForUsername("ab")).toThrow();
    expect(() => emailForUsername("Nat1")).toThrow();
    expect(() => emailForUsername("somsri.k@aga.local")).toThrow();
  });
});
