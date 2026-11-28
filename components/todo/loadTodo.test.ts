/**
 * ทดสอบ loadTodo (data.ts) — ข้อมูลทดสอบสมมติทั้งหมด · Supabase เป็นตัวปลอม
 *
 * ครอบคลุม: ทุกอย่างสำเร็จ (ผลตรงกับที่คาด) · กล่องหนึ่งพลาด (กล่องอื่นยังมีข้อมูล) · ขั้นจำเป็นพลาด (ทั้งหน้า error)
 * · อ่านชื่อสัญญาพลาด · 5 กล่องถูกยิงพร้อมกัน (ไม่ต่อกันทีละขั้น)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  master: { master: { tierRules: [] as unknown[] } as unknown, error: null as string | null },
  listImpl: ((): { items: unknown[]; truncated: boolean; error: string | null } => ({
    items: [],
    truncated: false,
    error: null,
  })) as (branchId: string) => { items: unknown[]; truncated: boolean; error: string | null },
}));

vi.mock("@/components/service/data", () => ({
  loadServiceMaster: async () => mocks.master,
  loadContractList: async (_s: unknown, _m: string, branchIds: string[]) => mocks.listImpl(branchIds[0] as string),
}));

import { loadTodo, type TodoData } from "./data";

type Res = { data: unknown; error: { message: string } | null };
type Ctx = { select: string };
type Handler = (ctx: Ctx) => Res | Promise<Res>;

const ok = (data: unknown): Res => ({ data, error: null });
const fail = (message = "boom"): Res => ({ data: null, error: { message } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BRANCHES = [
  { id: "b1", name: "สาขาทดสอบ A", zone_id: "z1" },
  { id: "b2", name: "สาขาทดสอบ B", zone_id: "z1" },
];
const NAME_ROW = (id: string, no: string, branch = "b1") => ({
  id,
  contract_no: no,
  customer_id: `cust-${id}`,
  customers: { name: `ลูกค้า ${no}`, branch_id: branch },
});

type Handlers = Record<string, Handler>;

/** ชุดตอบเริ่มต้น = ทุกอย่างสำเร็จ · ทับทีละตารางด้วย overrides */
function defaults(): Handlers {
  return {
    "rpc:oldest_open_month": () => ok([{ scope: "central", oldest_open_month: "2026-11-01", is_behind: false }]),
    branches: () => ok(BRANCHES),
    "rpc:list_pending_missed_services": () =>
      ok([
        {
          contract_id: "c1",
          branch_id: "b1",
          missed_month: "2026-09-01",
          last_service_month: "2026-08-01",
          makeup_deadline_month: "2026-12-01",
          past_deadline: false,
        },
      ]),
    missed_service_resolutions: () =>
      ok([{ contract_id: "c2", missed_month: "2026-08-01", kind: "waived", reason: "ลูกค้าไม่สะดวก", decided_at: "2026-10-01T03:00:00Z" }]),
    stations: () => ok([{ id: "s1", contract_id: "c3", station_no: 2, point_label: null }]),
    v_contract_ig_collection: () => ok([{ contract_id: "c4", remaining: 2 }]),
    // อ่านชื่อ (select มี customers!inner) กับอ่านสถานะสัญญารอเก็บ (ไม่มี) ใช้ตาราง contracts เดียวกัน
    contractNames: () => ok([NAME_ROW("c1", "T-1"), NAME_ROW("c2", "T-2"), NAME_ROW("c3", "T-3"), NAME_ROW("c4", "T-4")]),
    contractsCollect: () =>
      ok([{ id: "c4", status: "expired_pending_collection", start_date: "2024-01-01", end_date: "2025-01-31", term_months: 12 }]),
  };
}

