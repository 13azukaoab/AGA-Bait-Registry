import { describe, expect, it } from "vitest";

import { buildPayload } from "./buildPayload";
import { emptySetup } from "./setup";
import type { AgPointState, FindingRow, FormState, StationRow, WorkRow } from "./types";

const st = (id: string, type: StationRow["type"], no: number, status: StationRow["status"] = "active"): StationRow => ({
  id,
  type,
  no,
  status,
  pointLabel: "",
  installBaitG: null,
  installedAt: null,
});

const STATIONS: StationRow[] = [
  st("ig3", "IG", 3),
  st("ig5", "IG", 5),
  st("ic2", "IC", 2),
  st("ag1", "AG", 1),
  st("ag2", "AG", 2),
];

function baseForm(over: Partial<FormState> = {}): FormState {
  return {
    visitId: "00000000-0000-4000-8000-000000000001",
    isExisting: false,
    teamIds: ["tA", "tB", "tA"],
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
  };
}

const finding = (over: Partial<FindingRow>): FindingRow => ({
  key: "f1",
  type: "IG",
  noText: "3",
  group: "subterranean",
  baitSelect: "100",
  baitCustom: "",
  eaten: "50",
  powderText: "",
  ...over,
});

const agPoint = (over: Partial<AgPointState>): AgPointState => ({
  stationId: "ag1",
  no: 1,
  statusDb: "active",
  statusChoice: "active",
  label: "",
  labelDb: "",
  skip: false,
  baitSelect: "50",
  baitCustom: "",
  eaten: "",
  caste: "ทหาร",
  savedFollowUpNo: null,
  removedHere: false,
  removedNoCheck: false,
  ...over,
});

const work = (over: Partial<WorkRow>): WorkRow => ({
  id: "w1",
  kind: "cap_replaced",
  type: "IG",
  noText: "3, 5",
  detail: "",
  ...over,
});

function ok(form: FormState) {
  const r = buildPayload(form, "c1", STATIONS);
  if (!r.ok) throw new Error(r.error);
  return r.payload;
}

describe("buildPayload — หัวฟอร์ม", () => {
  it("ส่งเวลา HH:MM, ทีมไม่ซ้ำ, visit_id/contract_id", () => {
    const p = ok(baseForm());
    expect(p.start_time).toBe("09:30");
    expect(p.end_time).toBe("14:45");
    expect(p.team_ids).toEqual(["tA", "tB"]);
    expect(p.visit_id).toBe("00000000-0000-4000-8000-000000000001");
    expect(p.contract_id).toBe("c1");
    expect(p.visit_type).toBe("routine");
  });
});

describe("buildPayload — พบปลวก / เปลี่ยนไม้", () => {
  it("ปลวกใต้ดิน: มีเหยื่อ ไม่มีเคมีผง", () => {
    const p = ok(baseForm({ findings: [finding({})] }));
    expect(p.checks).toEqual([
      expect.objectContaining({
        station_id: "ig3",
        termite_group: "subterranean",
        bait_added_g: 100,
        bait_eaten_pct: 50,
        powder_points: null,
        timber_replaced: false,
      }),
    ]);
  });

  it("ปลวกสวน: เคมีผง ≥ 1 จุด และไม่มีเหยื่อ", () => {
    const p = ok(
      baseForm({ findings: [finding({ group: "garden", powderText: "4", baitSelect: "100", eaten: "25" })] }),
    );
    expect(p.checks[0]).toMatchObject({ termite_group: "garden", powder_points: 4, bait_added_g: null, bait_eaten_pct: null });
  });

  it("ปลวกสวนที่เคมีผง 0 จุด ถูกปฏิเสธ (ฐานข้อมูล CHECK powder_points > 0)", () => {
    const r = buildPayload(baseForm({ findings: [finding({ group: "garden", powderText: "0" })] }), "c1", STATIONS);
    expect(r.ok).toBe(false);
  });

  it("เหยื่อมากกว่า 200 พิมพ์เอง", () => {
    const p = ok(baseForm({ findings: [finding({ baitSelect: "other", baitCustom: "350" })] }));
    expect(p.checks[0]).toMatchObject({ bait_added_g: 350 });
  });

  it("สถานีเดียวกันอยู่ทั้งพบปลวกและเปลี่ยนไม้ → รวมเป็นแถวเดียว", () => {
    const p = ok(
      baseForm({
        findings: [finding({})],
        timbers: [{ key: "t1", type: "IG", noText: "3, 5" }],
      }),
    );
    expect(p.checks).toHaveLength(2);
    const ig3 = p.checks.find((c) => c.station_id === "ig3");
    expect(ig3).toMatchObject({ termite_group: "subterranean", bait_added_g: 100, timber_replaced: true });
    const ig5 = p.checks.find((c) => c.station_id === "ig5");
    expect(ig5).toMatchObject({ checked: true, timber_replaced: true, termite_group: null });
  });

  it("เลขสถานีที่ไม่มีที่ใช้งาน → error (ไม่ส่งเลขเดา)", () => {
    const r = buildPayload(baseForm({ findings: [finding({ noText: "99" })] }), "c1", STATIONS);
    expect(r.ok).toBe(false);
  });

  it("สถานีที่หาย/ถอนออกแล้ว (ไม่ใช่ใช้งาน) ไม่ถูกจับคู่", () => {
    const r = buildPayload(baseForm({ findings: [finding({ noText: "3" })] }), "c1", [st("ig3", "IG", 3, "lost")]);
    expect(r.ok).toBe(false);
  });
});

