/**
 * เทสตัวนำเข้า legacy ด้วย client ปลอม (ไม่แตะฐานข้อมูลจริง · ข้อมูลสมมติ)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { BRANCHES } from "../dashboard/branches";
import type { DashboardData } from "../dashboard/types";
import { importLegacySnapshots } from "./legacySnapshotImport";

type Row = Record<string, unknown>;

/** client ปลอมขั้นต่ำ: rpc go_live_month · select/in/order/range · upsert (onConflict month_key,branch_id) */
function fakeClient(init: { snapshots?: Row[]; goLive?: string; branches?: Row[]; failUpsert?: boolean }) {
  const db = {
    branches: init.branches ?? BRANCHES.map((b, i) => ({ id: `b${i}`, name: b.branch })),
    monthly_branch_snapshots: (init.snapshots ?? []).map((r) => ({ ...r })),
  };
  const upserts: Row[][] = [];
  const client = {
    rpc: async (fn: string) =>
      fn === "go_live_month" ? { data: init.goLive ?? "2026-10-01", error: null } : { data: null, error: { message: "no fn" } },
    from(table: keyof typeof db) {
      let filter: ((r: Row) => boolean) | null = null;
      const q = {
        select: () => q,
        order: () => q,
        in(col: string, vals: unknown[]) {
          filter = (r) => vals.includes(r[col]);
          return q;
        },
        range: async (from: number, to: number) => ({
          data: db[table].filter((r) => (filter ? filter(r) : true)).slice(from, to + 1),
          error: null,
        }),
        upsert: async (rows: Row[]) => {
          if (init.failUpsert) return { error: { message: "denied" } };
          upserts.push(rows);
          const t = db.monthly_branch_snapshots;
          for (const r of rows) {
            const i = t.findIndex((x) => x.month_key === r.month_key && x.branch_id === r.branch_id);
            if (i >= 0) t[i] = { ...r };
            else t.push({ ...r });
          }
          return { error: null };
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, db, upserts };
}

function fakeData(keys: string[]): DashboardData {
  const out: DashboardData = {};
  for (const k of keys) {
    out[k] = BRANCHES.map((b, i) => ({
      area: b.area, branch: b.branch,
      s1: i, s3: 1, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
      cust: i + 1,
      vS: 1234.5 + i, vM: 0, vL: 0, vXL: 0, value: 1234.5 + i,
    }));
  }
  return out;
}

const DATA = fakeData(["AUG.26", "SEP.26", "OCT.26"]);

describe("importLegacySnapshots", () => {
  it("dryRun ไม่เขียนอะไร แต่ตรวจครบ", async () => {
    const { client, upserts } = fakeClient({});
    const res = await importLegacySnapshots(client, DATA, { dryRun: true });
    expect(upserts).toHaveLength(0);
    expect(res.goLiveMonth).toBe("2026-10");
    expect(res.conversion.rows).toHaveLength(86);
    expect(res.written).toBe(0);
  });

  it("เขียนครั้งเดียว 1 คำขอ · อ่านกลับตรง · month_key เป็น YYYY-MM · source legacy", async () => {
    const { client, db, upserts } = fakeClient({});
    const res = await importLegacySnapshots(client, DATA);
    expect(upserts).toHaveLength(1);
    expect(res.written).toBe(86);
    expect(db.monthly_branch_snapshots).toHaveLength(86);
    expect(new Set(db.monthly_branch_snapshots.map((r) => r.month_key))).toEqual(new Set(["2026-08", "2026-09"]));
    expect(db.monthly_branch_snapshots.every((r) => r.source === "legacy")).toBe(true);
    expect(res.totals.map((t) => t.rows)).toEqual([43, 43]);
  });

  it("รันซ้ำได้ (แถว legacy เดิมถูกเขียนทับ ไม่เพิ่มแถว)", async () => {
    const { client, db } = fakeClient({});
    await importLegacySnapshots(client, DATA);
    const res = await importLegacySnapshots(client, DATA);
    expect(res.existingLegacyBefore).toBe(86);
    expect(db.monthly_branch_snapshots).toHaveLength(86);
  });

  it("มีแถว computed/manual ในเดือนที่จะนำเข้า = หยุด ไม่เขียน", async () => {
    const { client, upserts } = fakeClient({
      snapshots: [{ month_key: "2026-09", branch_id: "b0", source: "manual" }],
    });
    await expect(importLegacySnapshots(client, DATA)).rejects.toThrow(/ไม่ใช่ legacy/);
    expect(upserts).toHaveLength(0);
  });

  it("ตาราง branches ขาดสาขา = หยุด", async () => {
    const { client, upserts } = fakeClient({
      branches: BRANCHES.slice(1).map((b, i) => ({ id: `b${i}`, name: b.branch })),
    });
    await expect(importLegacySnapshots(client, DATA)).rejects.toThrow(/ไม่มีสาขา/);
    expect(upserts).toHaveLength(0);
  });

  it("เขียนไม่ผ่าน (เช่น RLS) = throw", async () => {
    const { client } = fakeClient({ failUpsert: true });
    await expect(importLegacySnapshots(client, DATA)).rejects.toThrow(/เขียน/);
  });

  it("go-live อยู่ใน DB → เดือนที่นำเข้าเปลี่ยนตาม (ไม่ hardcode)", async () => {
    const { client } = fakeClient({ goLive: "2026-09-01" });
    const res = await importLegacySnapshots(client, DATA, { dryRun: true });
    expect(res.conversion.months).toEqual(["2026-08"]);
    expect(res.conversion.skippedKeys).toEqual(["SEP.26", "OCT.26"]);
  });
});
