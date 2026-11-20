import { describe, expect, it, vi } from "vitest";

import type { SavePayload } from "./buildPayload";
import { loadContractCounts, loadMakeupTarget } from "./data";
import { describeServiceError } from "./errors";
import {
  MAKEUP_BLOCK_MESSAGE,
  buildMakeupPayload,
  canRecordMakeup,
  makeupHref,
  makeupMonthDate,
  parseMakeupParams,
} from "./makeup";
import { saveMakeupServiceVisit, saveServiceVisit } from "./rpc";

// ข้อมูลทดสอบสมมติทั้งหมด
const CID = "11111111-2222-4333-8444-555555555555";

describe("URL โหมดชดเชย", () => {
  it("สร้าง URL มีแต่ id กับเดือน (ไม่มีชื่อ)", () => {
    expect(makeupHref(CID, "2026-09")).toBe(`/service?contract=${CID}&makeup=2026-09`);
    expect(makeupHref(CID.toUpperCase(), "2026-09")).toBe(`/service?contract=${CID}&makeup=2026-09`);
  });
  it("id ไม่ใช่ uuid / เดือนผิดรูปแบบ / ว่าง → null", () => {
    expect(makeupHref("abc", "2026-09")).toBeNull();
    expect(makeupHref(CID, "2026-13")).toBeNull();
    expect(makeupHref(CID, "2026-9")).toBeNull();
    expect(makeupHref(null, "2026-09")).toBeNull();
    expect(makeupHref(CID, undefined)).toBeNull();
  });
  it("อ่าน query: ต้องถูกทั้งคู่ถึงเป็นโหมดชดเชย", () => {
    expect(parseMakeupParams(CID, "2026-09")).toEqual({ contractId: CID, missedMonth: "2026-09" });
    expect(parseMakeupParams(CID, null)).toBeNull();
    expect(parseMakeupParams(null, "2026-09")).toBeNull();
    expect(parseMakeupParams("x'; drop table", "2026-09")).toBeNull();
    expect(parseMakeupParams(CID, "2026-09-01")).toBeNull();
  });
});

describe("payload โหมดชดเชย", () => {
  const base = { visit_id: "v1", contract_id: CID, visit_date: "2026-11-20", visit_type: "routine" } as unknown as SavePayload;
  it("เพิ่ม makeup_for_month 'YYYY-MM-01' ที่เหลือเหมือนเดิม", () => {
    expect(makeupMonthDate("2026-09")).toBe("2026-09-01");
    expect(buildMakeupPayload(base, "2026-09")).toEqual({ ...base, makeup_for_month: "2026-09-01" });
  });
  it("ไม่แก้ payload เดิม (ไม่ mutate)", () => {
    buildMakeupPayload(base, "2026-09");
    expect("makeup_for_month" in base).toBe(false);
  });
});

describe("เพดานตามบทบาท", () => {
  it("host ทำได้เสมอ (รวมเลยเพดาน) · recorder เฉพาะยังไม่เลยเพดาน · admin/viewer ทำไม่ได้", () => {
    expect(canRecordMakeup("host", false)).toBe(true);
    expect(canRecordMakeup("host", true)).toBe(true);
    expect(canRecordMakeup("recorder", false)).toBe(true);
    expect(canRecordMakeup("recorder", true)).toBe(false);
    expect(canRecordMakeup("admin", false)).toBe(false);
    expect(canRecordMakeup("viewer", false)).toBe(false);
  });
  it("ข้อความทุกเหตุผลเป็นภาษาไทยและมีทางไปต่อ", () => {
    for (const m of Object.values(MAKEUP_BLOCK_MESSAGE)) {
      expect(m.title).toMatch(/[ก-๙]/);
      expect(m.body).toMatch(/[ก-๙]/);
    }
  });
});