function makeSupabase(overrides: Handlers = {}) {
  const handlers = { ...defaults(), ...overrides };
  const events: string[] = [];
  const run = async (label: string, ctx: Ctx): Promise<Res> => {
    events.push(`start:${label}`);
    await sleep(10);
    try {
      return await handlers[label]!(ctx);
    } finally {
      events.push(`end:${label}`);
    }
  };
  const from = (table: string) => {
    const ctx: Ctx = { select: "" };
    const b: Record<string, unknown> = {};
    for (const m of ["eq", "gt", "order", "limit", "in", "is"]) b[m] = () => b;
    b.select = (cols: string) => {
      ctx.select = cols;
      return b;
    };
    b.then = (resolve: (r: Res) => unknown, reject: (e: unknown) => unknown) => {
      const label = table === "contracts" ? (ctx.select.includes("customers!inner") ? "contractNames" : "contractsCollect") : table;
      return run(label, ctx).then(resolve, reject);
    };
    return b;
  };
  const rpc = (name: string) => run(`rpc:${name}`, { select: "" });
  return { client: { from, rpc } as never, events };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  mocks.master = { master: { tierRules: [] }, error: null };
  mocks.listImpl = (branchId) => ({
    items: [
      { contractId: `${branchId}-1`, customerName: "ข ลูกค้า", routineCountInMonth: 1 },
      { contractId: `${branchId}-2`, customerName: "ก ลูกค้า", routineCountInMonth: 0 },
    ],
    truncated: false,
    error: null,
  });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

async function load(overrides: Handlers = {}) {
  const { client, events } = makeSupabase(overrides);
  const r = await loadTodo(client);
  return { ...r, events };
}
const need = (d: TodoData | null): TodoData => {
  expect(d).not.toBeNull();
  return d as TodoData;
};

describe("loadTodo — ทุกอย่างสำเร็จ", () => {
  it("ผลครบทุกกล่อง ข้อมูลตรงกับที่ฐานข้อมูลให้", async () => {
    const { data, error } = await load();
    expect(error).toBeNull();
    const d = need(data);
    expect(d.month).toBe("2026-11");
    expect(d.truncated).toBe(false);
    expect(d.branchNames).toEqual({ b1: "สาขาทดสอบ A", b2: "สาขาทดสอบ B" });

    // ความคืบหน้า: 2 สาขา × (1 กรอก + 1 ยังไม่กรอก) · รายการยังไม่กรอกเรียงตามชื่อ
    expect(d.progress.ok && d.progress.value.progress).toMatchObject({ total: 4, filled: 2, remaining: 2, percent: 50 });
    expect(d.progress.ok && d.progress.value.unfilled.map((i) => i.contractId)).toEqual(["b1-2", "b2-2"]);

    expect(d.pending.ok && d.pending.value).toHaveLength(1);
    expect(d.pending.ok && d.pending.value[0]).toMatchObject({
      contractId: "c1",
      customerName: "ลูกค้า T-1",
      branchName: "สาขาทดสอบ A",
      missedMonth: "2026-09",
      deadlineMonth: "2026-12",
    });
    expect(d.closed.ok && d.closed.value[0]).toMatchObject({ contractId: "c2", kind: "waived", reason: "ลูกค้าไม่สะดวก", decidedOn: "2026-10-01" });
    expect(d.agPending.ok && d.agPending.value[0]).toMatchObject({ stationId: "s1", contractNo: "T-3", label: "2" });
    expect(d.collect).toEqual({ ok: true, value: { customers: 1, stations: 2 } });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("5 กล่องถูกยิงพร้อมกัน — ทุกคำขอเริ่มก่อนที่คำขอใดของกล่องจะจบ (ไม่ต่อกันทีละขั้น)", async () => {
    const { events } = await load();
    const starts = ["rpc:list_pending_missed_services", "missed_service_resolutions", "stations", "v_contract_ig_collection"].map((l) =>
      events.indexOf(`start:${l}`),
    );
    const firstEnd = Math.min(...["rpc:list_pending_missed_services", "missed_service_resolutions", "stations", "v_contract_ig_collection"].map((l) => events.indexOf(`end:${l}`)));
    for (const s of starts) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(firstEnd);
    }
  });

  it("อ่านชื่อสัญญารอผลกล่อง 4–7 ครบก่อน (ต้องใช้รหัสสัญญาจากกล่องเหล่านั้น)", async () => {
    const { events } = await load();
    const namesStart = events.indexOf("start:contractNames");
    for (const l of ["rpc:list_pending_missed_services", "missed_service_resolutions", "stations", "v_contract_ig_collection"]) {
      expect(events.indexOf(`end:${l}`)).toBeLessThan(namesStart);
    }
  });
});

describe("loadTodo — กล่องหนึ่งพลาด กล่องอื่นยังแสดงปกติ", () => {
  const boxes = ["progress", "pending", "closed", "agPending", "collect"] as const;
  const cases: { box: (typeof boxes)[number]; label: string; run: () => Handlers | null }[] = [
    { box: "pending", label: "RPC ตกบริการ error", run: () => ({ "rpc:list_pending_missed_services": () => fail("pending boom") }) },
    { box: "closed", label: "เรื่องที่ปิดแล้ว error", run: () => ({ missed_service_resolutions: () => fail("closed boom") }) },
    { box: "agPending", label: "สถานี AG error", run: () => ({ stations: () => fail("ag boom") }) },
    { box: "collect", label: "v_contract_ig_collection error", run: () => ({ v_contract_ig_collection: () => fail("col boom") }) },
    { box: "collect", label: "สถานะสัญญารอเก็บ error", run: () => ({ contractsCollect: () => fail("colc boom") }) },
  ];

  for (const c of cases) {
    it(`${c.label} → เฉพาะกล่อง ${c.box} ไม่ ok · กล่องอื่น ok · มี log [todo] box`, async () => {
      const { data, error } = await load(c.run() as Handlers);
      expect(error).toBeNull();
      const d = need(data);
      for (const b of boxes) expect(d[b].ok).toBe(b !== c.box);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[todo\] box /), expect.stringContaining("boom"));
    });
  }

  it("ความคืบหน้า (loadContractList) error → เฉพาะกล่อง progress ไม่ ok", async () => {
    mocks.listImpl = (branchId) => (branchId === "b2" ? { items: [], truncated: false, error: "list boom" } : { items: [], truncated: false, error: null });
    const { data } = await load();
    const d = need(data);
    expect(d.progress.ok).toBe(false);
    for (const b of ["pending", "closed", "agPending", "collect"] as const) expect(d[b].ok).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith("[todo] box progress load error", "list boom");
  });

  it("คำขอ throw (เช่น เครือข่ายขาด) ก็ไม่พังทั้งหน้า — เฉพาะกล่องนั้นไม่ ok", async () => {
    const { data, error } = await load({
      stations: () => {
        throw new Error("network down");
      },
    });
    expect(error).toBeNull();
    const d = need(data);
    expect(d.agPending.ok).toBe(false);
    expect(d.pending.ok && d.closed.ok && d.progress.ok && d.collect.ok).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith("[todo] box agPending load error", "network down");
  });

  it("log ไม่มีชื่อลูกค้า (ข้อความ error ของฐานข้อมูลเท่านั้น)", async () => {
    await load({ missed_service_resolutions: () => fail("closed boom") });
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain("ลูกค้า T-");
  });

  it("กล่องที่พลาดไม่ถูกนับเข้า truncated · กล่องที่ผ่านยังตั้ง truncated ได้", async () => {
    mocks.listImpl = (branchId) => ({ items: [], truncated: branchId === "b1", error: null });
    const withTrunc = need((await load()).data);
    expect(withTrunc.truncated).toBe(true);
    mocks.listImpl = () => ({ items: [], truncated: true, error: "x" });
    const failed = need((await load()).data);
    expect(failed.progress.ok).toBe(false);
    expect(failed.truncated).toBe(false);
  });
});

