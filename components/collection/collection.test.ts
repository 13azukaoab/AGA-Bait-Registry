import { describe, expect, it } from "vitest";

import { validateForm } from "./CollectDialog";
import { buildRow, type ContractDb, type IgMonthlyDb, type IgSummaryDb } from "./collectionData";
import { describeCollectError } from "./collectionErrors";
import {
  applyActionResult,
  canRecordRow,
  computeStats,
  effectiveEndDate,
  filterRows,
  finishMonthOf,
  igBase,
  isContractEnded,
  minActionDate,
  pickLastAction,
} from "./collectionRules";
import { buildCollectPayload, buildSkipPayload, collectIgStations, skipIgCollection } from "./collectionRpc";
import type { CollectionRow } from "./collectionTypes";

// ข้อมูลทดสอบสมมติทั้งหมด (ไม่ใช่ข้อมูลจริง)
function row(p: Partial<CollectionRow> = {}): CollectionRow {
  return {
    contractId: "c1",
    customerId: "u1",
    customerName: "ลูกค้าทดสอบ",
    branchName: "สาขาทดสอบ",
    division: "central",
    contractNo: "CT26-0000001",
    startDate: "2025-10-13",
    endDate: "2026-10-12",
    termMonths: 12,
    status: "active",
    closedAt: null,
    cancelledAt: null,
    igTotal: 10,
    collected: 4,
    notCollected: 0,
    moved: 0,
    remaining: 6,
    last: null,
    finishMonth: null,
    collectedThisMonth: 0,
    notCollectedThisMonth: 0,
    teamIds: [],
    ...p,
  };
}

describe("แปลง error → ข้อความไทย", () => {
  it.each(["SV011", "CL001", "CL002", "CL003", "CL004", "CL005", "AG004", "42501"])("%s มีข้อความไทย ไม่ใช่บั๊ก", (code) => {
    const e = describeCollectError({ code, message: "raw english message" });
    expect(e.message).toMatch(/[ก-๙]/);
    expect(e.message).not.toContain("raw english");
    expect(e.isBug).toBe(false);
    expect(e.logCode).toBe(code);
  });
  it("TM004 ใช้ข้อความทีม (มีรหัสทีมจาก DETAIL)", () => {
    const e = describeCollectError({ code: "TM004", details: "B" });
    expect(e.message).toContain("ทีม B");
    expect(e.isBug).toBe(false);
  });
  it("22023 = บั๊กหน้าจอ · ไม่โชว์ข้อความดิบ · log แค่ code", () => {
    const e = describeCollectError({ code: "22023", message: "invalid call secret-customer" });
    expect(e.isBug).toBe(true);
    expect(e.message).not.toContain("secret-customer");
    expect(e.logCode).toBe("22023");
  });
  it("RLS / 403 → ข้อความไม่มีสิทธิ์", () => {
    expect(describeCollectError({ message: "new row violates row-level security policy" }).message).toContain("ไม่มีสิทธิ์");
    expect(describeCollectError({ statusCode: 403 }).message).toContain("ไม่มีสิทธิ์");
  });
  it("เครือข่ายล่ม → ข้อความเชื่อมต่อ", () => {
    expect(describeCollectError({ message: "TypeError: Failed to fetch" }).message).toContain("เชื่อมต่อ");
  });
  it("รหัสไม่รู้จัก → ข้อความทั่วไป ไม่โชว์ดิบ", () => {
    const e = describeCollectError({ code: "XX999", message: "boom raw" });
    expect(e.message).not.toContain("boom");
    expect(e.isBug).toBe(true);
  });
});

