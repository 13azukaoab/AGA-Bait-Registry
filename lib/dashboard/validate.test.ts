import { describe, it, expect } from "vitest";
import { buildDashboardData } from "./buildDashboardData";
import { assertValidDashboardData } from "./validate";
import { BRANCHES } from "./branches";
import type { DashboardData, DashboardRow } from "./types";

/** สร้างไฟล์ dashboard ครบ 43 สาขาสำหรับ 1 เดือน (ผ่าน builder — การันตีรูปแบบถูก) */
function fullMonth(): DashboardData {
  return buildDashboardData({ computed: { "2025-01": [] } });
}

describe("assertValidDashboardData (guard)", () => {
  it("ผ่านเมื่อไฟล์ถูกต้อง (ครบ 43 สาขา 16 ฟิลด์)", () => {
    expect(() => assertValidDashboardData(fullMonth())).not.toThrow();
  });

  it("throw เมื่อสาขาไม่ครบ 43", () => {
    const data = fullMonth();
    data["JAN.25"] = (data["JAN.25"] ?? []).slice(0, 10);
    expect(() => assertValidDashboardData(data)).toThrow(/43/);
  });

  it("throw เมื่อมีฟิลด์เกิน (เช่น value_annual หลุดเข้ามา)", () => {
    const data = fullMonth();
    const rows = data["JAN.25"] ?? [];
    const first = rows[0] as DashboardRow & { value_annual?: number };
    first.value_annual = 123;
    expect(() => assertValidDashboardData(data)).toThrow(/ฟิลด์/);
  });

  it("throw เมื่อชื่อสาขาไม่รู้จัก", () => {
    const data = fullMonth();
    const rows = data["JAN.25"] ?? [];
    if (rows[0]) rows[0].branch = "สาขาปลอม";
    expect(() => assertValidDashboardData(data)).toThrow(/ไม่รู้จัก/);
  });

  it("throw เมื่อสาขาซ้ำ (ชื่อซ้ำแต่จำนวนยังครบ 43)", () => {
    const data = fullMonth();
    const rows = data["JAN.25"] ?? [];
    if (rows[0] && rows[1]) rows[1].branch = rows[0].branch;
    expect(() => assertValidDashboardData(data)).toThrow(/ซ้ำ/);
  });

  it("ครอบคลุมครบ 43 ชื่อมาตรฐาน", () => {
    const data = fullMonth();
    const names = new Set((data["JAN.25"] ?? []).map((r) => r.branch));
    for (const b of BRANCHES) expect(names.has(b.branch)).toBe(true);
  });
});