describe("loadTodo — อ่านชื่อสัญญาพลาด", () => {
  it("กล่องที่ต้องใช้ชื่อและมีแถว = ไม่ ok · ความคืบหน้ายัง ok", async () => {
    const { data, error } = await load({ contractNames: () => fail("names boom") });
    expect(error).toBeNull();
    const d = need(data);
    expect(d.progress.ok).toBe(true);
    for (const b of ["pending", "closed", "agPending", "collect"] as const) expect(d[b].ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith("[todo] box contractNames load error", "names boom");
  });

  it("กล่องที่ไม่มีแถวเลย = ว่างจริง (ไม่ขึ้นว่าพลาด) แม้อ่านชื่อพลาด", async () => {
    const { data } = await load({
      contractNames: () => fail("names boom"),
      missed_service_resolutions: () => ok([]),
      stations: () => ok([]),
      v_contract_ig_collection: () => ok([]),
    });
    const d = need(data);
    expect(d.closed).toEqual({ ok: true, value: [] });
    expect(d.agPending).toEqual({ ok: true, value: [] });
    expect(d.collect).toEqual({ ok: true, value: { customers: 0, stations: 0 } });
    expect(d.pending.ok).toBe(false); // ยังมีแถวตกบริการ แต่ไม่รู้ชื่อ → โหลดไม่ได้ ไม่โกหกว่าว่าง
  });
});

describe("loadTodo — ขั้นจำเป็นพลาด = ทั้งหน้า error (เหมือนเดิม)", () => {
  it("oldest_open_month error", async () => {
    const r = await load({ "rpc:oldest_open_month": () => fail("open boom") });
    expect(r).toMatchObject({ data: null, error: "open boom" });
  });
  it("รายชื่อสาขา error", async () => {
    const r = await load({ branches: () => fail("branch boom") });
    expect(r).toMatchObject({ data: null, error: "branch boom" });
  });
  it("ข้อมูลอ้างอิง (master) error", async () => {
    mocks.master = { master: null, error: "master boom" };
    const r = await load();
    expect(r).toMatchObject({ data: null, error: "master boom" });
  });
});
