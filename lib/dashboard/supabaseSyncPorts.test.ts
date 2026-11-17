import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { BRANCHES } from "./branches";
import {
  DASHBOARD_ENV,
  dashboardSyncConfigFromEnv,
  loadDashboardData,
  supabaseSyncPorts,
} from "./supabaseSyncPorts";

// Supabase จำลอง — ไม่ต่อฐานข้อมูลจริง · ข้อมูลสมมติทั้งหมด
type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>, rpc: Record<string, unknown> = {}) {
  const calls = { ranges: [] as { table: string; from: number; to: number }[], rpc: [] as { name: string; args: unknown }[] };
  const client = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return builder;
        },
        not: (col: string) => {
          filters.push((r) => r[col] !== null && r[col] !== undefined);
          return builder;
        },
        order: () => builder,
        range: async (from: number, to: number) => {
          calls.ranges.push({ table, from, to });
          const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
      return builder;
    },
    rpc: async (name: string, args?: unknown) => {
      calls.rpc.push({ name, args });
      if (name in rpc) return { data: rpc[name], error: null };
      return { data: null, error: { message: `no rpc ${name}`, code: "PGRST202" } };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const branchRows = BRANCHES.map((b, i) => ({ id: `b${i}`, name: b.branch }));
const idOf = (name: string) => branchRows.find((b) => b.name === name)!.id;

function snapshot(month: string, branch: string, source: string, value: number): Row {
  return {
    month_key: month, branch_id: idOf(branch), source,
    s1: 1, s3: 0, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0, cust: 1,
    vS: String(value), vM: "0.00", vL: "0.00", vXL: "0.00", value: String(value),
  };
}

function baseTables(): Record<string, Row[]> {
  return {
    branches: branchRows,
    monthly_branch_snapshots: BRANCHES.map((b) => snapshot("2026-09", b.branch, "legacy", 100)),
    month_closures: [],
    tier_rules: [
      { tier: "S", min_annual: "0", effective_month: null },
      { tier: "M", min_annual: "30000", effective_month: null },
      { tier: "L", min_annual: "50000", effective_month: null },
      { tier: "XL", min_annual: "100000", effective_month: null },
    ],
    customers: [{ id: "cu1", branch_id: idOf("นครปฐม") }],
    contracts: [
      {
        id: "k1", customer_id: "cu1", start_date: "2026-10-05", end_date: null, term_months: 12,
        value_total: "40000.00", cancelled_at: null, stations_initialized_at: null, renewed_from_contract_id: null,
      },
    ],
    visits: [],
  };
}

const NOV_6 = new Date("2026-11-05T23:10:00Z"); // 06:10 ไทย 6 พ.ย. 2026

describe("dashboardSyncConfigFromEnv", () => {
  it("ไม่มี token = config_missing (ข้อความบอกชื่อ env ไม่มีค่า)", () => {
    expect(() => dashboardSyncConfigFromEnv({})).toThrow(DASHBOARD_ENV.token);
  });
  it("ค่าตั้งต้น = 13azukaoab/AGA-Bait-Dashboard branch main", () => {
    expect(dashboardSyncConfigFromEnv({ [DASHBOARD_ENV.token]: "t" })).toEqual({
      token: "t",
      target: { owner: "13azukaoab", repo: "AGA-Bait-Dashboard", branch: "main" },
    });
  });
  it("repo ผิดรูปแบบ = config_missing", () => {
    expect(() =>
      dashboardSyncConfigFromEnv({ [DASHBOARD_ENV.token]: "t", [DASHBOARD_ENV.repo]: "../x" }),
    ).toThrow(/owner\/repo/);
  });
});

describe("loadDashboardData", () => {
  it("legacy ก่อน go-live + ส่วนกลางคำนวณสดถึงเดือนที่จบแล้ว (ไม่รวมเดือนปัจจุบัน)", async () => {
    const { client } = fakeClient(baseTables(), { go_live_month: "2026-10-01" });
    const data = await loadDashboardData(client, NOV_6);
    expect(Object.keys(data)).toEqual(["SEP.26", "OCT.26"]);
    expect(data["OCT.26"]).toHaveLength(43);
    expect(data["OCT.26"]!.find((r) => r.branch === "นครปฐม")).toMatchObject({ m1: 1, value: 40000 });
    // ต่างจังหวัดเดือน go-live ยังไม่มี manual → ยก legacy (5.12a)
    expect(data["OCT.26"]!.find((r) => r.branch === "เชียงใหม่")?.value).toBe(100);
  });

  it("เดือนส่วนกลางที่ปิดแล้วใช้ snapshot ที่เก็บไว้ (กรองเฉพาะ scope central ที่ปิดจริง)", async () => {
    const t = baseTables();
    t.month_closures = [
      { month_key: "2026-10", scope: "central", closed_at: "2026-11-02T02:00:00Z" },
    ];
    t.monthly_branch_snapshots!.push(
      ...BRANCHES.filter((b) => b.division === "central").map((b) => snapshot("2026-10", b.branch, "computed", 5)),
    );
    const { client } = fakeClient(t, { go_live_month: "2026-10-01" });
    const data = await loadDashboardData(client, NOV_6);
    expect(data["OCT.26"]!.find((r) => r.branch === "นครปฐม")?.value).toBe(5);
  });

  it("ปิดต่างจังหวัด / ยังไม่ได้ปิดจริง (closed_at ว่าง) ไม่นับเป็นปิดส่วนกลาง", async () => {
    const t = baseTables();
    t.month_closures = [
      { month_key: "2026-10", scope: "province", closed_at: "2026-11-02T02:00:00Z" },
      { month_key: "2026-10", scope: "central", closed_at: null },
    ];
    const { client } = fakeClient(t, { go_live_month: "2026-10-01" });
    const data = await loadDashboardData(client, NOV_6);
    expect(data["OCT.26"]!.find((r) => r.branch === "นครปฐม")?.value).toBe(40000);
  });

  it("อ่านแบบแบ่งหน้าครบทุกแถว (เกิน 1,000)", async () => {
    const t = baseTables();
    t.visits = Array.from({ length: 2500 }, (_, i) => ({
      id: `v${String(i).padStart(5, "0")}`, contract_id: "k1", visit_date: "2026-10-10",
      visit_type: "routine", makeup_for_month: null,
    }));
    const { client, calls } = fakeClient(t, { go_live_month: "2026-10-01" });
    await loadDashboardData(client, NOV_6);
    expect(calls.ranges.filter((c) => c.table === "visits").map((c) => c.from)).toEqual([0, 1000, 2000]);
  });

  it("go_live_month อ่านไม่ได้ = load_failed", async () => {
    const { client } = fakeClient(baseTables());
    await expect(loadDashboardData(client, NOV_6)).rejects.toMatchObject({ code: "load_failed" });
  });
});

describe("supabaseSyncPorts", () => {
  it("startLog / finishLog เรียก RPC ด้วยชื่อพารามิเตอร์ตาม migration", async () => {
    const { client, calls } = fakeClient({}, { start_sync_log: 42, finish_sync_log: null });
    const p = supabaseSyncPorts(client);
    expect(await p.startLog("manual")).toBe(42);
    await p.finishLog(42, { result: "skipped", monthsSent: [], monthCount: 22 });
    expect(calls.rpc).toEqual([
      { name: "start_sync_log", args: { p_source: "manual" } },
      {
        name: "finish_sync_log",
        args: {
          p_id: 42, p_result: "skipped", p_error_code: null, p_error_message: null,
          p_months_sent: [], p_month_count: 22, p_commit_sha: null,
        },
      },
    ]);
  });

  it("startLog คืน null (cron ชนรอบอื่น) = null", async () => {
    const { client } = fakeClient({}, { start_sync_log: null });
    expect(await supabaseSyncPorts(client).startLog("auto")).toBeNull();
  });

  it("push ไม่มี token = throw config_missing (runDashboardSync บันทึกเป็น failed)", async () => {
    const { client } = fakeClient({});
    await expect(supabaseSyncPorts(client, { env: {} }).push({})).rejects.toMatchObject({ code: "config_missing" });
  });
});