describe("สิทธิ์ปุ่มตาม role", () => {
  it("host กดได้ทุกแถว", () => expect(canRecordRow("host", [], row({ division: "province" }))).toBe(true));
  it("recorder กดได้เฉพาะสาขาในขอบเขต", () => {
    expect(canRecordRow("recorder", ["central"], row({ division: "central" }))).toBe(true);
    expect(canRecordRow("recorder", ["central"], row({ division: "province" }))).toBe(false);
    expect(canRecordRow("recorder", [], row())).toBe(false);
  });
  it("admin / viewer ไม่มีปุ่ม", () => {
    expect(canRecordRow("admin", ["central", "province"], row())).toBe(false);
    expect(canRecordRow("viewer", ["central", "province"], row())).toBe(false);
  });
});

describe("payload ของ 2 RPC", () => {
  const input = { contractId: "c1", count: 3, date: "2026-11-10", teamId: "t1" };
  it("collect_ig_stations ส่ง p_station_nos เป็น null ชัดเจน", () => {
    expect(buildCollectPayload(input)).toEqual({ p_contract_id: "c1", p_count: 3, p_on: "2026-11-10", p_team_id: "t1", p_station_nos: null });
  });
  it("skip_ig_collection เพิ่ม p_reason (ตัดช่องว่าง)", () => {
    expect(buildSkipPayload(input, "  ฝังใต้คอนกรีต \n")).toEqual({
      p_contract_id: "c1",
      p_count: 3,
      p_on: "2026-11-10",
      p_team_id: "t1",
      p_station_nos: null,
      p_reason: "ฝังใต้คอนกรีต",
    });
  });
  it("เรียกชื่อ RPC ถูกตัว + ส่ง payload + แปลผล", async () => {
    const calls: { name: string; args: unknown }[] = [];
    const fake = {
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return { data: { count: 3, remaining: 2 }, error: null };
      },
    };
    const a = await collectIgStations(fake as never, input);
    const b = await skipIgCollection(fake as never, input, "เหตุผล");
    expect(calls.map((c) => c.name)).toEqual(["collect_ig_stations", "skip_ig_collection"]);
    expect(calls[0]?.args).toEqual(buildCollectPayload(input));
    expect(calls[1]?.args).toEqual(buildSkipPayload(input, "เหตุผล"));
    expect(a).toEqual({ ok: true, result: { count: 3, remaining: 2 } });
    expect(b.ok).toBe(true);
  });
  it("error จาก DB → ข้อความไทย (CL002)", async () => {
    const fake = { rpc: async () => ({ data: null, error: { code: "CL002", message: "raw" } }) };
    const r = await collectIgStations(fake as never, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("จำนวน");
  });
});

describe("กฎ 'หมดแล้ว' เหมือน CL001", () => {
  it("status ไม่ใช่ active = หมดแล้ว แม้วันจบยังไม่ถึง", () => {
    expect(isContractEnded("closed", "2027-01-01", "2026-11-20")).toBe(true);
    expect(isContractEnded("cancelled", "2027-01-01", "2026-11-20")).toBe(true);
    expect(isContractEnded("expired_pending_collection", "2027-01-01", "2026-11-20")).toBe(true);
  });
  it("active: วันจบ < วันนี้ = หมด · วันจบ = วันนี้ ยังไม่หมด", () => {
    expect(isContractEnded("active", "2026-11-19", "2026-11-20")).toBe(true);
    expect(isContractEnded("active", "2026-11-20", "2026-11-20")).toBe(false);
  });
  it("end_date ว่าง ใช้เริ่ม + N เดือน − 1 วัน (ชนปลายเดือน)", () => {
    expect(effectiveEndDate("2026-01-15", null, 12)).toBe("2027-01-14");
    expect(effectiveEndDate("2026-01-31", null, 1)).toBe("2026-02-28");
    expect(effectiveEndDate("2026-01-15", "2026-06-01", 12)).toBe("2026-06-01");
  });
});

