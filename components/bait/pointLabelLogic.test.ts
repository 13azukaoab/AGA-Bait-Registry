import { describe, expect, it } from "vitest";

import { agPointFromStation } from "@/components/service/formState";
import type { ContractDetail, StationRow } from "@/components/service/types";

import { newBaitForm } from "./baitLogic";
import {
  applyPointLabel,
  canEditPointLabel,
  editablePointLabelStations,
  isPointLabelDirty,
  labelLength,
  planPointLabelEdit,
  POINT_LABEL_MAX,
} from "./pointLabelLogic";

const st = (id: string, no: number, over: Partial<StationRow> = {}): StationRow => ({
  id,
  type: "AG",
  no,
  status: "active",
  pointLabel: "",
  installBaitG: null,
  installedAt: null,
  ...over,
});

describe("canEditPointLabel — บทบาท × ชนิด × สถานะ", () => {
  it("host / recorder + AG + active / pending_removal = แก้ได้", () => {
    for (const role of ["host", "recorder"] as const) {
      expect(canEditPointLabel(role, st("a", 1))).toBe(true);
      expect(canEditPointLabel(role, st("a", 1, { status: "pending_removal" }))).toBe(true);
    }
  });

  it("admin / viewer / ไม่มีบทบาท = ไม่เห็นปุ่ม", () => {
    expect(canEditPointLabel("admin", st("a", 1))).toBe(false);
    expect(canEditPointLabel("viewer", st("a", 1))).toBe(false);
    expect(canEditPointLabel(null, st("a", 1))).toBe(false);
    expect(canEditPointLabel(undefined, st("a", 1))).toBe(false);
  });

  it("ไม่ใช่ AG = แก้ไม่ได้ (SV012)", () => {
    expect(canEditPointLabel("host", st("a", 1, { type: "IG" }))).toBe(false);
    expect(canEditPointLabel("host", st("a", 1, { type: "IC" }))).toBe(false);
  });

  it("ถอด / กำจัด / หาย / ถอนแล้ว = แก้ไม่ได้ (SV013)", () => {
    for (const status of ["removed", "eliminated", "lost", "withdrawn"] as const) {
      expect(canEditPointLabel("host", st("a", 1, { status }))).toBe(false);
    }
  });

  it("editablePointLabelStations กรอง + เรียงตามเลขจุด", () => {
    const list = [st("c", 3), st("x", 2, { status: "removed" }), st("a", 1), st("i", 4, { type: "IG" })];
    expect(editablePointLabelStations("recorder", list).map((s) => s.id)).toEqual(["a", "c"]);
    expect(editablePointLabelStations("admin", list)).toEqual([]);
  });
});

describe("planPointLabelEdit", () => {
  it("ตัดช่องว่างหน้า-หลังก่อนบันทึก", () => {
    expect(planPointLabelEdit("  ห้องนอน  ", "")).toEqual({ kind: "save", value: "ห้องนอน", needsConfirm: false });
  });

  it("เท่าเดิม (หลังตัดช่องว่าง) = ไม่ต้องเรียก RPC", () => {
    expect(planPointLabelEdit(" ห้องนอน ", "ห้องนอน")).toEqual({ kind: "unchanged" });
    expect(planPointLabelEdit("", "")).toEqual({ kind: "unchanged" });
    expect(planPointLabelEdit("   ", "")).toEqual({ kind: "unchanged" });
  });

  it("ค่าว่าง/มีแต่ช่องว่าง ขณะที่มีชื่อเดิม = ลบชื่อจุด และต้องยืนยัน", () => {
    expect(planPointLabelEdit("", "ห้องนอน")).toEqual({ kind: "save", value: null, needsConfirm: true });
    expect(planPointLabelEdit("   ", "ห้องนอน")).toEqual({ kind: "save", value: null, needsConfirm: true });
  });

  it("40 ตัวอักษรพอดี ผ่าน · 41 ไม่ผ่าน (นับหลังตัดช่องว่าง)", () => {
    const ok = "ก".repeat(POINT_LABEL_MAX);
    expect(planPointLabelEdit(`  ${ok}  `, "")).toEqual({ kind: "save", value: ok, needsConfirm: false });
    const r = planPointLabelEdit("ก".repeat(POINT_LABEL_MAX + 1), "");
    expect(r.kind).toBe("invalid");
    if (r.kind === "invalid") expect(r.message).toContain("40");
  });

  it("นับแบบ code point ตรงกับ char_length ของ DB", () => {
    expect(labelLength("😀".repeat(3))).toBe(3);
    expect(labelLength("ห้องนอน")).toBe(7);
  });

  it("isPointLabelDirty เทียบหลังตัดช่องว่าง", () => {
    expect(isPointLabelDirty(" a ", "a")).toBe(false);
    expect(isPointLabelDirty("b", "a")).toBe(true);
    expect(isPointLabelDirty("", "")).toBe(false);
  });
});

describe("applyPointLabel", () => {
  const stations = [st("a1", 1, { pointLabel: "เดิม" }), st("a2", 2)];
  const detail: ContractDetail = {
    contractId: "c1",
    stations,
    stationsTruncated: false,
    oldStations: [],
    visitsInMonth: [],
    lastTeamIds: [],
    agHistory: [],
  };
  const form = newBaitForm(detail, "00000000-0000-4000-8000-000000000001", "2026-11-20", []);

  it("อัปเดตชื่อในรายละเอียดสัญญา + ฟอร์ม (จุดอื่นไม่ถูกแตะ)", () => {
    const r = applyPointLabel(detail, form, "a1", "ห้องครัว");
    expect(r.detail.stations.map((s) => s.pointLabel)).toEqual(["ห้องครัว", ""]);
    expect(r.form.ag.find((p) => p.stationId === "a1")).toMatchObject({ label: "ห้องครัว", labelDb: "ห้องครัว" });
    expect(r.form.ag.find((p) => p.stationId === "a2")).toMatchObject({ label: "", labelDb: "" });
  });

  it("ลบชื่อ (null) = ว่าง", () => {
    const r = applyPointLabel(detail, form, "a1", null);
    expect(r.detail.stations[0]?.pointLabel).toBe("");
    expect(r.form.ag[0]).toMatchObject({ label: "", labelDb: "" });
  });

  it("ไม่ทับชื่อที่ผู้ใช้พิมพ์ค้างในฟอร์มบันทึกการเข้า แต่ labelDb เป็นค่าใหม่", () => {
    const typed = { ...form, ag: form.ag.map((p) => (p.stationId === "a1" ? { ...p, label: "พิมพ์ค้าง" } : p)) };
    const r = applyPointLabel(detail, typed, "a1", "ห้องครัว");
    expect(r.form.ag[0]).toMatchObject({ label: "พิมพ์ค้าง", labelDb: "ห้องครัว" });
  });

  it("agPointFromStation ยังอ่านชื่อเดิมถูก (กันโครงเปลี่ยน)", () => {
    expect(agPointFromStation(stations[0]!)).toMatchObject({ label: "เดิม", labelDb: "เดิม" });
  });
});
