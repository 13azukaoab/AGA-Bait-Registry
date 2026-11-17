/**
 * เทสตรรกะล้วนของหน้ารายละเอียดลูกค้า — ข้อมูลทั้งหมดเป็นข้อมูลสมมติ
 */
import { describe, expect, it } from "vitest";

import {
  agCardState,
  agNames,
  buildAlerts,
  buildContactPayload,
  buildPhoneDeletePayload,
  canAttachContract,
  canEditContract,
  changedFieldNames,
  checkLinesByStation,
  collectProgress,
  computeMissed,
  contractEnd,
  customerPermissions,
  dashHeadline,
  dashRange,
  dashDistinctStations,
  describeAudit,
  describeContactError,
  filterStations,
  fmtDate,
  icHanded,
  igCollectState,
  isAttention,
  isFoundCheck,
  missedActions,
  missedCounts,
  monthStates,
  monthTh,
  paginate,
  primaryContract,
  stationCounts,
  stationStatusLabel,
  termiteByMonth,
  validateContactName,
  validatePhone,
  type StationFilter,
} from "./logic";
import type { CheckRow, ContractRow, ResolutionRow, StationRow, TimberMonth, VisitRow } from "./types";

const contract = (o: Partial<ContractRow> = {}): ContractRow => ({
  id: "c1",
  no: "CT-TEST-1",
  startDate: "2026-01-01",
  endDate: null,
  termMonths: 12,
  valueTotal: 36000,
  saleType: "new",
  status: "active",
  closedAt: null,
  cancelledAt: null,
  renewedFromId: null,
  stationsInitializedAt: "2026-01-05T00:00:00+07:00",
  teamCodes: ["A"],
  tier: "M",
  ...o,
});

const visit = (o: Partial<VisitRow> & { id: string; date: string }): VisitRow => ({
  contractId: "c1",
  type: "routine",
  teamCodes: ["A"],
  startTime: "09:00",
  endTime: "10:00",
  durationMin: 60,
  internalInspection: null,
  signedByProxy: null,
  timberPcs: null,
  baitIgIcG: null,
  baitAgG: null,
  powderPoints: null,
  firstInstall: null,
  note: null,
  createdByName: null,
  makeupForMonth: null,
  ...o,
});

const station = (o: Partial<StationRow> & { id: string }): StationRow => ({
  contractId: "c1",
  type: "IG",
  no: 1,
  code: "IG-1",
  pointLabel: null,
  installedAt: "2026-01-05",
  status: "active",
  removedAt: null,
  collectedAt: null,
  notCollectedOn: null,
  notCollectedReason: null,
  movedFromContractNo: null,
  ...o,
});

const check = (o: Partial<CheckRow> & { visitId: string; stationId: string }): CheckRow => ({
  followUpNo: null,
  caste: null,
  termiteGroup: null,
  baitAddedG: null,
  note: null,
  checked: true,
  ...o,
});

describe("customerPermissions", () => {
  it("viewer เข้าไม่ได้ (PDPA)", () => {
    expect(customerPermissions("viewer").canView).toBe(false);
    expect(customerPermissions("viewer").editContact).toBe(false);
  });
  it("admin: แก้ข้อมูลติดต่อ + ลิงก์แก้ได้ · ตัดสินตกบริการไม่ได้ (2.57) · ไม่เห็นไทม์ไลน์", () => {
    const p = customerPermissions("admin");
    expect(p).toMatchObject({ canView: true, editContact: true, edit: true, entry: false, resolve: false, timeline: false });
  });
  it("recorder: ตัดสินตกบริการได้ · แก้ลิงก์เปิดงานไม่ได้", () => {
    const p = customerPermissions("recorder");
    expect(p).toMatchObject({ editContact: true, entry: true, resolve: true, edit: false, timeline: false });
  });
  it("host ทำได้ทั้งหมด", () => {
    expect(customerPermissions("host")).toMatchObject({ editContact: true, entry: true, resolve: true, edit: true, timeline: true });
  });
});