describe("buildPayload — กล่อง AG", () => {
  it("ผลตรวจ: ไม่พบปลวก = termite_caste null", () => {
    const p = ok(baseForm({ ag: [agPoint({ caste: "none" })] }));
    expect(p.checks[0]).toMatchObject({ station_id: "ag1", checked: true, termite_caste: null, bait_added_g: 50 });
  });

  it("ไม่ได้ตรวจจุดนี้ = checked:false ล้วนๆ", () => {
    const p = ok(baseForm({ ag: [agPoint({ skip: true, caste: "" , baitSelect: "" })] }));
    expect(p.checks).toEqual([{ station_id: "ag1", checked: false }]);
  });

  it("ข้ามทุกจุด = skip_all_ag และไม่ส่งแถว AG", () => {
    const p = ok(baseForm({ skipAllAg: true, ag: [agPoint({}), agPoint({ stationId: "ag2", no: 2 })] }));
    expect(p.skip_all_ag).toBe(true);
    expect(p.checks).toEqual([]);
  });

  it("จุด AG ที่ยังไม่กรอกครบ → error", () => {
    const r = buildPayload(baseForm({ ag: [agPoint({ caste: "" })] }), "c1", STATIONS);
    expect(r.ok).toBe(false);
  });

  it("สถานะส่งเฉพาะที่เปลี่ยน · ป้ายส่งเฉพาะที่เปลี่ยน", () => {
    const p = ok(
      baseForm({
        ag: [
          agPoint({ statusChoice: "pending_removal", label: "ห้องนอน" }),
          agPoint({ stationId: "ag2", no: 2, label: "เดิม", labelDb: "เดิม" }),
        ],
      }),
    );
    expect(p.station_statuses).toEqual([{ station_id: "ag1", status: "pending_removal" }]);
    expect(p.station_labels).toEqual([{ station_id: "ag1", point_label: "ห้องนอน" }]);
  });

  it("ถอดกล่อง + ผลตรวจ ส่งครั้งเดียว (M13)", () => {
    const p = ok(baseForm({ ag: [agPoint({ statusChoice: "removed" })] }));
    expect(p.station_statuses).toEqual([{ station_id: "ag1", status: "removed" }]);
    expect(p.checks).toHaveLength(1);
  });

  it("สถานะ locked (eliminated) ไม่ส่ง", () => {
    const p = ok(baseForm({ ag: [agPoint({ statusChoice: "locked", statusDb: "eliminated" })] }));
    expect(p.station_statuses).toEqual([]);
  });
});

describe("buildPayload — งานซ่อม", () => {
  it("ฝังใหม่ถูกเรียงหลังงานอื่น (หาย IG-5 แล้วฝัง IG-5 ใหม่)", () => {
    const p = ok(
      baseForm({
        works: [
          work({ id: "wa", kind: "added", noText: "5" }),
          work({ id: "wl", kind: "lost", noText: "5", detail: "หาย" }),
        ],
      }),
    );
    expect(p.works.map((w) => w.id)).toEqual(["wl", "wa"]);
  });

  it("ส่ง id เดิมและเลขที่แปลงแล้ว เรียงน้อยไปมาก ตัดซ้ำ", () => {
    const p = ok(baseForm({ works: [work({ id: "keep-me", noText: "8-10, 3, 3" })] }));
    expect(p.works[0]).toEqual({
      id: "keep-me",
      kind: "cap_replaced",
      station_type: "IG",
      station_nos: [3, 8, 9, 10],
      detail: null,
    });
  });

  it("รายละเอียดถูกตัดช่องว่าง", () => {
    const p = ok(baseForm({ works: [work({ kind: "lost", detail: "  หายไป  " })] }));
    expect(p.works[0]?.detail).toBe("หายไป");
  });

  it("เลขงานซ่อมอ่านไม่ได้ → error", () => {
    const r = buildPayload(baseForm({ works: [work({ noText: "abc" })] }), "c1", STATIONS);
    expect(r.ok).toBe(false);
  });
});

describe("กล่อง AG ใหม่ (S) — installs", () => {
  it("ส่ง installs ใน work ฝังใหม่ AG (เหยื่อ + ป้าย · ไม่มี % กิน) และไม่สร้างแถวผลตรวจ", () => {
    const p = ok(baseForm({ works: [work({ id: "s1", kind: "added", type: "AG", noText: "3", baitSelect: "100", label: " ห้องนอน " })] }));
    expect(p.works[0]).toEqual({
      id: "s1",
      kind: "added",
      station_type: "AG",
      station_nos: [3],
      detail: null,
      installs: [{ station_no: 3, bait_added_g: 100, point_label: "ห้องนอน" }],
    });
    expect(p.checks).toEqual([]);
  });
  it("หลายเลขในแถวเดียวใช้เหยื่อ/ป้ายเดียวกัน · ไม่กรอก = null", () => {
    const p = ok(baseForm({ works: [work({ kind: "added", type: "AG", noText: "3-4" })] }));
    expect(p.works[0]?.installs).toEqual([
      { station_no: 3, bait_added_g: null, point_label: null },
      { station_no: 4, bait_added_g: null, point_label: null },
    ]);
  });
  it("งานอื่น (ฝังใหม่ IG, ซ่อม) ไม่ส่ง installs (ฐานข้อมูลปฏิเสธ 22023)", () => {
    const p = ok(baseForm({ works: [work({ kind: "added", type: "IG", noText: "7" }), work({ id: "w2" })] }));
    expect(p.works.every((w) => !("installs" in w))).toBe(true);
  });
});
