import { describe, expect, it } from "vitest";

import { baitToSelect, resolveBait, resolvePowder } from "./bait";
import { describeServiceError } from "./errors";
import { serviceTeams } from "./months";
import { searchContracts } from "./search";
import { buildInitPlan, emptySetup, parseCount } from "./setup";
import { baselineIndex, describeNumbers, inUseIndex, nextAgNumber } from "./stationIndex";
import type { AgPointState, FormState, StationRow, WorkRow, WorkRowDb } from "./types";
import { validateForm, type ValidationContext } from "./validate";

const st = (id: string, type: StationRow["type"], no: number, status: StationRow["status"] = "active"): StationRow => ({
  id,
  type,
  no,
  status,
  pointLabel: "",
  installBaitG: null,
  installedAt: null,
});

describe("bait", () => {
  it("รายการ 0–200 และ unset", () => {
    expect(resolveBait("", "")).toEqual({ status: "unset" });
    expect(resolveBait("150", "")).toEqual({ status: "ok", grams: 150 });
    expect(resolveBait("0", "")).toEqual({ status: "ok", grams: 0 });
  });
  it("พิมพ์เอง: > 200, หาร 50, ≤ 5000", () => {
    expect(resolveBait("other", "250")).toEqual({ status: "ok", grams: 250 });
    expect(resolveBait("other", "5000")).toEqual({ status: "ok", grams: 5000 });
    for (const bad of ["", "200", "260", "5050", "1.5", "abc", "-50"]) {
      expect(resolveBait("other", bad).status).toBe("invalid");
    }
  });
  it("แปลงค่าจากฐานข้อมูลกลับเป็นตัวเลือก", () => {
    expect(baitToSelect(100)).toEqual({ select: "100", custom: "" });
    expect(baitToSelect(300)).toEqual({ select: "other", custom: "300" });
    expect(baitToSelect(null)).toEqual({ select: "", custom: "" });
  });
  it("เคมีผง ≥ 1 จุด และกรัม = จุด × 0.3", () => {
    expect(resolvePowder("")).toEqual({ status: "unset" });
    expect(resolvePowder("0")).toEqual({ status: "invalid" });
    expect(resolvePowder("1.5")).toEqual({ status: "invalid" });
    expect(resolvePowder("10")).toEqual({ status: "ok", points: 10, grams: 3 });
  });
});

describe("errors", () => {
  it("แปล SV001–SV010 / AG004 / AG007 เป็นไทย ไม่ใช่บั๊กหน้าจอ", () => {
    for (const code of ["SV001", "SV002", "SV003", "SV004", "SV005", "SV006", "SV007", "SV008", "SV009", "SV010", "AG004", "AG007"]) {
      const r = describeServiceError({ code, message: "raw" });
      expect(r.isBug).toBe(false);
      expect(r.message).toMatch(/[ก-๙]/);
      expect(r.message).not.toBe("raw");
    }
  });
  it("22004/22023/23514/21000 = บั๊กหน้าจอ ข้อความทั่วไป ไม่โชว์ข้อความดิบ", () => {
    for (const code of ["22004", "22023", "23514", "21000"]) {
      const r = describeServiceError({ code, message: "secret raw text" });
      expect(r.isBug).toBe(true);
      expect(r.message).not.toContain("secret");
    }
  });
  it("42501 = ไม่มีสิทธิ์ · network = เชื่อมต่อไม่ได้", () => {
    expect(describeServiceError({ code: "42501" }).message).toContain("ไม่มีสิทธิ์");
    expect(describeServiceError({ message: "Failed to fetch" }).message).toContain("เชื่อมต่อ");
  });
  it("23505 เลขสถานีชนกัน = ข้อความเฉพาะ (ยัง log เป็นบั๊ก)", () => {
    const r = describeServiceError({ code: "23505", message: 'duplicate key value violates unique constraint "stations_in_use_no_key"' });
    expect(r.message).toContain("เลขสถานีซ้ำ");
    expect(r.isBug).toBe(true);
  });
  it("ไม่รู้จัก = ข้อความทั่วไป", () => {
    expect(describeServiceError({ code: "XX999" }).message).toContain("บันทึกไม่สำเร็จ");
  });
});

