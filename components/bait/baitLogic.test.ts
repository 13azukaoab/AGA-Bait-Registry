import { describe, expect, it } from "vitest";

import { agPointFromStation } from "@/components/service/formState";
import type { AgPointState, ContractDetail, StationRow, WorkRow } from "@/components/service/types";

import { buildBaitPayload, isBaitPointTouched, newBaitForm, prepareBaitForm, summarizeBaitVisit, validateBait } from "./baitLogic";

const ag = (id: string, no: number, over: Partial<StationRow> = {}): StationRow => ({
  id,
  type: "AG",
  no,
  status: "active",
  pointLabel: "",
  installBaitG: null,
  installedAt: null,
  ...over,
});

const detailOf = (stations: StationRow[]): ContractDetail => ({
  contractId: "c1",
  stations,
  stationsTruncated: false,
  oldStations: [],
  visitsInMonth: [],
  lastTeamIds: ["tA"],
  agHistory: [],
});

const VID = "00000000-0000-4000-8000-000000000001";
const ctxOf = (stations: StationRow[]) => ({ stations, savedWorks: [], savedCheckKeys: new Set<string>() });

function formWith(stations: StationRow[], over: Partial<ReturnType<typeof newBaitForm>> = {}) {
  return { ...newBaitForm(detailOf(stations), VID, "2026-11-20", ["tA"]), timeIn: "09:00", timeOut: "10:00", ...over };
}
const withPoint = (form: ReturnType<typeof formWith>, no: number, patch: Partial<AgPointState>) => ({
  ...form,
  ag: form.ag.map((p) => (p.no === no ? { ...p, ...patch } : p)),
});

describe("newBaitForm / visit_type", () => {
  it("เริ่มด้วย follow_up และจุด F จากกล่องที่ใช้งานเท่านั้น", () => {
    const f = newBaitForm(detailOf([ag("a1", 1), ag("a2", 2, { status: "removed" }), ag("a3", 3, { status: "pending_removal" })]), VID, "", []);
    expect(f.visitType).toBe("follow_up");
    expect(f.ag.map((p) => p.no)).toEqual([1, 3]);
    expect(f.visitDate).toBe("");
  });
});

describe("จุดที่แตะ / ไม่แตะ", () => {
  it("ไม่กรอกอะไร = ไม่แตะ · กรอกเหยื่อ/สัดส่วน/การกิน หรือเปลี่ยนสถานะ = แตะ", () => {
    const p = agPointFromStation(ag("a1", 1));
    expect(isBaitPointTouched(p)).toBe(false);
    expect(isBaitPointTouched({ ...p, baitSelect: "50" })).toBe(true);
    expect(isBaitPointTouched({ ...p, caste: "none" })).toBe(true);
    expect(isBaitPointTouched({ ...p, eaten: "25" })).toBe(true);
    expect(isBaitPointTouched({ ...p, statusChoice: "pending_removal" })).toBe(true);
  });
});

describe("buildBaitPayload — กันลืมกล่อง (SV004)", () => {
  const stations = [ag("a1", 1), ag("a2", 2), ag("a3", 3)];

  it("จุดที่แตะส่งผล · จุดที่ไม่แตะส่ง checked:false · visit_type = follow_up", () => {
    const f = withPoint(formWith(stations), 2, { baitSelect: "100", caste: "ทหาร" });
    const r = buildBaitPayload(f, "c1", stations);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.visit_type).toBe("follow_up");
    expect(r.payload.skip_all_ag).toBe(false);
    expect(r.payload.checks).toEqual([
      { station_id: "a1", checked: false },
      expect.objectContaining({ station_id: "a2", checked: true, bait_added_g: 100, termite_caste: "ทหาร" }),
      { station_id: "a3", checked: false },
    ]);
  });

  it("เปลี่ยนสถานะเป็นรอถอด + ผลครบ → ส่งสถานะ · ไม่ส่ง F อัตโนมัติ (ฐานข้อมูลนับเอง)", () => {
    const f = withPoint(formWith(stations), 1, { baitSelect: "0", caste: "ปลวกตาย", statusChoice: "pending_removal" });
    const r = buildBaitPayload(f, "c1", stations);
    expect(r.ok && r.payload.station_statuses).toEqual([{ station_id: "a1", status: "pending_removal" }]);
    expect(JSON.stringify(r.ok && r.payload)).not.toContain("follow_up_no");
  });

  it("กล่องใหม่ (S) ส่ง installs (เหยื่อ + ป้าย) ไม่มีแถวผลตรวจของกล่องใหม่", () => {
    const w: WorkRow = {
      id: "00000000-0000-4000-8000-0000000000w1".replace("w1", "a1"),
      kind: "added",
      type: "AG",
      noText: "4",
      detail: "",
      baitSelect: "100",
      baitCustom: "",
      label: "ห้องนอน",
    };
    const r = buildBaitPayload({ ...formWith(stations), works: [w] }, "c1", stations);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.works[0]).toMatchObject({
      kind: "added",
      station_type: "AG",
      station_nos: [4],
      installs: [{ station_no: 4, bait_added_g: 100, point_label: "ห้องนอน" }],
    });
    expect(r.payload.checks.every((c) => c.checked === false)).toBe(true);
  });

  it("prepareBaitForm ไม่ผ่านค่า IG/IC/ปกติทั้งหมด จากฟอร์มอื่น", () => {
    const f = prepareBaitForm({ ...formWith(stations), normal: true, visitType: "routine" });
    expect(f.normal).toBe(false);
    expect(f.visitType).toBe("follow_up");
    expect(f.findings).toEqual([]);
  });
});