describe("ช่วงวันที่ (ตรง CL005)", () => {
  it("เร็วสุด = วันถัดจากวันสิ้นสุด", () => expect(minActionDate(row())).toBe("2026-10-13"));
  it("ถ้ายกเลิก/ปิดเร็วกว่า ใช้วันนั้น (เวลาไทย)", () => {
    expect(minActionDate(row({ cancelledAt: "2026-06-30T20:00:00Z" }))).toBe("2026-07-01");
    expect(minActionDate(row({ closedAt: "2026-09-01T10:00:00Z" }))).toBe("2026-09-01");
  });
  it("ไม่ก่อนวันเริ่มสัญญา", () => {
    expect(minActionDate(row({ startDate: "2027-01-01", endDate: "2026-10-12", cancelledAt: "2026-06-01T00:00:00Z" }))).toBe("2027-01-01");
  });
});

describe("ตัวหาร IG / เดือนที่เสร็จ", () => {
  it("igBase ไม่นับ IG ที่ย้ายไปสัญญาใหม่ (2.50)", () => {
    const r = row({ igTotal: 10, moved: 3, collected: 4, notCollected: 1, remaining: 2 });
    expect(igBase(r)).toBe(7);
    expect(r.collected + r.notCollected + r.remaining).toBe(igBase(r));
  });
  it("finishMonthOf: ค้าง = null · เสร็จ = เดือนของวันล่าสุด", () => {
    expect(finishMonthOf(2, { date: "2026-11-05" })).toBeNull();
    expect(finishMonthOf(0, null)).toBeNull();
    expect(finishMonthOf(0, { date: "2026-11-05" })).toBe("2026-11");
  });
  it("pickLastAction: เลือกวันล่าสุด ข้าม moved_to_renewal · วันเดียวกัน 'ไม่เก็บ' ชนะ", () => {
    const last = pickLastAction([
      { kind: "collected", team_id: "t1", last_on: "2026-10-20", reasons: [] },
      { kind: "moved_to_renewal", team_id: null, last_on: "2026-11-30", reasons: [] },
      { kind: "not_collected", team_id: "t2", last_on: "2026-10-20", reasons: ["ฝังใต้คอนกรีต"] },
    ]);
    expect(last).toEqual({ date: "2026-10-20", kind: "not_collected", teamId: "t2", reasons: ["ฝังใต้คอนกรีต"] });
    expect(pickLastAction([])).toBeNull();
  });
});

describe("กรอง IG อย่างเดียว (buildRow จาก view)", () => {
  const contract: ContractDb = {
    id: "c1",
    contract_no: "CT26-1",
    customer_id: "u1",
    start_date: "2025-10-13",
    end_date: null,
    term_months: 12,
    status: "active",
    closed_at: null,
    cancelled_at: null,
    customers: { name: "ลูกค้าทดสอบ", branches: [{ name: "สาขา", division: "province" }] },
    contract_teams: [{ team_id: "t1" }],
  };
  const ig: IgSummaryDb = { contract_id: "c1", ig_total: 12, collected: 5, not_collected: 2, moved_to_renewal: 3, remaining: 2 };
  const monthly: IgMonthlyDb[] = [
    { contract_id: "c1", month: "2026-11-01", kind: "collected", team_id: "t1", stations: 5, last_on: "2026-11-03", reasons: [] },
    { contract_id: "c1", month: "2026-11-01", kind: "not_collected", team_id: "t1", stations: 2, last_on: "2026-11-04", reasons: ["เข้าไม่ถึง"] },
    { contract_id: "c1", month: "2026-11-01", kind: "moved_to_renewal", team_id: null, stations: 3, last_on: "2026-11-05", reasons: [] },
    { contract_id: "c1", month: "2026-09-01", kind: "collected", team_id: "t1", stations: 9, last_on: "2026-09-02", reasons: [] },
  ];
  it("ใช้ตัวเลข IG เท่านั้น · ย้ายไม่นับ · ยอดเดือนนี้นับเฉพาะเก็บ/ไม่เก็บของเดือนนั้น", () => {
    const r = buildRow(contract, ig, monthly, "2026-11");
    expect(r).not.toBeNull();
    expect(r?.endDate).toBe("2026-10-12"); // end_date ว่าง → เริ่ม + 12 เดือน − 1 วัน
    expect(r?.collectedThisMonth).toBe(5);
    expect(r?.notCollectedThisMonth).toBe(2);
    expect(r?.last).toMatchObject({ date: "2026-11-04", kind: "not_collected" });
    expect(r?.division).toBe("province");
    expect(r?.teamIds).toEqual(["t1"]);
    expect(r && igBase(r)).toBe(9);
    expect(r?.finishMonth).toBeNull(); // ยังค้าง 2
  });
  it("ไม่มีลูกค้า/สาขา → ข้าม (null)", () => {
    expect(buildRow({ ...contract, customers: null }, ig, monthly, "2026-11")).toBeNull();
  });
});