describe("สิทธิ์แก้สัญญา/ไฟล์ตามสถานะ", () => {
  it("admin แก้สัญญาปิดแล้ว/ยกเลิกไม่ได้ · host ได้", () => {
    expect(canEditContract("admin", "closed")).toBe(false);
    expect(canEditContract("admin", "cancelled")).toBe(false);
    expect(canEditContract("admin", "active")).toBe(true);
    expect(canEditContract("host", "closed")).toBe(true);
    expect(canEditContract("recorder", "active")).toBe(false);
  });
  it("ไฟล์: ปิดแล้วล็อกทุกคน · ยกเลิก host ได้ admin ไม่ได้", () => {
    expect(canAttachContract("host", "closed")).toBe(false);
    expect(canAttachContract("host", "cancelled")).toBe(true);
    expect(canAttachContract("admin", "cancelled")).toBe(false);
    expect(canAttachContract("admin", "expired_pending_collection")).toBe(true);
  });
});

describe("วันสิ้นสุด / สัญญาหลัก", () => {
  it("วันสิ้นสุดอัตโนมัติ = เริ่ม + N เดือน − 1 วัน (M30)", () => {
    expect(contractEnd(contract({ startDate: "2026-01-15", termMonths: 5 }))).toBe("2026-06-14");
    expect(contractEnd(contract({ startDate: "2026-01-01", termMonths: 36 }))).toBe("2028-12-31");
  });
  it("end_date ที่เก็บไว้ชนะค่าอัตโนมัติ", () => {
    expect(contractEnd(contract({ endDate: "2026-12-30" }))).toBe("2026-12-30");
  });
  it("primaryContract: ใช้งาน > หมดสัญญารอเก็บ > ล่าสุด", () => {
    const a = contract({ id: "a", startDate: "2025-01-01", status: "closed" });
    const b = contract({ id: "b", startDate: "2026-01-01", status: "active" });
    expect(primaryContract([a, b])?.id).toBe("b");
    expect(primaryContract([a])?.id).toBe("a");
    expect(primaryContract([])).toBeNull();
  });
});

describe("monthStates", () => {
  const c = contract({ startDate: "2026-01-01", termMonths: 6 });
  const visits = [
    visit({ id: "v1", date: "2026-01-14" }),
    visit({ id: "v2", date: "2026-02-10" }),
    // ชดเชยของ ม.ค. (ไปเดือน มี.ค.) — ไม่นับเป็น routine ของ มี.ค.
    visit({ id: "v3", date: "2026-03-10", makeupForMonth: "2026-01-01" }),
  ];
  it("ok / miss / now / fut ตามเดือนปัจจุบัน", () => {
    const s = monthStates(c, visits, "2026-05");
    expect(s.map((x) => x.state)).toEqual(["ok", "ok", "miss", "miss", "now", "fut"]);
  });
  it("ยังไม่ตั้งสถานี = ก่อนเริ่มนับตก (pre) ไม่ใช่ miss", () => {
    const s = monthStates(contract({ startDate: "2026-01-01", termMonths: 3, stationsInitializedAt: null }), [], "2026-05");
    expect(s.every((x) => x.state === "pre")).toBe(true);
  });
  it("สัญญายกเลิก: เดือนที่ยกเลิกเป็นต้นไปเป็น cx", () => {
    const s = monthStates(contract({ startDate: "2026-01-01", termMonths: 4, cancelledAt: "2026-03-10" }), [], "2026-06");
    expect(s.map((x) => x.state)).toEqual(["miss", "miss", "cx", "cx"]);
  });
});

