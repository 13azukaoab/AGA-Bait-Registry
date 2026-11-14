import { describe, expect, it } from "vitest";

import { buildPayload } from "./buildPayload";
import { contractMonthTag } from "./contractTag";
import { describeServiceError } from "./errors";
import { agPointFromStation, formFromVisit, isAgPointOff, statusLabel } from "./formState";
import type { ContractDetail, LoadedVisit, StationRow } from "./types";

const ag = (id: string, no: number, status: StationRow["status"] = "active"): StationRow => ({
  id,
  type: "AG",
  no,
  status,
  pointLabel: "",
  installBaitG: null,
  installedAt: null,
});

const detailOf = (stations: StationRow[]): ContractDetail => ({
  contractId: "c1",
  stations,
  stationsTruncated: false,
  oldStations: [],
  visitsInMonth: [],
  lastTeamIds: [],
  agHistory: [],
});

const visitOf = (over: Partial<LoadedVisit> = {}): LoadedVisit => ({
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

describe("contractMonthTag (DECISIONS 2.38 ค)", () => {
  it("เริ่มในเดือนที่เลือก: ไม่มี renewed_from = New", () => {
    expect(contractMonthTag("2026-11-03", null, "2026-11")).toBe("new");
  });
  it("เริ่มในเดือนที่เลือก: มี renewed_from = Renew", () => {
    expect(contractMonthTag("2026-11-30", "old-contract", "2026-11")).toBe("renew");
  });
  it("เริ่มคนละเดือน = ไม่มีป้าย (ทั้งก่อนและหลังเดือนที่เลือก)", () => {
    expect(contractMonthTag("2026-10-31", null, "2026-11")).toBeNull();
    expect(contractMonthTag("2026-12-01", "old", "2026-11")).toBeNull();
  });
});

describe("errors SV005 / SV010 (DECISIONS 2.25 / 2.27)", () => {
  it("SV010 บอกว่าสัญญา Renew แล้วลบ/ยกเลิกการถอดไม่ได้", () => {
    const r = describeServiceError({ code: "SV010", message: "raw" });
    expect(r.isBug).toBe(false);
    expect(r.message).toContain("Renew");
    expect(r.message).toContain("ยกเลิกการถอด");
  });
  it("SV005 ครอบคลุมการเข้าครั้งหลัง/เลื่อนวันข้ามการถอด", () => {
    const r = describeServiceError({ code: "SV005", message: "raw" });
    expect(r.isBug).toBe(false);
    expect(r.message).toContain("การเข้าบริการครั้งหลัง");
    expect(r.message).toContain("เลื่อนวันที่");
  });
});

describe("statusLabel (DECISIONS 2.34)", () => {
  it("ใช้คำ ติดตามผล / รอถอด / ถอดแล้ว และไม่มีคำเก่า", () => {
    const labels = [
      statusLabel("active", "active"),
      statusLabel("pending_removal", "pending_removal"),
      statusLabel("removed", "removed"),
      statusLabel("locked", "removed"),
      statusLabel("locked", "eliminated"),
    ];
    expect(labels).toEqual(["ติดตามผล", "รอถอด", "ถอดแล้ว", "ถอดแล้ว", "ไม่ใช้งาน"]);
    for (const l of labels) expect(l).not.toMatch(/กำจัดแล้ว|กำลังติดตาม|ติดตามต่อ|ถอดกล่อง/);
  });
});

describe("แก้การเข้าที่ถอดกล่อง AG — ยกเลิกการถอดได้เฉพาะกล่องที่การเข้านี้ถอด (DECISIONS 2.26)", () => {
  const stations = [ag("a1", 1, "removed"), ag("a2", 2, "removed"), ag("a3", 3)];

  it("กล่องที่การเข้านี้ถอด = เลือกสถานะได้ (ค่าเริ่มต้น ถอดแล้ว) · กล่องที่การเข้าอื่นถอด = ไม่แสดงในฟอร์ม", () => {
    const visit = visitOf({
      removedStationIds: ["a1"],
      checks: [
        {
          stationId: "a1",
          checked: true,
          termiteGroup: null,
          termiteCaste: "ปลวกตาย",
          baitAddedG: 50,
          baitEatenPct: null,
          powderPoints: null,
          timberReplaced: false,
          followUpNo: 2,
        },
      ],
    });
    const form = formFromVisit(detailOf(stations), visit);
    const byId = new Map(form.ag.map((p) => [p.stationId, p]));
    expect(byId.get("a1")).toMatchObject({ statusChoice: "removed", removedHere: true, removedNoCheck: false });
    expect(byId.has("a2")).toBe(false);
    expect(byId.get("a3")?.statusChoice).toBe("active");
  });

  it("ถอดโดยไม่มีผลตรวจ: ไม่ต้องกรอก และไม่ส่งแถวผลตรวจ (กัน SV001)", () => {
    const form = formFromVisit(detailOf([ag("a1", 1, "removed")]), visitOf({ removedStationIds: ["a1"] }));
    const p = form.ag[0];
    expect(p).toMatchObject({ removedHere: true, removedNoCheck: true, statusChoice: "removed" });
    expect(isAgPointOff(p!, false)).toBe(true);
    const r = buildPayload({ ...form, visitId: "00000000-0000-4000-8000-0000000000aa" }, "c1", []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.checks).toEqual([]);
      expect(r.payload.station_statuses).toEqual([]); // ยังเป็น removed = ไม่เปลี่ยน
    }
  });

  it("เปลี่ยนกลับเป็น ติดตามผล/รอถอด = ส่งสถานะใหม่ (ฐานข้อมูลย้อนค่าก่อนถอด) และต้องกรอกผลหรือติ๊กไม่ได้ตรวจ", () => {
    const form = formFromVisit(detailOf([ag("a1", 1, "removed")]), visitOf({ removedStationIds: ["a1"] }));
    const p = { ...form.ag[0]!, statusChoice: "active" as const, skip: true };
    expect(isAgPointOff(p, false)).toBe(true); // ติ๊ก ไม่ได้ตรวจ
    const r = buildPayload({ ...form, ag: [p] }, "c1", []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.station_statuses).toEqual([{ station_id: "a1", status: "active" }]);
      expect(r.payload.checks).toEqual([{ station_id: "a1", checked: false }]);
    }
    const open = { ...form.ag[0]!, statusChoice: "pending_removal" as const };
    expect(isAgPointOff(open, false)).toBe(false); // ต้องกรอกผล
  });

  it("จุดใหม่จากสถานี (ไม่ใช่การแก้) ตั้ง removedHere = false", () => {
    expect(agPointFromStation(ag("a3", 3))).toMatchObject({ removedHere: false, removedNoCheck: false });
  });
});