describe("search", () => {
  const list = [
    { customerName: "บริษัท สยามพารากอน จำกัด", contractNo: "NP-26/0012" },
    { customerName: "คุณสมชาย ใจดี", contractNo: "HH-26/0007" },
  ];
  it("ตรงตัวตามชื่อหรือเลขสัญญา (ตัดช่องว่าง/ขีด)", () => {
    expect(searchContracts(list, "สมชาย").items).toHaveLength(1);
    expect(searchContracts(list, "np 26 0012").items).toHaveLength(1);
    expect(searchContracts(list, "").items).toHaveLength(2);
  });
  it("ไม่พบตรงตัว → เสนอรายที่ใกล้เคียง (≥ 0.5)", () => {
    const r = searchContracts(list, "สมชาน");
    expect(r.items).toHaveLength(0);
    expect(r.suggestions.map((s) => s.contractNo)).toContain("HH-26/0007");
  });
  it("ไม่มีใกล้เคียงเลย → ว่างทั้งคู่", () => {
    const r = searchContracts(list, "zzzzzz");
    expect(r.items).toEqual([]);
    expect(r.suggestions).toEqual([]);
  });
});

describe("serviceTeams", () => {
  it("เหลือ A–O และ Z เรียง A–O ก่อน Z (ตัด Sup)", () => {
    const r = serviceTeams([{ code: "Z" }, { code: "Sup" }, { code: "B" }, { code: "A" }, { code: "P" }]);
    expect(r.map((t) => t.code)).toEqual(["A", "B", "Z"]);
  });
});

describe("setup", () => {
  it("parseCount", () => {
    expect(parseCount("")).toBe(0);
    expect(parseCount("80")).toBe(80);
    expect(parseCount("501")).toBeNull();
    expect(parseCount("-1")).toBeNull();
    expect(parseCount("1.5")).toBeNull();
  });
  it("ลูกค้าใหม่ → เลข 1..n แยกชนิด", () => {
    const plan = buildInitPlan({ ...emptySetup(), igCount: "3", icCount: "2" }, false, []);
    expect(plan.igNos).toEqual([1, 2, 3]);
    expect(plan.icNos).toEqual([1, 2]);
    expect(plan.transferIds).toEqual([]);
    expect(plan.total).toBe(5);
    expect(plan.errors).toEqual([]);
  });
  it("ลูกค้าใหม่ไม่กรอกจำนวนเลย = ผิด", () => {
    expect(buildInitPlan(emptySetup(), false, []).errors.length).toBe(1);
  });
  it("Renew: ย้ายสถานีที่ใช้งาน (เลขเดิม) ยกเว้นที่ติ๊กออก · เลขใหม่ต่อจากเลขสูงสุด ไม่ชน", () => {
    const old = [st("a", "IG", 1), st("b", "IG", 2), st("c", "IG", 9), st("d", "IC", 1), st("e", "AG", 1), st("x", "IG", 4, "lost")];
    const plan = buildInitPlan({ ...emptySetup(), excludedOldIds: ["b"], extraIg: "2", extraIc: "1" }, true, old);
    expect(plan.transferIds.sort()).toEqual(["a", "c", "d", "e"]);
    expect(plan.igNos).toEqual([10, 11]);
    expect(plan.icNos).toEqual([2]);
    expect(plan.index.IG.has(2)).toBe(false);
    expect(plan.index.AG.has(1)).toBe(true);
  });
  it("Renew: ไม่ย้ายและไม่เพิ่มเลย = ผิด", () => {
    const plan = buildInitPlan({ ...emptySetup(), excludedOldIds: ["a"] }, true, [st("a", "IG", 1)]);
    expect(plan.errors.length).toBe(1);
  });
});

describe("stationIndex", () => {
  it("นับเฉพาะสถานีที่ใช้งาน (เลขมีช่องว่างได้)", () => {
    const idx = inUseIndex([st("1", "IG", 1), st("2", "IG", 3), st("3", "IG", 2, "lost"), st("4", "AG", 1, "removed")]);
    expect([...idx.IG].sort()).toEqual([1, 3]);
    expect(idx.AG.size).toBe(0);
  });
  it("baseline: ตัดเลขที่การเข้านี้ฝังไว้ + คืนเลขที่การเข้านี้ทำให้หาย/ถอน", () => {
    const stations = [st("1", "IG", 1), st("2", "IG", 6), st("3", "IG", 3, "lost"), st("4", "IC", 2, "withdrawn")];
    const saved: WorkRowDb[] = [
      { id: "w1", kind: "added", stationType: "IG", stationNos: [6], detail: "" },
      { id: "w2", kind: "lost", stationType: "IG", stationNos: [3], detail: "x" },
      { id: "w3", kind: "withdrawn", stationType: "IC", stationNos: [2], detail: "" },
    ];
    const idx = baselineIndex(stations, saved);
    expect([...idx.IG].sort()).toEqual([1, 3]);
    expect([...idx.IC]).toEqual([2]);
  });
  it("เลข AG ถัดไป / ย่อเลข", () => {
    expect(nextAgNumber([st("a", "AG", 2), st("b", "AG", 5, "removed"), st("c", "IG", 99)])).toBe(6);
    expect(nextAgNumber([])).toBe(1);
    expect(describeNumbers([1, 2, 3, 5, 7, 8])).toBe("1-3, 5, 7-8");
  });
});