describe("computeMissed — 4 สถานะ", () => {
  const base = {
    customerId: "cu1",
    currentMonth: "2026-10",
    deadlineMonths: 12,
  };
  const c = contract({ startDate: "2026-04-01", termMonths: 6, stationsInitializedAt: "2026-04-02T00:00:00+07:00" });
  const visits = [visit({ id: "v1", date: "2026-04-10" }), visit({ id: "v2", date: "2026-07-10" }), visit({ id: "v3", date: "2026-09-10" })];

  it("เดือนที่ไม่มี routine = ตก · รอตัดสิน · คำนวณเพดานชดเชยจากเดือนบริการสุดท้าย", () => {
    const items = computeMissed({ ...base, contracts: [c], visits, resolutions: [] });
    expect(items.map((i) => i.month)).toEqual(["2026-05", "2026-06", "2026-08"]);
    expect(items.every((i) => i.status === "pending")).toBe(true);
    expect(items[0]?.deadlineMonth).toBe("2027-09");
    expect(items[0]?.pastDeadline).toBe(false);
  });
  it("ไม่ชดเชย (waived) มีเหตุผล", () => {
    const res: ResolutionRow[] = [
      { contractId: "c1", missedMonth: "2026-05-01", kind: "waived", reason: "ลูกค้าปิดอาคาร (สมมติ)", evidencePath: null, decidedByName: "ทดสอบ", decidedAt: null },
    ];
    const items = computeMissed({ ...base, contracts: [c], visits, resolutions: res });
    expect(items[0]).toMatchObject({ month: "2026-05", status: "waived", reason: "ลูกค้าปิดอาคาร (สมมติ)" });
    expect(items[1]?.status).toBe("pending");
  });
  it("ชดเชยแล้ว = มีการเข้าชดเชยผูกไว้", () => {
    const withMakeup = [...visits, visit({ id: "v9", date: "2026-08-20", makeupForMonth: "2026-05-01", teamCodes: ["B"] })];
    const items = computeMissed({ ...base, contracts: [c], visits: withMakeup, resolutions: [] });
    expect(items[0]).toMatchObject({ status: "made_up", makeupDate: "2026-08-20", makeupTeams: ["B"] });
  });
  it("ต่อสัญญาแล้ว (Renew) = โมฆะ ไม่ต้องกด (2.47)", () => {
    const renew = contract({ id: "c2", no: "CT-TEST-2", startDate: "2026-10-01", renewedFromId: "c1" });
    const items = computeMissed({ ...base, contracts: [c, renew], visits, resolutions: [] });
    const old = items.filter((i) => i.contractId === "c1");
    expect(old.every((i) => i.status === "void_renewed" && i.supersededByNo === "CT-TEST-2")).toBe(true);
  });
  it("เลยเพดาน: pastDeadline", () => {
    const items = computeMissed({ ...base, currentMonth: "2027-10", contracts: [c], visits, resolutions: [] });
    expect(items[0]?.pastDeadline).toBe(true);
  });
  it("สัญญายกเลิกไม่มีรายการตก", () => {
    const items = computeMissed({ ...base, contracts: [{ ...c, cancelledAt: "2026-05-02" }], visits, resolutions: [] });
    expect(items).toEqual([]);
  });
  it("missedCounts", () => {
    const items = computeMissed({ ...base, contracts: [c], visits, resolutions: [] });
    expect(missedCounts(items)).toEqual({ total: 3, pending: 3, madeUp: 0, waived: 0, voided: 0 });
  });
});

describe("missedActions", () => {
  const pending = { status: "pending" as const, pastDeadline: false };
  it("หัวหน้างาน: ไม่ชดเชย + ชดเชยได้ ภายในเพดาน", () => {
    expect(missedActions({ role: "recorder", contractStatus: "active", item: pending })).toMatchObject({ waive: true, record: true, recordOverCap: false });
  });
  it("เลยเพดาน: หัวหน้างานชดเชยไม่ได้ · host ได้แบบเกินเพดาน", () => {
    const late = { status: "pending" as const, pastDeadline: true };
    expect(missedActions({ role: "recorder", contractStatus: "active", item: late })).toMatchObject({ waive: true, record: false });
    expect(missedActions({ role: "host", contractStatus: "active", item: late })).toMatchObject({ record: true, recordOverCap: true });
  });
  it("admin ดูอย่างเดียว (2.57)", () => {
    expect(missedActions({ role: "admin", contractStatus: "active", item: pending })).toEqual({ waive: false, record: false, recordOverCap: false, reopen: false });
  });
  it("สัญญายกเลิกไม่มีปุ่ม · ไม่ชดเชยแล้วเปิดกลับได้", () => {
    expect(missedActions({ role: "host", contractStatus: "cancelled", item: pending }).waive).toBe(false);
    expect(missedActions({ role: "recorder", contractStatus: "active", item: { status: "waived", pastDeadline: false } }).reopen).toBe(true);
    expect(missedActions({ role: "admin", contractStatus: "active", item: { status: "waived", pastDeadline: false } }).reopen).toBe(false);
  });
});