describe("validateBait", () => {
  const stations = [ag("a1", 1, { installedAt: "2026-11-10" }), ag("a2", 2)];

  it("ยังไม่ได้กรอกอะไรเลย = บันทึกไม่ได้", () => {
    const v = validateBait(formWith(stations), ctxOf(stations));
    expect(v.missing.map((m) => m.message).join("|")).toContain("ยังไม่ได้กรอกเลย");
  });

  it("จุดที่แตะแต่ไม่ครบ (ขาดสัดส่วนปลวก) = ยังไม่ครบ ระบุเลขจุด", () => {
    const f = withPoint(formWith(stations), 2, { baitSelect: "50" });
    const v = validateBait(f, ctxOf(stations));
    expect(v.missing.some((m) => m.message.includes("จุดที่ 2 ยังไม่ครบ"))).toBe(true);
  });

  it("ครบ + วันที่หลังวันติดตั้ง = ไม่มีข้อขาด", () => {
    const f = withPoint(formWith(stations), 1, { baitSelect: "50", caste: "none" });
    expect(validateBait(f, ctxOf(stations)).missing).toEqual([]);
  });

  it("วันที่เข้าอยู่ก่อนวันติดตั้ง (2.38 ก) = เตือน + บล็อก ระบุวันที่ติดตั้ง", () => {
    const f = withPoint({ ...formWith(stations), visitDate: "2026-11-05" }, 1, { baitSelect: "50", caste: "none" });
    const v = validateBait(f, ctxOf(stations));
    expect(v.order).toHaveLength(1);
    expect(v.order[0]).toContain("10/11/2026");
    expect(v.missing.length).toBeGreaterThan(0);
  });

  it("จุดที่ไม่ได้แตะไม่โดนเตือนวันก่อนติดตั้ง", () => {
    const f = withPoint({ ...formWith(stations), visitDate: "2026-11-05" }, 2, { baitSelect: "50", caste: "none" });
    expect(validateBait(f, ctxOf(stations)).order).toEqual([]);
  });

  it("กล่องใหม่ (S) ต้องเลือกเหยื่อที่ใส่ · เลขซ้ำกับกล่องเดิมไม่ได้", () => {
    const w: WorkRow = { id: "w-1", kind: "added", type: "AG", noText: "2", detail: "", baitSelect: "", baitCustom: "", label: "" };
    const v = validateBait({ ...formWith(stations), works: [w] }, ctxOf(stations));
    expect(v.works["w-1"]?.bait).toBeTruthy();
    expect(v.works["w-1"]?.no).toBeTruthy();
    expect(v.missing.length).toBeGreaterThan(0);
  });

  it("ไม่ตรวจเวลา/ทีม ก็บันทึกไม่ได้ (หัวฟอร์มเหมือน /service)", () => {
    const f = withPoint({ ...formWith(stations), teamIds: [], timeIn: "" }, 2, { baitSelect: "50", caste: "none" });
    const msgs = validateBait(f, ctxOf(stations)).missing.map((m) => m.message).join("|");
    expect(msgs).toContain("ทีมที่เข้า");
    expect(msgs).toContain("เวลาเข้า");
  });
});

describe("summarizeBaitVisit", () => {
  it("สรุป S และ F", () => {
    expect(
      summarizeBaitVisit({ installedNos: [5, 4], followUps: [{ no: 3, f: 2 }, { no: 1, f: 1 }, { no: 2, f: null }] }),
    ).toBe("ติดกล่องใหม่ (S) จุดที่ 4, 5 · ติดตามผล F1 จุดที่ 1, F2 จุดที่ 3");
    expect(summarizeBaitVisit({ installedNos: [], followUps: [] })).toBe("ไม่ได้ตรวจกล่องใด");
  });
});