describe("เลือก RPC ถูกตัว", () => {
  const payload = { visit_id: "v1", contract_id: CID, visit_date: "2026-11-20", visit_type: "routine" } as unknown as SavePayload;
  const fakeClient = (error: { code?: string; message?: string } | null = null) => {
    const rpc = vi.fn().mockResolvedValue({ error });
    return { client: { rpc } as never, rpc };
  };

  it("โหมดปกติ → save_service_visit ส่ง payload เดิมเป๊ะ (ไม่มี makeup_for_month)", async () => {
    const { client, rpc } = fakeClient();
    expect(await saveServiceVisit(client, payload)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("save_service_visit", { p: payload });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("โหมดชดเชย → save_makeup_service_visit + makeup_for_month", async () => {
    const { client, rpc } = fakeClient();
    expect(await saveMakeupServiceVisit(client, payload, "2026-09")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("save_makeup_service_visit", { p: { ...payload, makeup_for_month: "2026-09-01" } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("error → ข้อความไทย · ไม่คืนข้อความดิบ", async () => {
    const { client } = fakeClient({ code: "MS008", message: "the make-up deadline has passed" });
    const r = await saveMakeupServiceVisit(client, payload, "2026-09");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain("เลยเพดาน");
      expect(r.error.message).not.toContain("make-up");
      expect(r.error.isBug).toBe(false);
    }
  });
  it("error ที่เป็นบั๊ก log เฉพาะรหัส (ไม่ log ข้อมูล)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ code: "XX999", message: "ชื่อลูกค้า secret" });
    await saveMakeupServiceVisit(client, payload, "2026-09");
    expect(spy).toHaveBeenCalledWith("[service] makeup RPC error code", "XX999");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret");
    spy.mockRestore();
  });
});

describe("แปล error รหัส MS ของการชดเชย", () => {
  it.each(["MS001", "MS002", "MS006", "MS008", "MS009", "MS010", "MS011"])("%s → ข้อความไทย ไม่ใช่บั๊ก", (code) => {
    const e = describeServiceError({ code, message: "raw english" });
    expect(e.isBug).toBe(false);
    expect(e.message).toMatch(/[ก-๙]/);
    expect(e.message).not.toContain("raw english");
  });
});

describe("loadMakeupTarget (ตัวปลอม)", () => {
  const contractRow = {
    id: CID,
    contract_no: "TS-0001",
    customer_id: "cu1",
    start_date: "2026-01-01",
    term_months: 12,
    value_total: 100000,
    status: "active",
    renewed_from_contract_id: null,
    stations_initialized_at: "2026-01-02T00:00:00Z",
    customers: { name: "ลูกค้าทดสอบ", branch_id: "b1" },
  };
  // ตัวปลอมที่ตอบตามตาราง/RPC
  function fake(opts: { contract?: unknown; pending?: unknown[]; pendingError?: boolean; contractError?: boolean }) {
    const rpc = vi.fn().mockResolvedValue(opts.pendingError ? { data: null, error: { code: "X" } } : { data: opts.pending ?? [], error: null });
    const from = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "gte", "lt", "is"]) chain[m] = () => chain;
      if (table === "contracts") {
        chain.maybeSingle = async () => (opts.contractError ? { data: null, error: { code: "X" } } : { data: opts.contract ?? null, error: null });
        chain.then = (r: (v: unknown) => void) => r({ data: { stations_initialized_at: "x" }, error: null, count: 0 });
      } else {
        chain.then = (r: (v: unknown) => void) => r({ data: [], error: null, count: 0 });
      }
      return chain;
    });
    return { client: { from, rpc } as never, rpc };
  }
  // เกณฑ์ Tier สมมติสำหรับเทสต์ (ของจริงอ่านจาก tier_rules)
  const TIER_RULES = [
    { tier: "S", minAnnual: 0 },
    { tier: "M", minAnnual: 30000 },
    { tier: "L", minAnnual: 100000 },
    { tier: "XL", minAnnual: 150000 },
  ] as const;
  const zones = [{ id: "z1", name: "เขต 1" }];
  const branches = [{ id: "b1", name: "สาขา ก", zoneId: "z1" }];
  const call = (client: never) => loadMakeupTarget(client, CID, "2026-09", "2026-11", zones, branches, [...TIER_RULES]);

  it("เดือนที่ตกยังค้าง → ได้สัญญา + เพดาน + เขต/สาขา", async () => {
    const { client, rpc } = fake({
      contract: contractRow,
      pending: [{ contract_id: CID, missed_month: "2026-09-01", makeup_deadline_month: "2027-01-01", past_deadline: false }],
    });
    const r = await call(client);
    expect(rpc).toHaveBeenCalledWith("list_pending_missed_services", { p_branch_id: "b1", p_month: "2026-11-01" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.item.customerName).toBe("ลูกค้าทดสอบ");
      expect(r.zoneId).toBe("z1");
      expect(r.deadlineMonth).toBe("2027-01");
      expect(r.pastDeadline).toBe(false);
    }
  });
  it("เลยเพดาน → pastDeadline = true", async () => {
    const { client } = fake({
      contract: contractRow,
      pending: [{ contract_id: CID, missed_month: "2026-09-01", makeup_deadline_month: "2026-10-01", past_deadline: true }],
    });
    const r = await call(client);
    expect(r.ok && r.pastDeadline).toBe(true);
  });
  it("เดือนที่ขอไม่อยู่ในรายการค้าง (ชดเชยแล้ว/ไม่ชดเชย/โมฆะ) → not_pending", async () => {
    const { client } = fake({
      contract: contractRow,
      pending: [{ contract_id: CID, missed_month: "2026-08-01", makeup_deadline_month: "2027-01-01", past_deadline: false }],
    });
    expect(await call(client)).toEqual({ ok: false, reason: "not_pending" });
  });
  it("ไม่พบสัญญา → not_found · อ่านพลาด → load_error", async () => {
    expect(await call(fake({ contract: null }).client)).toEqual({ ok: false, reason: "not_found" });
    expect(await call(fake({ contractError: true }).client)).toEqual({ ok: false, reason: "load_error" });
    expect(await call(fake({ contract: contractRow, pendingError: true }).client)).toEqual({ ok: false, reason: "load_error" });
  });
});

describe("การเข้าชดเชยไม่นับเป็นรอบประจำเดือนของเดือนที่ไปทำ (2.45/2.96)", () => {
  it("นับ routine ของเดือนต้องกรอง makeup_for_month ว่างเท่านั้น", async () => {
    const calls: { table: string; method: string; args: unknown[] }[] = [];
    const client = {
      from(table: string) {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "gte", "lt", "is"]) {
          chain[m] = (...args: unknown[]) => {
            calls.push({ table, method: m, args });
            return chain;
          };
        }
        chain.maybeSingle = async () => ({ data: { stations_initialized_at: null }, error: null });
        chain.then = (r: (v: unknown) => void) => r({ data: [], error: null, count: 0 });
        return chain;
      },
    } as never;
    await loadContractCounts(client, CID, "2026-11");
    const visitCalls = calls.filter((c) => c.table === "visits");
    expect(visitCalls.some((c) => c.method === "is" && c.args[0] === "makeup_for_month" && c.args[1] === null)).toBe(true);
  });
});