describe("ตัวกรอง + การ์ดสรุป", () => {
  const rows = [
    row({ contractId: "a", customerName: "ร้านเอ", contractNo: "CT-A", endDate: "2026-10-12", remaining: 6 }),
    row({ contractId: "b", customerName: "ร้านบี", contractNo: "CT-B", endDate: "2026-09-30", status: "closed", remaining: 0, collected: 10, finishMonth: "2026-11", collectedThisMonth: 10 }),
    row({ contractId: "c", customerName: "ร้านซี", contractNo: "CT-C", endDate: "2026-08-20", status: "closed", remaining: 0, collected: 7, notCollected: 3, finishMonth: "2026-10", notCollectedThisMonth: 0 }),
  ];
  const f = (o: Partial<Parameters<typeof filterRows>[1]>) => filterRows(rows, { month: { kind: "all" }, status: "all", query: "", currentMonth: "2026-11", ...o }).map((r) => r.contractId);
  it("สถานะ open = ค้าง + ปิดเรื่องเดือนนี้ (ซ่อนที่ปิดครบเดือนก่อน)", () => expect(f({ status: "open" })).toEqual(["a", "b"]));
  it("wait / done / skip", () => {
    expect(f({ status: "wait" })).toEqual(["a"]);
    expect(f({ status: "done" })).toEqual(["b"]);
    expect(f({ status: "skip" })).toEqual(["c"]);
  });
  it("กรองเดือน/ช่วง (ใส่กลับด้านสลับให้) + ค้นหา", () => {
    expect(f({ month: { kind: "month", month: "2026-09" } })).toEqual(["b"]);
    expect(f({ month: { kind: "range", from: "2026-10", to: "2026-08" } })).toEqual(["a", "b", "c"]);
    expect(f({ query: "ct-c" })).toEqual(["c"]);
    expect(f({ query: "บี" })).toEqual(["b"]);
  });
  it("การ์ดสรุปนับจากทุกแถว", () => {
    expect(computeStats(rows, "2026-11")).toEqual({
      customersDone: 1,
      customersSkip: 0,
      customersWait: 1,
      stationsCollectedMonth: 10,
      stationsSkippedMonth: 0,
      stationsRemaining: 6,
    });
  });
  it("applyActionResult: เก็บครบแล้วหายจาก 'ค้าง' และมีเดือนที่เสร็จ", () => {
    const next = applyActionResult(rows[0] as CollectionRow, { kind: "collected", count: 6, remaining: 0, date: "2026-11-10", teamId: "t1", reason: null }, "2026-11");
    expect(next.remaining).toBe(0);
    expect(next.collected).toBe(10);
    expect(next.finishMonth).toBe("2026-11");
    expect(next.collectedThisMonth).toBe(6);
    expect(next.last).toMatchObject({ date: "2026-11-10", kind: "collected" });
  });
  it("applyActionResult: ไม่เก็บ + เหตุผล", () => {
    const next = applyActionResult(rows[0] as CollectionRow, { kind: "not_collected", count: 2, remaining: 4, date: "2026-11-10", teamId: "t1", reason: "เข้าไม่ถึง" }, "2026-11");
    expect(next.notCollected).toBe(2);
    expect(next.last?.reasons).toEqual(["เข้าไม่ถึง"]);
    expect(next.finishMonth).toBeNull();
  });
});

