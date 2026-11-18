/**
 * เทส pure function ของ M38: คำอธิบายประเภท (hint) · ประเภทที่เลือกได้ · ผลกระทบเกณฑ์ Tier · ข้อความ CT002/TR006
 * (ข้อมูลสมมติ)
 */
import { describe, expect, it } from "vitest";

import { describeAdminError } from "@/components/admin/adminErrors";
import { mergeReadStatus, parseReadStatusRows } from "@/components/admin/userLogic";
import { describeDbError } from "@/components/customers-new/errors";

import { hintLength, normalizeHint, selectableTypes, validateType } from "./settingsLogic";
import { parseImpactRows, summarizeImpact } from "./tierLogic";

describe("คำอธิบายประเภท (hint)", () => {
  it("normalizeHint: ว่าง/ช่องว่างล้วน → null · 120 ผ่าน · 121 ไม่ผ่าน · ตัดช่องว่างหัวท้าย", () => {
    expect(normalizeHint("")).toEqual({ ok: true, value: null });
    expect(normalizeHint("   ")).toEqual({ ok: true, value: null });
    expect(normalizeHint(" วัด ")).toEqual({ ok: true, value: "วัด" });
    expect(normalizeHint("ก".repeat(120)).ok).toBe(true);
    expect(normalizeHint("ก".repeat(121)).ok).toBe(false);
  });
  it("hintLength นับเป็น code point", () => {
    expect(hintLength("กขค")).toBe(3);
    expect(hintLength("😀")).toBe(1);
  });
  it("validateType แจ้ง hint ยาวเกิน", () => {
    expect(validateType({ label: "ใหม่", group: "G", hint: "ก".repeat(121) }, []).hint).toBeTruthy();
    expect(validateType({ label: "ใหม่", group: "G", hint: "ok" }, []).hint).toBeUndefined();
  });
});

describe("selectableTypes", () => {
  const rows = [
    { code: "a", isActive: true },
    { code: "b", isActive: false },
    { code: "c", isActive: false },
  ];
  it("เฉพาะที่ใช้งาน + ประเภทที่เลือกอยู่ (แม้ปิดใช้)", () => {
    expect(selectableTypes(rows, null).map((r) => r.code)).toEqual(["a"]);
    expect(selectableTypes(rows, "b").map((r) => r.code)).toEqual(["a", "b"]);
    expect(selectableTypes(rows, undefined).map((r) => r.code)).toEqual(["a"]);
  });
});

describe("ผลกระทบเกณฑ์ Tier", () => {
  const raw = [
    { from_tier: "S", to_tier: "S", term_group: "1", contract_count: 10 },
    { from_tier: "M", to_tier: "S", term_group: "1", contract_count: 2 },
    { from_tier: "M", to_tier: "S", term_group: "3", contract_count: 1 },
    { from_tier: "L", to_tier: "M", term_group: "1", contract_count: 3 },
  ];
  it("parseImpactRows: ถูกต้อง / รูปแบบแปลก = null", () => {
    expect(parseImpactRows(raw)).toHaveLength(4);
    expect(parseImpactRows(30)).toBeNull();
    expect(parseImpactRows([{ ...raw[0], from_tier: "Z" }])).toBeNull();
    expect(parseImpactRows([{ ...raw[0], term_group: "2" }])).toBeNull();
    expect(parseImpactRows([{ ...raw[0], contract_count: -1 }])).toBeNull();
    expect(parseImpactRows([null])).toBeNull();
    expect(parseImpactRows([])).toEqual([]);
  });
  it("summarizeImpact: ก่อน/หลังต่อ Tier + คู่ที่ย้ายแยก 1 ปี/3 ปี", () => {
    const s = summarizeImpact(parseImpactRows(raw)!);
    expect(s.total).toBe(16);
    expect(s.moved).toBe(6);
    expect(s.perTier).toEqual([
      { tier: "S", before: 10, after: 13, diff: 3 },
      { tier: "M", before: 3, after: 3, diff: 0 },
      { tier: "L", before: 3, after: 0, diff: -3 },
      { tier: "XL", before: 0, after: 0, diff: 0 },
    ]);
    expect(s.moves).toEqual([
      { from: "M", to: "S", y1: 2, y3: 1, total: 3 },
      { from: "L", to: "M", y1: 3, y3: 0, total: 3 },
    ]);
  });
  it("ไม่มีแถว = ไม่มีสัญญาย้าย", () => {
    expect(summarizeImpact([])).toMatchObject({ total: 0, moved: 0, moves: [] });
  });
});

describe("ข้อความ error ภาษาไทย", () => {
  it("CT002 (หน้าตั้งค่า + หน้าเปิดงาน) / TR006", () => {
    expect(describeAdminError("CT002")).toContain("ปิดใช้งานแล้ว");
    expect(describeDbError({ code: "CT002" })).toContain("ปิดใช้งานแล้ว");
    expect(describeAdminError("TR006")).toContain("คำนวณผลกระทบไม่ได้");
  });
});

describe("สถานะอ่านแจ้งเตือน (รอแจ้งผู้ใช้)", () => {
  const rows = [
    { user_id: "u1", has_unread_position_change: true, unread_count: 2, oldest_unread_at: "2026-11-15T03:00:00Z" },
    { user_id: "u2", has_unread_position_change: false, unread_count: 0, oldest_unread_at: null },
  ];
  it("parseReadStatusRows: ถูกต้อง/แปลก", () => {
    expect(parseReadStatusRows(rows)).toHaveLength(2);
    expect(parseReadStatusRows("x")).toBeNull();
    expect(parseReadStatusRows([{ ...rows[0], user_id: 1 }])).toBeNull();
    expect(parseReadStatusRows([{ ...rows[0], unread_count: -1 }])).toBeNull();
  });
  it("mergeReadStatus: ผนวกตาม userId · ไม่มีในผลลัพธ์ = ไม่แตะ", () => {
    const base = {
      username: "a",
      displayName: null,
      positionCode: null,
      role: "admin" as const,
      isActive: true,
      mustChangePassword: false,
      lastLogin: null,
    };
    const out = mergeReadStatus(
      [
        { ...base, userId: "u1" },
        { ...base, userId: "u2" },
        { ...base, userId: "u3" },
      ],
      parseReadStatusRows(rows)!,
    );
    expect(out[0]).toMatchObject({ hasUnreadPositionChange: true, unreadCount: 2 });
    expect(out[1]).toMatchObject({ hasUnreadPositionChange: false });
    expect(out[2]!.hasUnreadPositionChange).toBeUndefined();
  });
});