// ---------------- validateForm ----------------
const STATIONS: StationRow[] = [st("ig3", "IG", 3), st("ig5", "IG", 5), st("ic2", "IC", 2), st("ag1", "AG", 1), st("ag2", "AG", 2)];

function form(over: Partial<FormState> = {}): FormState {
  return {
    visitId: "v1",
    isExisting: false,
    teamIds: ["tA"],
    visitDate: "2026-11-12",
    timeIn: "09:30",
    timeOut: "10:30",
    visitType: "routine",
    normal: true,
    findings: [],
    timbers: [],
    works: [],
    ag: [],
    skipAllAg: false,
    setup: emptySetup(),
    ...over,
  };
}
const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  stations: STATIONS,
  savedWorks: [],
  needsSetup: false,
  plan: null,
  month: "2026-11",
  ...over,
});
const agp = (over: Partial<AgPointState>): AgPointState => ({
  stationId: "ag1",
  no: 1,
  statusDb: "active",
  statusChoice: "active",
  label: "",
  labelDb: "",
  skip: false,
  baitSelect: "",
  baitCustom: "",
  eaten: "",
  caste: "",
  savedFollowUpNo: null,
  removedHere: false,
  removedNoCheck: false,
  ...over,
});
const wk = (over: Partial<WorkRow>): WorkRow => ({ id: "w", kind: "cap_replaced", type: "IG", noText: "3", detail: "", ...over });

describe("validateForm — หัวฟอร์ม", () => {
  it("ฟอร์มปกติบันทึกได้ (ไม่บังคับระบุผล IG/IC)", () => {
    expect(validateForm(form(), ctx()).missing).toEqual([]);
  });
  it("ขาดทีม วันที่ เวลา", () => {
    const r = validateForm(form({ teamIds: [], visitDate: "", timeIn: "", timeOut: "" }), ctx());
    expect(r.missing.map((m) => m.field)).toEqual(["date", "teams", "timeIn", "timeOut"]);
    expect(r.header).toEqual({ date: true, teams: true, timeIn: true, timeOut: true });
  });
  it("เวลาออกไม่หลังเวลาเข้า / รูปแบบผิด", () => {
    expect(validateForm(form({ timeOut: "09:30" }), ctx()).missing[0]?.field).toBe("timeOut");
    expect(validateForm(form({ timeIn: "9:3" }), ctx()).missing[0]?.field).toBe("timeIn");
  });
  it("วันที่นอกเดือนที่เลือก = เตือน ไม่บล็อก", () => {
    const r = validateForm(form({ visitDate: "2026-10-30" }), ctx());
    expect(r.missing).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });
  it("ลูกค้ายังไม่ตั้งสถานี → ต้องมีแผนที่ถูกต้อง", () => {
    const plan = buildInitPlan(emptySetup(), false, []);
    expect(validateForm(form(), ctx({ needsSetup: true, plan })).missing.some((m) => m.field === "setup")).toBe(true);
    const good = buildInitPlan({ ...emptySetup(), igCount: "5" }, false, []);
    expect(validateForm(form(), ctx({ needsSetup: true, plan: good, stations: [] })).missing).toEqual([]);
  });
});

describe("validateForm — พบปลวก", () => {
  const f = (over = {}) => ({
    key: "f",
    type: "IG" as const,
    noText: "3",
    group: "subterranean" as const,
    baitSelect: "50" as const,
    baitCustom: "",
    eaten: "" as const,
    powderText: "",
    ...over,
  });
  it("แถวสมบูรณ์ผ่าน", () => {
    expect(validateForm(form({ findings: [f()] }), ctx()).missing).toEqual([]);
  });
  it("เลขที่ไม่มี / เลขซ้ำ / ไม่เลือกชนิดปลวก / ไม่มีเหยื่อ / สวนไม่มีเคมีผง", () => {
    expect(validateForm(form({ findings: [f({ noText: "99" })] }), ctx()).findings.f?.no).toContain("ไม่พบ");
    const dup = validateForm(form({ findings: [f({ key: "a" }), f({ key: "b" })] }), ctx());
    expect(dup.findings.b?.no).toContain("อยู่ในรายการแล้ว");
    expect(validateForm(form({ findings: [f({ group: "" })] }), ctx()).findings.f?.group).toBeTruthy();
    expect(validateForm(form({ findings: [f({ baitSelect: "" })] }), ctx()).findings.f?.bait).toBeTruthy();
    expect(validateForm(form({ findings: [f({ group: "garden", powderText: "0" })] }), ctx()).findings.f?.powder).toBeTruthy();
  });
  it("สถานีที่ฟอร์มเดียวกันสั่งหาย/ฝังใหม่ ลงผลตรวจไม่ได้", () => {
    const lost = validateForm(form({ works: [wk({ kind: "lost", noText: "3", detail: "x" })], findings: [f()] }), ctx());
    expect(lost.findings.f?.no).toContain("หาย");
    const added = validateForm(form({ works: [wk({ kind: "added", noText: "7" })], findings: [f({ noText: "7" })] }), ctx());
    expect(added.findings.f?.no).toBeTruthy();
  });
});