describe("ตรวจฟอร์ม (ตรงกับที่ RPC รับ)", () => {
  const ok = { kind: "collected" as const, countText: "3", remaining: 6, date: "2026-11-10", minDate: "2026-10-13", maxDate: "2026-11-20", teamId: "t1", reason: "" };
  it("ผ่าน", () => expect(validateForm(ok)).toBeNull());
  it("จำนวนต้อง 1…ค้าง และเป็นเลขจำนวนเต็ม", () => {
    for (const t of ["0", "7", "", "1.5", "abc", "-1"]) expect(validateForm({ ...ok, countText: t })).toMatch(/จำนวน/);
  });
  it("วันที่เกินวันนี้ / ก่อนสัญญาสิ้นสุด / ไม่เลือกทีม", () => {
    expect(validateForm({ ...ok, date: "2026-11-21" })).toMatch(/ไม่เกินวันนี้/);
    expect(validateForm({ ...ok, date: "2026-10-01" })).toMatch(/สิ้นสุด/);
    expect(validateForm({ ...ok, teamId: "" })).toMatch(/ทีม/);
  });
  it("ไม่เก็บ ต้องมีเหตุผล ≤ 300", () => {
    expect(validateForm({ ...ok, kind: "not_collected", reason: "   " })).toMatch(/เหตุผล/);
    expect(validateForm({ ...ok, kind: "not_collected", reason: "x".repeat(301) })).toMatch(/300/);
    expect(validateForm({ ...ok, kind: "not_collected", reason: "x".repeat(300) })).toBeNull();
  });
});

import { canCloseContract, isClosable, splitHeld } from "./collectionRules";
import { CLOSE_CONTRACT_AVAILABLE, closeContract } from "./collectionRpc";

describe("สัญญาพัก (paused) / CP010", () => {
  it("paused ไม่ใช่สัญญาที่หมดแล้ว แม้วันจบผ่านไปแล้ว", () => {
    expect(isContractEnded("paused", "2020-01-01", "2026-11-20")).toBe(false);
  });
  it("CP010 → ข้อความไทย ไม่ใช่บั๊ก", () => {
    const e = describeCollectError({ code: "CP010", message: "raw" });
    expect(e.message).toContain("พักอยู่");
    expect(e.isBug).toBe(false);
  });
});

describe("ซ่อนเรื่องรอชดเชย (splitHeld)", () => {
  const rows = [
    { contractId: "a", customerName: "เอ" },
    { contractId: "b", customerName: "บี" },
  ];
  it("แยกแถวที่มีเรื่องรอชดเชยออกพร้อมเดือน", () => {
    const r = splitHeld(rows, new Map([["b", "2026-09-01"]]));
    expect(r.visible.map((x) => x.contractId)).toEqual(["a"]);
    expect(r.held).toEqual([{ contractId: "b", customerName: "บี", missedMonth: "2026-09" }]);
  });
  it("ไม่มีเรื่องค้าง = ไม่ซ่อน", () => {
    const r = splitHeld(rows, new Map());
    expect(r.visible).toHaveLength(2);
    expect(r.held).toEqual([]);
  });
});