describe("สถานี", () => {
  const ig = station({ id: "s1", code: "IG-1" });
  const ag1 = station({ id: "s2", type: "AG", code: "AG-01", status: "pending_removal", pointLabel: "โถงหน้า" });
  const ag2 = station({ id: "s3", type: "AG", code: "AG-02", status: "active" });
  const lost = station({ id: "s4", code: "IG-72", status: "lost" });
  const all = [ig, ag1, ag2, lost];

  it("stationStatusLabel: AG active = ติดตามผล", () => {
    expect(stationStatusLabel(ag2).text).toBe("ติดตามผล");
    expect(stationStatusLabel(ig).text).toBe("ใช้งาน");
    expect(stationStatusLabel(station({ id: "x", status: "eliminated" })).text).toBe("จบงาน");
  });
  it("stationCounts", () => {
    const c = stationCounts(all);
    expect(c).toMatchObject({ IG: 2, AG: 2, total: 4 });
    expect(c.byStatus.lost).toBe(1);
  });
  it("agCardState: รอถอดมาก่อนติดตามผล", () => {
    expect(agCardState(all).kind).toBe("pending");
    expect(agCardState([ag2]).kind).toBe("tracking");
    expect(agCardState([ig]).kind).toBe("none");
  });
  it("agNames ตัดเหลือ 3 จุด", () => {
    expect(agNames([ag1])).toBe("AG-01 โถงหน้า");
    expect(agNames([ag2, ag2, ag2, ag2])).toBe("AG-02 · AG-02 · AG-02 · +1");
  });
  it("isAttention: หาย/AG ที่ยังไม่จบ/IG พบปลวกเดือนก่อน", () => {
    expect(isAttention(lost, undefined, "2026-10")).toBe(true);
    expect(isAttention(ag1, undefined, "2026-10")).toBe(true);
    expect(isAttention(ig, undefined, "2026-10")).toBe(false);
    expect(isAttention(ig, new Set(["2026-09"]), "2026-10")).toBe(true);
    expect(isAttention(ig, new Set(["2026-07"]), "2026-10")).toBe(false);
  });
  it("filterStations: ต้องดู / ชนิด / ค้นรหัส และเรียง AG ก่อน IG", () => {
    const f: StationFilter = { attn: false, contractId: "all", type: "all", status: "all", q: "" };
    expect(filterStations(all, f, new Map(), "2026-10").map((s) => s.id)).toEqual(["s2", "s3", "s1", "s4"]);
    expect(filterStations(all, { ...f, attn: true }, new Map(), "2026-10").map((s) => s.id)).toEqual(["s2", "s3", "s4"]);
    expect(filterStations(all, { ...f, q: "ag-0" }, new Map(), "2026-10")).toHaveLength(2);
    expect(filterStations(all, { ...f, status: "lost" }, new Map(), "2026-10").map((s) => s.id)).toEqual(["s4"]);
  });
  it("เก็บสถานี IG: นับเก็บแล้ว/ไม่เก็บ/รอเก็บ ไม่นับหาย/ถอนออก", () => {
    const list = [
      station({ id: "a", collectedAt: "2026-10-15" }),
      station({ id: "b", notCollectedOn: "2026-10-15", notCollectedReason: "สมมติ" }),
      station({ id: "c" }),
      station({ id: "d", status: "lost" }),
      station({ id: "e", type: "IC" }),
    ];
    expect(collectProgress(list, "c1")).toEqual({ done: 1, waived: 1, pending: 1, total: 3 });
  });
  it("igCollectState / icHanded ตามสถานะสัญญา", () => {
    const done = contract({ status: "closed" });
    expect(igCollectState(station({ id: "a" }), done)).toBe("pending");
    expect(igCollectState(station({ id: "a", collectedAt: "2026-01-01" }), done)).toBe("collected");
    expect(igCollectState(station({ id: "a" }), contract())).toBe("");
    expect(icHanded(station({ id: "i", type: "IC" }), done)).toBe("closed");
    expect(icHanded(station({ id: "i", type: "IC" }), contract({ status: "expired_pending_collection" }))).toBe("expired");
    expect(icHanded(station({ id: "i", type: "IG" }), done)).toBe("");
  });
});

