/**
 * เทสช่อง "ตรวจภายใน" (DECISIONS 2.93): แสดงเฉพาะ routine · payload ส่ง internal_inspection ถูกต้อง · ล้างเมื่อไม่ใช่ routine · โหลดค่าเดิมตอนแก้
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { INTERNAL_INSPECTION_KEY, buildPayload, internalInspectionToSend, showsInternalInspection } from "./buildPayload";
import { formFromVisit, newVisitForm } from "./formState";
import { emptySetup } from "./setup";
import type { ContractDetail, FormState, LoadedVisit } from "./types";
import { VisitHeader } from "./VisitHeader";

const detail: ContractDetail = {
  contractId: "c1",
  stations: [],
  stationsTruncated: false,
  oldStations: [],
  visitsInMonth: [],
  lastTeamIds: ["tA"],
  agHistory: [],
};

const form = (over: Partial<FormState> = {}): FormState => ({
  visitId: "00000000-0000-4000-8000-000000000001",
  isExisting: false,
  teamIds: ["tA"],
  visitDate: "2026-11-12",
  timeIn: "09:30",
  timeOut: "14:45",
  visitType: "routine",
  normal: false,
  findings: [],
  timbers: [],
  works: [],
  ag: [],
  skipAllAg: false,
  setup: emptySetup(),
  ...over,
});

const visit = (over: Partial<LoadedVisit> = {}): LoadedVisit => ({
  id: "00000000-0000-4000-8000-0000000000aa",
  visitDate: "2026-11-10",
  visitType: "routine",
  startTime: "09:00",
  endTime: "10:00",
  teamIds: ["tA"],
  checks: [],
  works: [],
  removedStationIds: [],
  ...over,
});

const html = (f: FormState) =>
  renderToStaticMarkup(
    createElement(VisitHeader, { form: f, teams: [], issues: { header: {} } as never, showIssues: false, teamHint: "", onChange: () => {} }),
  );

describe("ช่องติ๊ก 'ตรวจภายใน' แสดงตามประเภทการเข้า", () => {
  it("routine แสดงช่อง · problem / follow_up ไม่แสดง", () => {
    expect(showsInternalInspection("routine")).toBe(true);
    expect(showsInternalInspection("problem")).toBe(false);
    expect(showsInternalInspection("follow_up")).toBe(false);
    expect(html(form({ visitType: "routine" }))).toContain("sv-internal-inspection");
    expect(html(form({ visitType: "problem" }))).not.toContain("sv-internal-inspection");
    expect(html(form({ visitType: "follow_up" }))).not.toContain("sv-internal-inspection");
  });
  it("ติ๊กอยู่ = checked", () => {
    expect(html(form({ internalInspection: true }))).toMatch(/checked/);
    expect(html(form({ internalInspection: false }))).not.toMatch(/checked/);
  });
});

describe("payload save_service_visit", () => {
  const build = (f: FormState) => {
    const r = buildPayload(f, "c1", []);
    if (!r.ok) throw new Error(r.error);
    return r.payload;
  };
  it("ชื่อ key เป็นค่าคงที่ internal_inspection", () => {
    expect(INTERNAL_INSPECTION_KEY).toBe("internal_inspection");
  });
  it("routine: ส่ง true / false ตามที่ติ๊ก (ไม่ติ๊ก/ไม่มีค่า = false)", () => {
    expect(build(form({ internalInspection: true }))[INTERNAL_INSPECTION_KEY]).toBe(true);
    expect(build(form({ internalInspection: false }))[INTERNAL_INSPECTION_KEY]).toBe(false);
    expect(build(form())[INTERNAL_INSPECTION_KEY]).toBe(false);
  });
  it("สลับจาก routine เป็นแบบอื่น: ส่ง false ไม่ส่งค่าค้าง", () => {
    expect(build(form({ visitType: "problem", internalInspection: true }))[INTERNAL_INSPECTION_KEY]).toBe(false);
    expect(build(form({ visitType: "follow_up", internalInspection: true }))[INTERNAL_INSPECTION_KEY]).toBe(false);
    expect(internalInspectionToSend({ visitType: "problem", internalInspection: true })).toBe(false);
  });
  it("ข้อมูลอื่นใน payload ไม่เปลี่ยน", () => {
    const { internal_inspection: _omit, ...rest } = build(form({ internalInspection: true }));
    void _omit;
    expect(Object.keys(rest).sort()).toEqual(
      ["checks", "contract_id", "end_time", "skip_all_ag", "start_time", "station_labels", "station_statuses", "team_ids", "visit_date", "visit_id", "visit_type", "works"].sort(),
    );
  });
});

describe("ค่าเริ่มต้น / โหลดค่าเดิมตอนแก้", () => {
  it("การเข้าใหม่ = ไม่ติ๊ก", () => {
    expect(newVisitForm(detail, "2026-11", "2026-11-12").internalInspection).toBe(false);
  });
  it("แก้การเข้าเดิม: โหลดค่าเดิม (true → ติ๊ก · false/null/ไม่มี → ไม่ติ๊ก)", () => {
    expect(formFromVisit(detail, visit({ internalInspection: true })).internalInspection).toBe(true);
    expect(formFromVisit(detail, visit({ internalInspection: false })).internalInspection).toBe(false);
    expect(formFromVisit(detail, visit({ internalInspection: null })).internalInspection).toBe(false);
    expect(formFromVisit(detail, visit()).internalInspection).toBe(false);
  });
});

describe("M43: แก้การเข้าเดิมที่เปลี่ยนจาก routine เป็นแบบอื่น / follow_up จาก /bait", () => {
  const build = (f: FormState) => {
    const r = buildPayload(f, "c1", []);
    if (!r.ok) throw new Error(r.error);
    return r.payload;
  };
  it("โหลดการเข้า routine ที่ติ๊กไว้ แล้วเปลี่ยนเป็น problem → ส่ง false (กัน CHECK 23514)", () => {
    // หน้าจอไม่มีตัวเลือกเปลี่ยนประเภท แต่ทดสอบที่ตัวสร้าง payload ตามที่ฟอร์มเปลี่ยน visitType
    const loaded = formFromVisit(detail, visit({ visitType: "routine", internalInspection: true }));
    expect(build(loaded)[INTERNAL_INSPECTION_KEY]).toBe(true);
    expect(build({ ...loaded, visitType: "problem" })[INTERNAL_INSPECTION_KEY]).toBe(false);
    expect(build({ ...loaded, visitType: "follow_up" })[INTERNAL_INSPECTION_KEY]).toBe(false);
  });
  it("โหลดการเข้า problem ที่ค่าเดิมเป็น true (ข้อมูลเก่าผิดกฎ) → ส่ง false", () => {
    const loaded = formFromVisit(detail, visit({ visitType: "problem", internalInspection: true }));
    expect(build(loaded)[INTERNAL_INSPECTION_KEY]).toBe(false);
  });
  it("ฟอร์มแบบ /bait (follow_up ไม่มี field internalInspection) → ส่ง false ทั้งใหม่และแก้เดิม", () => {
    expect(build(form({ visitType: "follow_up" }))[INTERNAL_INSPECTION_KEY]).toBe(false);
    const loaded = formFromVisit(detail, visit({ visitType: "follow_up", internalInspection: null }));
    expect(build(loaded)[INTERNAL_INSPECTION_KEY]).toBe(false);
  });
});