describe("validateForm — งานซ่อม/ฝังเพิ่ม", () => {
  it("เปลี่ยนฝา: เลขต้องมีอยู่จริง · หายต้องมีรายละเอียด · อื่นๆ ต้องมีรายละเอียด", () => {
    expect(validateForm(form({ works: [wk({ noText: "3, 5" })] }), ctx()).missing).toEqual([]);
    expect(validateForm(form({ works: [wk({ noText: "4" })] }), ctx()).works.w?.no).toContain("ไม่พบ");
    expect(validateForm(form({ works: [wk({ kind: "lost" })] }), ctx()).works.w?.detail).toBeTruthy();
    expect(validateForm(form({ works: [wk({ kind: "other" })] }), ctx()).works.w?.detail).toBeTruthy();
    expect(validateForm(form({ works: [wk({ noText: "" })] }), ctx()).works.w?.no).toBeTruthy();
  });
  it("ฝังใหม่: ใช้เลขช่องว่างได้ (ไม่ใช่ 1..max) แต่ห้ามชนสถานีที่ใช้งาน", () => {
    expect(validateForm(form({ works: [wk({ kind: "added", noText: "4" })] }), ctx()).missing).toEqual([]);
    expect(validateForm(form({ works: [wk({ kind: "added", noText: "5" })] }), ctx()).works.w?.no).toContain("ซ้ำ");
  });
  it("หาย IG-5 แล้วฝัง IG-5 ใหม่ในฟอร์มเดียวกัน ได้ (DECISIONS 2.20)", () => {
    const r = validateForm(
      form({ works: [wk({ id: "a", kind: "lost", noText: "5", detail: "หาย" }), wk({ id: "b", kind: "added", noText: "5" })] }),
      ctx(),
    );
    expect(r.missing).toEqual([]);
  });
  it("เลขซ้ำระหว่างแถวฝังใหม่ 2 แถว = ผิด", () => {
    const r = validateForm(form({ works: [wk({ id: "a", kind: "added", noText: "8-9" }), wk({ id: "b", kind: "added", noText: "9" })] }), ctx());
    expect(r.works.b?.no).toContain("ซ้ำ");
  });
  it("แก้การเข้าเดิม: งานที่บันทึกไว้แล้วไม่ชนตัวเอง (ฝังใหม่ IG-6 / หาย IG-3 เดิม)", () => {
    const stations = [st("1", "IG", 1), st("2", "IG", 6), st("3", "IG", 3, "lost")];
    const saved: WorkRowDb[] = [
      { id: "w1", kind: "added", stationType: "IG", stationNos: [6], detail: "" },
      { id: "w2", kind: "lost", stationType: "IG", stationNos: [3], detail: "x" },
    ];
    const r = validateForm(
      form({ works: [wk({ id: "w1", kind: "added", noText: "6" }), wk({ id: "w2", kind: "lost", noText: "3", detail: "x" })] }),
      ctx({ stations, savedWorks: saved }),
    );
    expect(r.missing).toEqual([]);
  });
});

describe("validateForm — กล่อง AG (D10)", () => {
  it("จุดค้างที่ยังไม่กรอก = ขาด · กรอกครบ/ไม่ได้ตรวจ/ข้ามทั้งหมด = ผ่าน", () => {
    const pts = [agp({}), agp({ stationId: "ag2", no: 2 })];
    expect(validateForm(form({ ag: pts }), ctx()).missing[0]?.message).toContain("1, 2");
    const done = [agp({ baitSelect: "50", caste: "none" }), agp({ stationId: "ag2", no: 2, skip: true })];
    expect(validateForm(form({ ag: done }), ctx()).missing).toEqual([]);
    expect(validateForm(form({ ag: pts, skipAllAg: true }), ctx()).missing).toEqual([]);
  });
  it("เหยื่อพิมพ์เองผิดกติกา = ขาด", () => {
    const r = validateForm(form({ ag: [agp({ baitSelect: "other", baitCustom: "260", caste: "ทหาร" })] }), ctx());
    expect(r.ag.ag1?.bait).toBeTruthy();
  });
});