describe("ปิดสัญญา (รอ RPC)", () => {
  it("ค่าเริ่มต้นซ่อนปุ่ม · สิทธิ์ตาม role (2.99) · ปิดได้เฉพาะสัญญายังไม่ปิด/ยกเลิก", () => {
    expect(CLOSE_CONTRACT_AVAILABLE).toBe(true);
    const central = { division: "central" };
    expect(canCloseContract("host", [], { division: "province" })).toBe(true);
    expect(canCloseContract("recorder", ["central"], central)).toBe(true);
    expect(canCloseContract("recorder", ["central"], { division: "province" })).toBe(false);
    expect(canCloseContract("admin", ["central", "province"], central)).toBe(false);
    expect(canCloseContract("viewer", ["central", "province"], central)).toBe(false);
    expect(isClosable("active")).toBe(true);
    expect(isClosable("closed")).toBe(false);
    expect(isClosable("paused")).toBe(false);
  });
  it("เรียก close_contract พร้อม p_note · อ่าน ig_remaining จากผล", async () => {
    const calls: { name: string; args: unknown }[] = [];
    const fake = { rpc: async (name: string, args: unknown) => (calls.push({ name, args }), { data: [{ ig_remaining: 3 }], error: null }) };
    const r = await closeContract(fake as never, "c1", " หมายเหตุ ");
    expect(calls).toEqual([{ name: "close_contract", args: { p_contract_id: "c1", p_note: "หมายเหตุ" } }]);
    expect(r).toEqual({ ok: true, igRemaining: 3 });
  });
  it("error จาก DB (CL006) → ข้อความไทย", async () => {
    const r = await closeContract({ rpc: async () => ({ data: null, error: { code: "CL006", message: "raw" } }) } as never, "c1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("ยังไม่หมดอายุ");
  });
});

import { closeBlockReason } from "./collectionRules";

describe("ปิดสัญญาเมื่อยังไม่หมดอายุ", () => {
  it("วันสิ้นสุด >= วันนี้ → ปิดไม่ได้ พร้อมข้อความ · < วันนี้ → ปิดได้", () => {
    expect(closeBlockReason({ endDate: "2026-11-20", status: "active" }, "2026-11-20")).toMatch(/ยังไม่หมดอายุ/);
    expect(closeBlockReason({ endDate: "2027-01-01", status: "active" }, "2026-11-20")).toMatch(/ยกเลิกสัญญา/);
    expect(closeBlockReason({ endDate: "2026-11-19", status: "active" }, "2026-11-20")).toBeNull();
    // expired_pending_collection ปิดได้เสมอ (นิยามเดียวกับ BE)
    expect(closeBlockReason({ endDate: "2027-01-01", status: "expired_pending_collection" }, "2026-11-20")).toBeNull();
  });
});

import { buildClosePayload, closeSuccessMessage, parseCloseResult } from "./collectionRpc";

describe("close_contract (M44) — payload / error / ข้อความ", () => {
  it("payload: หมายเหตุว่าง = null · ตัดช่องว่าง", () => {
    expect(buildClosePayload("c1", "  ")).toEqual({ p_contract_id: "c1", p_note: null });
    expect(buildClosePayload("c1", " ลูกค้าแจ้งเลิก ")).toEqual({ p_contract_id: "c1", p_note: "ลูกค้าแจ้งเลิก" });
  });
  it.each(["42501", "22004", "AG004", "CL006", "CL007", "CL008", "CL009", "CL010", "CL011", "CL012"])("%s → ข้อความไทย ไม่ใช่บั๊ก ไม่โชว์ดิบ", (code) => {
    const e = describeCollectError({ code, message: "raw english hint" });
    expect(e.message).toMatch(/[ก-๙]/);
    expect(e.message).not.toContain("raw english");
    expect(e.isBug).toBe(false);
  });
  it("ig_remaining → ข้อความหลังปิด", () => {
    expect(closeSuccessMessage(3)).toBe("ปิดสัญญาแล้ว · ยังค้างเก็บ 3 จุด");
    expect(closeSuccessMessage(0)).toBe("ปิดสัญญาแล้ว");
    expect(parseCloseResult([{ ig_remaining: 4 }])).toBe(4);
    expect(parseCloseResult({ ig_remaining: 0 })).toBe(0);
    expect(parseCloseResult(null)).toBeNull();
  });
  it("เงื่อนไขแสดงปุ่ม: paused ปิดไม่ได้ · เฉพาะ active / expired_pending_collection", () => {
    expect(isClosable("paused")).toBe(false);
    expect(isClosable("expired_pending_collection")).toBe(true);
  });
});
