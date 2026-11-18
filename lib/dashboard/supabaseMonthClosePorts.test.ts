import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { BRANCHES } from "./branches";
import { closeMonth } from "./monthClose";
import { setMonthCloser, supabaseMonthClosePorts } from "./supabaseMonthClosePorts";

// Supabase จำลอง — ไม่ต่อฐานข้อมูลจริง · GitHub ไม่ถูกเรียก (fetch จำลอง) · ข้อมูลสมมติทั้งหมด
type Row = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string; code?: string; details?: string } | null };

function fakeClient(tables: Record<string, Row[]>, rpc: Record<string, (args: unknown) => RpcResult>) {
  const calls: { name: string; args: unknown }[] = [];
  const client = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const builder = {
        select: () => builder,
        gt: (col: string, val: string) => {
          filters.push((r) => String(r[col]) > val);
          return builder;
        },
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return builder;
        },
        not: (col: string) => {
          filters.push((r) => r[col] != null);
          return builder;
        },
        order: () => builder,
        range: async (from: number, to: number) => {
          const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
      return builder;
    },
    rpc: async (name: string, args?: unknown) => {
      calls.push({ name, args });
      const fn = rpc[name];
      return fn ? fn(args) : { data: null, error: { message: `no rpc ${name}`, code: "PGRST202" } };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const ACTOR = "00000000-0000-0000-0000-0000000000b3";
const branchRows = BRANCHES.map((b, i) => ({ id: `b${String(i).padStart(2, "0")}`, name: b.branch }));
const idOf = (name: string) => branchRows.find((b) => b.name === name)!.id;
const CENTRAL_IDS = BRANCHES.filter((b) => b.division === "central").map((b) => idOf(b.branch));

function tables(): Record<string, Row[]> {
  return {
    branches: branchRows,
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

const closeOk = (args: unknown): RpcResult => {
  const a = args as { p_month: string; p_scope: string };
  return {
    data: { month: a.p_month, scope: a.p_scope, closed_at: "2026-11-02T01:00:00+00:00", overridden: true, unready_count: 24, carried_count: 0 },
    error: null,
  };
};

describe("supabaseMonthClosePorts", () => {
  it("ปิดส่วนกลาง: ส่งแถว 24 สาขา (branch_id) + เหตุผลเข้า RPC แล้วเริ่มรอบส่ง source close", async () => {
    const fetchImpl = vi.fn();
    const { client, calls } = fakeClient(tables(), {
      close_month_part: closeOk,
      start_sync_log: () => ({ data: null, error: { message: "busy", code: "SY001" } }),
    });
    const out = await closeMonth(supabaseMonthClosePorts(client, ACTOR, { fetchImpl: fetchImpl as unknown as typeof fetch }), {
      month: "2026-10",
      scope: "central",
      overrideReason: "สาขายังไม่มีหน้ายืนยัน",
    });

    const close = calls.find((c) => c.name === "close_month_part")!.args as {
      p_month: string; p_scope: string; p_rows: { branch_id: string; value: number }[];
      p_override_reason: string | null; p_ack_carried: boolean;
    };
    expect(close.p_month).toBe("2026-10");
    expect(close.p_scope).toBe("central");
    expect(close.p_override_reason).toBe("สาขายังไม่มีหน้ายืนยัน");
    expect(close.p_ack_carried).toBe(false);
    expect(close.p_rows.map((r) => r.branch_id).sort()).toEqual([...CENTRAL_IDS].sort());
    expect(close.p_rows.find((r) => r.branch_id === idOf("นครปฐม"))?.value).toBe(40000);

    // ผู้กด (actor) ไปถึง RPC ปิดเดือนและรอบส่ง Dashboard
    expect(close).toMatchObject({ p_actor: ACTOR });
    expect(calls.find((c) => c.name === "start_sync_log")?.args).toEqual({ p_source: "close", p_actor: ACTOR });
    expect(out.closure).toMatchObject({ overridden: true, unreadyCount: 24, closedAt: "2026-11-02T01:00:00+00:00" });
    expect(out.sync.result).toBe("busy");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ปิดต่างจังหวัด: ไม่อ่านทะเบียน · rows = null · ส่งค่ารับทราบ", async () => {
    const { client, calls } = fakeClient({}, {
      close_month_part: closeOk,
      start_sync_log: () => ({ data: null, error: { message: "busy", code: "SY001" } }),
    });
    await closeMonth(supabaseMonthClosePorts(client, ACTOR), { month: "2026-10", scope: "province", acknowledgeCarried: true });
    expect(calls.find((c) => c.name === "close_month_part")?.args).toMatchObject({
      p_scope: "province", p_rows: null, p_ack_carried: true,
    });
  });

  it("error ของ RPC ส่งต่อ code + details (MC006)", async () => {
    const details = JSON.stringify({ branches: [{ id: "b00", name: "x" }] });
    const { client } = fakeClient(tables(), {
      close_month_part: () => ({ data: null, error: { message: "unconfirmed", code: "MC006", details } }),
    });
    await expect(
      closeMonth(supabaseMonthClosePorts(client, ACTOR), { month: "2026-10", scope: "central" }),
    ).rejects.toMatchObject({ code: "MC006", details });
  });

  it("resync ส่วนกลาง: แปลงผล changed_branches", async () => {
    const { client, calls } = fakeClient(tables(), {
      resync_month_part: (a) => ({
        data: { month: (a as { p_month: string }).p_month, scope: "central", changed_branches: 3 },
        error: null,
      }),
    });
    const ports = supabaseMonthClosePorts(client, ACTOR);
    const rows = await ports.centralRows("2026-10");
    const res = await ports.resyncPart({ month: "2026-10", scope: "central", rows, computedAt: "2026-11-18T08:00:00.000Z" });
    expect(res).toEqual({ month: "2026-10", scope: "central", changedBranches: 3 });
    expect((calls[0]!.args as { p_rows: unknown[] }).p_rows).toHaveLength(CENTRAL_IDS.length);
    expect(calls[0]!.args).toMatchObject({ p_actor: ACTOR, p_computed_at: "2026-11-18T08:00:00.000Z" });
  });

  it("setMonthCloser ส่งพารามิเตอร์ตรงชื่อ RPC + ส่ง error ต่อ", async () => {
    const { client, calls } = fakeClient({}, { set_month_closer: () => ({ data: null, error: null }) });
    await setMonthCloser(client, {
      month: "2026-10", scope: "central", closedBy: "00000000-0000-0000-0000-000000000001", closedAt: "2026-11-01T03:00:00.000Z",
    });
    expect(calls[0]).toEqual({
      name: "set_month_closer",
      args: {
        p_month: "2026-10", p_scope: "central",
        p_closed_by: "00000000-0000-0000-0000-000000000001", p_closed_at: "2026-11-01T03:00:00.000Z",
      },
    });

    const failing = fakeClient({}, { set_month_closer: () => ({ data: null, error: { message: "x", code: "MC012" } }) });
    await expect(
      setMonthCloser(failing.client, { month: "2026-10", scope: "central", closedBy: "u", closedAt: "t" }),
    ).rejects.toMatchObject({ code: "MC012" });
  });
});