describe("ผลตรวจ / กราฟ", () => {
  const c = contract({ startDate: "2026-01-01", termMonths: 4 });
  const stations = [
    station({ id: "ig1", code: "IG-1" }),
    station({ id: "ig2", code: "IG-2" }),
    station({ id: "ag1", code: "AG-01", type: "AG" }),
  ];
  const visits = [
    visit({ id: "v1", date: "2026-01-14" }),
    visit({ id: "v2", date: "2026-01-20" }),
    visit({ id: "v3", date: "2026-02-10" }),
    visit({ id: "v4", date: "2026-02-20", type: "follow_up" }),
  ];
  const checks = [
    check({ visitId: "v1", stationId: "ig1", termiteGroup: "subterranean" }),
    check({ visitId: "v2", stationId: "ig1", termiteGroup: "subterranean" }), // เดือนเดียวกัน = นับ 1 จุด
    check({ visitId: "v1", stationId: "ig2", termiteGroup: null, baitAddedG: 0 }), // ไม่พบปลวก (เปลี่ยนไม้อย่างเดียว) ไม่นับ
    check({ visitId: "v3", stationId: "ig2", termiteGroup: "garden" }),
    check({ visitId: "v4", stationId: "ag1", caste: "ปลวกตาย", followUpNo: 2 }),
    check({ visitId: "v4", stationId: "ag1", checked: false }),
  ];
  const timber: TimberMonth[] = [{ contractId: "c1", month: "2026-01-01", igNos: [3, 5], icNos: [2] }];

  it("isFoundCheck: ต้องตรวจแล้ว + IG/IC มีกลุ่มปลวก · AG มีสัดส่วน", () => {
    expect(isFoundCheck("IG", check({ visitId: "v", stationId: "s", termiteGroup: "garden" }))).toBe(true);
    expect(isFoundCheck("IG", check({ visitId: "v", stationId: "s" }))).toBe(false);
    expect(isFoundCheck("AG", check({ visitId: "v", stationId: "s", caste: "ทหาร" }))).toBe(true);
    expect(isFoundCheck("AG", check({ visitId: "v", stationId: "s", caste: null }))).toBe(false);
    expect(isFoundCheck("AG", check({ visitId: "v", stationId: "s", checked: false, caste: "ทหาร" }))).toBe(false);
  });
  it("termiteByMonth นับสถานีไม่ซ้ำต่อเดือน + เปลี่ยนไม้จาก view", () => {
    const rows = termiteByMonth({ contract: c, stations, checks, visits, timber, currentMonth: "2026-03" });
    expect(rows.map((r) => r.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(rows[0]).toMatchObject({ ig: 1, ic: 0, ag: 0, ext: 1, t: 3 });
    expect(rows[0]?.tL).toEqual(["IG-3", "IG-5", "IC-2"]);
    expect(rows[1]).toMatchObject({ ig: 1, ag: 1, ext: 1 });
    expect(rows[3]?.state).toBe("fut");
  });
  it("dashRange: ค่าเริ่มต้น = ถึงเดือนปัจจุบัน · ทั้งสัญญา · สลับกลับด้าน", () => {
    const rows = termiteByMonth({ contract: c, stations, checks, visits, timber, currentMonth: "2026-03" });
    const d = dashRange(rows, null, null);
    expect(d.rows).toHaveLength(3);
    expect(d.toNow).toBe(true);
    expect(dashRange(rows, null, "").rows).toHaveLength(4);
    const swapped = dashRange(rows, "2026-03", "2026-02");
    expect([swapped.from, swapped.to]).toEqual(["2026-02", "2026-03"]);
  });
  it("dashHeadline / จำนวนสถานีไม่ซ้ำ", () => {
    const rows = termiteByMonth({ contract: c, stations, checks, visits, timber, currentMonth: "2026-03" });
    const r = dashRange(rows, null, null).rows;
    const all = { ext: true, ag: true, timber: true };
    expect(dashHeadline(r, all)).toBe("พบปลวก 2 จาก 3 เดือน · สูงสุด ก.พ. (2 จุด)");
    expect(dashDistinctStations(r, all)).toBe(3); // IG-1, IG-2, AG-01
    expect(dashHeadline(r, { ext: false, ag: false, timber: true })).toContain("เปลี่ยนไม้เฉลี่ย");
    expect(dashHeadline([], all)).toBe("ยังไม่มีเดือนที่ผ่านมา");
  });
  it("checkLinesByStation: F ของ AG ใช้ follow_up_no · IG ใช้ลำดับที่พบ", () => {
    const by = checkLinesByStation(stations, checks, visits);
    expect(by.get("ag1")?.[0]?.no).toBe(2);
    expect(by.get("ig1")?.map((l) => l.no)).toEqual([1, 2]);
    expect(by.get("ig2")).toHaveLength(1);
  });
});

describe("ข้อมูลติดต่อ", () => {
  const phones = [
    { id: "p1", phone: "02-123-4567", label: "โต๊ะต้อนรับ", sortOrder: 1 },
    { id: "p2", phone: "081 555 0142", label: null, sortOrder: 2 },
  ];
  const current = { contactName: "คุณทดสอบ", note: "สะดวกวันจันทร์", phones };

  it("validateContactName / validatePhone", () => {
    expect(validateContactName("  ")).toBe("กรุณากรอกชื่อผู้ติดต่อ");
    expect(validateContactName("ก".repeat(81))).toContain("80");
    expect(validateContactName("คุณทดสอบ")).toBeNull();
    expect(validatePhone("123", "", phones, null)).toContain("เบอร์โทรไม่ถูกต้อง");
    expect(validatePhone("021234567", "", phones, null)).toBe("มีเบอร์นี้อยู่แล้ว"); // เทียบเฉพาะตัวเลข
    expect(validatePhone("021234567", "", phones, "p1")).toBeNull(); // แก้เบอร์ตัวเอง ไม่ซ้ำ
    expect(validatePhone("089-999-0000", "ก".repeat(41), phones, null)).toContain("40");
    expect(validatePhone("089-999-0000", "ฝ่ายบัญชี", phones, null)).toBeNull();
  });
  it("buildContactPayload: ไม่เปลี่ยน = null (ไม่เรียก RPC)", () => {
    expect(buildContactPayload("cu", { field: "contact", value: " คุณทดสอบ " }, current, false)).toBeNull();
    expect(buildContactPayload("cu", { field: "note", value: "สะดวกวันจันทร์" }, current, false)).toBeNull();
    expect(buildContactPayload("cu", { field: "phone", id: "p1", phone: "02-123-4567", label: "โต๊ะต้อนรับ" }, current, false)).toBeNull();
  });
  it("buildContactPayload: ส่งเฉพาะช่องที่เปลี่ยน", () => {
    expect(buildContactPayload("cu", { field: "contact", value: "คุณใหม่" }, current, false)).toEqual({ customer_id: "cu", contact_name: "คุณใหม่" });
    expect(buildContactPayload("cu", { field: "note", value: "" }, current, true)).toEqual({ customer_id: "cu", note: "", confirm_cross_team: true });
    expect(buildContactPayload("cu", { field: "phone", id: null, phone: "089-999-0000", label: "" }, current, false)).toEqual({
      customer_id: "cu",
      phones_upsert: [{ phone: "089-999-0000", label: null }],
    });
    expect(buildContactPayload("cu", { field: "phone", id: "p2", phone: "081 555 0199", label: "มือถือ" }, current, false)).toEqual({
      customer_id: "cu",
      phones_upsert: [{ id: "p2", phone: "081 555 0199", label: "มือถือ", sort_order: 2 }],
    });
  });
  it("buildPhoneDeletePayload", () => {
    expect(buildPhoneDeletePayload("cu", "p1", true)).toEqual({ customer_id: "cu", phones_delete: ["p1"], confirm_cross_team: true });
  });
  it("describeContactError: CC001 ดึงรหัสทีมจาก DETAIL · CC00x ไทย · 42501 · ไม่รู้จัก = บั๊ก", () => {
    const cc1 = describeContactError({ code: "CC001", message: "x", details: '{"team_codes":["A","B"]}' });
    expect(cc1).toMatchObject({ needsCrossTeamConfirm: true, teamCodes: ["A", "B"], isBug: false });
    expect(describeContactError({ code: "CC001", details: "not json" }).teamCodes).toEqual([]);
    expect(describeContactError({ code: "CC003" }).message).toBe("มีเบอร์นี้อยู่แล้ว");
    expect(describeContactError({ code: "CC004" }).message).toContain("เบอร์สุดท้าย");
    expect(describeContactError({ code: "CC002", message: "กรุณากรอกชื่อผู้ติดต่อ" }).message).toBe("กรุณากรอกชื่อผู้ติดต่อ");
    expect(describeContactError({ code: "42501" }).message).toContain("ไม่มีสิทธิ์");
    expect(describeContactError({ code: "22023" }).isBug).toBe(true);
  });
});

describe("แถบเตือน", () => {
  const args = { stations: [] as StationRow[], today: "2026-10-16", role: "host" as const, customerTeamCodes: ["A"], myTeamCode: null, canGoCollect: true };
  it("สัญญาใกล้หมดภายใน 90 วัน", () => {
    const a = buildAlerts({ ...args, contracts: [contract({ startDate: "2025-12-01", termMonths: 12 })] });
    expect(a[0]?.title).toBe("สัญญา CT-TEST-1 ใกล้หมด");
    expect(a[0]?.body).toContain("อีก 45 วัน");
  });
  it("วันสิ้นสุดไม่ตรงกฎ", () => {
    const a = buildAlerts({ ...args, contracts: [contract({ startDate: "2026-01-01", endDate: "2026-12-30" })] });
    expect(a.some((x) => x.title.includes("ไม่ตรงกฎ") && x.action?.kind === "contract")).toBe(true);
  });
  it("หมดสัญญารอเก็บ: แสดงจำนวนค้าง + ลิงก์ (ตามสิทธิ์)", () => {
    const st = [station({ id: "a" }), station({ id: "b", collectedAt: "2026-10-15" })];
    const c = contract({ status: "expired_pending_collection", startDate: "2023-10-14", termMonths: 36 });
    const a = buildAlerts({ ...args, contracts: [c], stations: st });
    expect(a[0]?.title).toBe("หมดสัญญา — IG รอเก็บ 1 จุด");
    expect(a[0]?.action?.kind).toBe("collect");
    expect(buildAlerts({ ...args, canGoCollect: false, contracts: [c], stations: st })[0]?.action).toBeUndefined();
  });
  it("หัวหน้างานข้ามทีม: แจ้งเตือนข้อมูล", () => {
    const a = buildAlerts({ ...args, role: "recorder", myTeamCode: "B", customerTeamCodes: ["A"], contracts: [contract({ startDate: "2026-06-01" })] });
    expect(a.some((x) => x.tone === "info")).toBe(true);
    const same = buildAlerts({ ...args, role: "recorder", myTeamCode: "A", customerTeamCodes: ["A"], contracts: [contract({ startDate: "2026-06-01" })] });
    expect(same.some((x) => x.tone === "info")).toBe(false);
  });
});

describe("ไทม์ไลน์ (audit)", () => {
  it("changedFieldNames ข้ามช่องที่ระบบตั้งเอง และไม่เก็บค่า", () => {
    expect(
      changedFieldNames({ name: "ก", updated_at: "1", value_total: 1 }, { name: "ก", updated_at: "2", value_total: 2 }),
    ).toEqual(["value_total"]);
    expect(changedFieldNames(null, { a: 1 })).toEqual([]);
  });
  it("describeAudit", () => {
    expect(describeAudit({ tableName: "contracts", action: "update", changedFields: ["value_total", "term_months"] })).toBe("แก้สัญญา: มูลค่า, ระยะสัญญา");
    expect(describeAudit({ tableName: "stations", action: "delete", changedFields: [] })).toBe("ลบสถานี");
    expect(describeAudit({ tableName: "customer_phones", action: "insert", changedFields: [] })).toBe("เพิ่มเบอร์โทรลูกค้า");
  });
});

describe("อื่นๆ", () => {
  it("fmtDate / monthTh", () => {
    expect(fmtDate("2026-10-05")).toBe("05/10/2026");
    expect(fmtDate(null)).toBe("—");
    expect(monthTh("2026-10")).toBe("ต.ค. 2026");
  });
  it("paginate ตัดหน้าให้อยู่ในช่วง", () => {
    const r = paginate([1, 2, 3, 4, 5], 9, 2);
    expect(r).toEqual({ slice: [5], pages: 3, page: 3 });
    expect(paginate([], 1, 10).pages).toBe(1);
  });
});
