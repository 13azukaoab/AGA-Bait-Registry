/**
 * เทสตัวถอยการนำเข้า (ทะเบียนตาม import_batch + legacy snapshot) ด้วย client ปลอม
 * (ไม่แตะฐานข้อมูลจริง · id/ข้อมูลสมมติทั้งหมด)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  LEGACY_ROLLBACK_MONTHS,
  RollbackIncompleteError,
  applyLegacyRollback,
  applyRegistryRollback,
  assertImportBatch,
  planLegacyRollback,
  planRegistryRollback,
} from "./importRollback";

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

const BATCH = "registry-TEST";

/** PostgREST จำลอง: select(count/head) · eq · in · gte · lte · order · range · delete(count) + cascade ตาม FK จริง */
function fakeClient(db: Db, opts: { failDelete?: { table: string; afterCalls: number } } = {}) {
  const calls = { deletes: [] as { table: string; n: number }[], deleteCalls: {} as Record<string, number> };
  const client = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let mode: "select" | "delete" = "select";
      let head = false;
      let wantCount = false;
      let range: [number, number] | null = null;
      const exec = () => {
        const t = db[table] ?? [];
        const hit = t.filter((r) => filters.every((f) => f(r)));
        if (mode === "delete") {
          calls.deleteCalls[table] = (calls.deleteCalls[table] ?? 0) + 1;
          if (opts.failDelete?.table === table && calls.deleteCalls[table]! > opts.failDelete.afterCalls) {
            return { data: null, count: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
          }
          if (table === "contracts" && (db.visits ?? []).some((v) => hit.some((c) => c.id === v.contract_id))) {
            return { data: null, count: null, error: { code: "23503", message: "violates foreign key constraint visits_contract_id_fkey" } };
          }
          if (table === "customers" && (db.contracts ?? []).some((c) => hit.some((cu) => cu.id === c.customer_id))) {
            return { data: null, count: null, error: { code: "23503", message: "violates foreign key constraint contracts_customer_id_fkey" } };
          }
          db[table] = t.filter((r) => !hit.includes(r));
          const ids = new Set(hit.map((r) => r.id));
          if (table === "contracts") {
            for (const child of ["contract_teams", "stations", "contract_files", "missed_service_resolutions", "missed_service_notes"]) {
              db[child] = (db[child] ?? []).filter((r) => !ids.has(r.contract_id));
            }
            db.station_transfers = (db.station_transfers ?? []).filter((r) => !ids.has(r.from_contract_id) && !ids.has(r.to_contract_id));
            for (const c of db.contracts ?? []) if (ids.has(c.renewed_from_contract_id)) c.renewed_from_contract_id = null;
          }
          if (table === "customers") db.customer_phones = (db.customer_phones ?? []).filter((r) => !ids.has(r.customer_id));
          calls.deletes.push({ table, n: hit.length });
          return { data: null, count: wantCount ? hit.length : null, error: null };
        }
        if (head) return { data: null, count: hit.length, error: null };
        return { data: range ? hit.slice(range[0], range[1] + 1) : hit, count: wantCount ? hit.length : null, error: null };
      };
      const q = {
        select(_cols?: string, o?: { head?: boolean; count?: string }) {
          if (o?.head) head = true;
          if (o?.count) wantCount = true;
          return q;
        },
        eq(col: string, v: unknown) {
          filters.push((r) => r[col] === v);
          return q;
        },
        in(col: string, vals: unknown[]) {
          filters.push((r) => vals.includes(r[col]));
          return q;
        },
        gte(col: string, v: string) {
          filters.push((r) => String(r[col]) >= v);
          return q;
        },
        lte(col: string, v: string) {
          filters.push((r) => String(r[col]) <= v);
          return q;
        },
        order: () => q,
        range(a: number, b: number) {
          range = [a, b];
          return q;
        },
        delete(o?: { count?: string }) {
          mode = "delete";
          if (o?.count) wantCount = true;
          return q;
        },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve(exec()).then(res, rej);
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, db, calls };
}

/** ทะเบียนนำเข้าสมมติ n สัญญา (1 สัญญา = ลูกค้า 1 ราย) + สัญญาที่เปิดในแอป 1 ราย (ลูกค้าแยก) */
function seed(n: number): Db {
  const db: Db = {
    customers: [{ id: "cu-app", branch_id: "b1" }],
    contracts: [{ id: "ct-app", customer_id: "cu-app", import_batch: null, renewed_from_contract_id: null }],
    contract_teams: [{ contract_id: "ct-app", team_id: "t-A" }],
    customer_phones: [{ customer_id: "cu-app", phone: "0800000000" }],
    visits: [{ id: "v-app", contract_id: "ct-app" }],
    stations: [],
    contract_files: [],
    missed_service_resolutions: [],
    missed_service_notes: [],
    station_transfers: [],
  };
  for (let i = 1; i <= n; i++) {
    db.customers!.push({ id: `cu-${i}`, branch_id: "b1" });
    db.contracts!.push({ id: `ct-${i}`, customer_id: `cu-${i}`, import_batch: BATCH, renewed_from_contract_id: null });
    db.contract_teams!.push({ contract_id: `ct-${i}`, team_id: "t-A" });
    if (i % 2) db.customer_phones!.push({ customer_id: `cu-${i}`, phone: "0811111111" });
  }
  return db;
}

describe("assertImportBatch", () => {
  it("ต้องมีค่า และตรงรูปแบบ CHECK ของ DB (A–Z a–z 0–9 . _ - · 1–64 ตัว)", () => {
    expect(assertImportBatch("registry-OCT26")).toBe("registry-OCT26");
    for (const bad of [undefined, "", "  ", "registry OCT26", "registry-OCT26;--", "%", "*", "a".repeat(65)]) {
      expect(() => assertImportBatch(bad)).toThrow(/--batch/);
    }
  });
});

describe("planRegistryRollback (dry-run)", () => {
  it("นับสัญญา/ลูกค้าของ batch + ของที่จะหายตาม cascade · ไม่ลบอะไร", async () => {
    const f = fakeClient(seed(5));
    const plan = await planRegistryRollback(f.client, BATCH);
    expect(plan.contracts).toBe(5);
    expect(plan.customers).toBe(5);
    expect(plan.cascades).toEqual({
      contractTeams: 5,
      customerPhones: 3,
      stations: 0,
      contractFiles: 0,
      missedServiceResolutions: 0,
      missedServiceNotes: 0,
      stationTransfers: 0,
    });
    expect(plan.blockers).toEqual({ visits: 0, otherContractsOnCustomers: 0, renewalsFromOutside: 0 });
    expect(plan.blocked).toBe(false);
    expect(f.calls.deletes).toEqual([]);
  });

  it("แบ่งหน้าเกิน 1,000 สัญญาได้ครบ", async () => {
    const f = fakeClient(seed(2369));
    const plan = await planRegistryRollback(f.client, BATCH);
    expect(plan.contracts).toBe(2369);
    expect(plan.cascades.contractTeams).toBe(2369);
  });

  it("มี visits อ้างสัญญาใน batch = blocked", async () => {
    const db = seed(3);
    db.visits!.push({ id: "v1", contract_id: "ct-2" });
    const plan = await planRegistryRollback(fakeClient(db).client, BATCH);
    expect(plan.blockers.visits).toBe(1);
    expect(plan.blocked).toBe(true);
  });

  it("มีสัญญาที่เปิดในแอปบนลูกค้านำเข้า = blocked (ลบลูกค้าไม่ได้ · RESTRICT)", async () => {
    const db = seed(3);
    db.contracts!.push({ id: "ct-new", customer_id: "cu-1", import_batch: null, renewed_from_contract_id: null });
    const plan = await planRegistryRollback(fakeClient(db).client, BATCH);
    expect(plan.blockers.otherContractsOnCustomers).toBe(1);
    expect(plan.blocked).toBe(true);
  });

  it("มีสัญญานอก batch ต่ออายุจากสัญญานำเข้า = blocked (ON DELETE SET NULL จะตัดลิงก์เงียบๆ)", async () => {
    const db = seed(3);
    db.customers!.push({ id: "cu-x", branch_id: "b1" });
    db.contracts!.push({ id: "ct-renew", customer_id: "cu-x", import_batch: null, renewed_from_contract_id: "ct-3" });
    const plan = await planRegistryRollback(fakeClient(db).client, BATCH);
    expect(plan.blockers.renewalsFromOutside).toBe(1);
    expect(plan.blocked).toBe(true);
  });

  it("แสดงจำนวนข้อมูลผู้ใช้ที่จะหายตาม cascade (สถานี/ไฟล์/บันทึกตกบริการ/ย้ายสถานี)", async () => {
    const db = seed(2);
    db.stations!.push({ id: "s1", contract_id: "ct-1" });
    db.contract_files!.push({ id: "f1", contract_id: "ct-1" });
    db.missed_service_resolutions!.push({ id: "r1", contract_id: "ct-2" });
    db.missed_service_notes!.push({ id: "n1", contract_id: "ct-2" });
    db.station_transfers!.push({ id: "x1", from_contract_id: "ct-1", to_contract_id: "ct-2" });
    const plan = await planRegistryRollback(fakeClient(db).client, BATCH);
    expect(plan.cascades).toMatchObject({ stations: 1, contractFiles: 1, missedServiceResolutions: 1, missedServiceNotes: 1, stationTransfers: 1 });
  });

  it("batch ไม่มีสัญญา = 0 (ไม่ error)", async () => {
    const plan = await planRegistryRollback(fakeClient(seed(0)).client, BATCH);
    expect(plan.contracts).toBe(0);
    expect(plan.blocked).toBe(false);
  });
});

describe("applyRegistryRollback", () => {
  it("ลบสัญญาก่อนลูกค้า · ทีม/เบอร์หายตาม cascade · ของในแอปไม่ถูกแตะ", async () => {
    const f = fakeClient(seed(450));
    const res = await applyRegistryRollback(f.client, BATCH, 450);
    expect(res).toEqual({ deletedContracts: 450, deletedCustomers: 450 });
    expect(f.db.contracts).toEqual([expect.objectContaining({ id: "ct-app" })]);
    expect(f.db.customers).toEqual([expect.objectContaining({ id: "cu-app" })]);
    expect(f.db.contract_teams).toEqual([expect.objectContaining({ contract_id: "ct-app" })]);
    expect(f.db.customer_phones).toEqual([expect.objectContaining({ customer_id: "cu-app" })]);
    // ทุกคำขอลบลูกค้าตามหลังคำขอลบสัญญาของชุดเดียวกัน
    const order = f.calls.deletes.map((d) => d.table);
    expect(order[0]).toBe("contracts");
    expect(order.filter((t) => t === "contracts").length).toBe(order.filter((t) => t === "customers").length);
  });

  it("มี visits = หยุดก่อนลบ (ไม่มีอะไรถูกลบ)", async () => {
    const db = seed(3);
    db.visits!.push({ id: "v1", contract_id: "ct-1" });
    const f = fakeClient(db);
    await expect(applyRegistryRollback(f.client, BATCH, 3)).rejects.toThrow(/visits 1/);
    expect(f.calls.deletes).toEqual([]);
    expect(f.db.contracts).toHaveLength(4);
  });

  it("จำนวนสัญญาเปลี่ยนจากตอน dry-run/ยืนยัน = หยุด", async () => {
    const f = fakeClient(seed(3));
    await expect(applyRegistryRollback(f.client, BATCH, 4)).rejects.toThrow(/จำนวนสัญญาเปลี่ยน/);
    expect(f.calls.deletes).toEqual([]);
  });

  it("ลบลูกค้าพังกลางทาง = RollbackIncompleteError พร้อม id ลูกค้าที่ค้าง (ไว้ลบต่อ) · ไม่มี error ซ่อน", async () => {
    const f = fakeClient(seed(450), { failDelete: { table: "customers", afterCalls: 1 } });
    const err = await applyRegistryRollback(f.client, BATCH, 450).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RollbackIncompleteError);
    const e = err as RollbackIncompleteError;
    expect(e.deletedContracts).toBe(400);
    expect(e.deletedCustomers).toBe(200);
    expect(e.orphanCustomerIds).toHaveLength(200);
    expect(e.orphanCustomerIds.every((id) => f.db.customers!.some((c) => c.id === id))).toBe(true);
    expect(f.db.contracts!.filter((c) => c.import_batch === BATCH)).toHaveLength(50);
    expect(e.message).toContain("57014");
  });

  it("รันซ้ำหลังลบครบ = ไม่มีอะไรให้ลบ (จำนวนที่ยืนยัน 0 ไม่ตรง → หยุด)", async () => {
    const f = fakeClient(seed(3));
    await applyRegistryRollback(f.client, BATCH, 3);
    await expect(applyRegistryRollback(f.client, BATCH, 3)).rejects.toThrow(/จำนวนสัญญาเปลี่ยน/);
  });
});

describe("legacy rollback", () => {
  function legacyDb(): Db {
    const rows: Row[] = [];
    for (const m of ["2024-12", "2025-01", "2025-06", "2026-09", "2026-10"]) {
      for (const b of ["b1", "b2"]) rows.push({ month_key: m, branch_id: b, source: m === "2026-10" ? "computed" : "legacy" });
    }
    rows.push({ month_key: "2025-02", branch_id: "b3", source: "manual" });
    return { monthly_branch_snapshots: rows };
  }

  it("ช่วงเดือนตามแผน 2025-01 … 2026-09", () => {
    expect(LEGACY_ROLLBACK_MONTHS).toEqual({ from: "2025-01", to: "2026-09" });
  });

  it("dry-run: นับเฉพาะ legacy ในช่วง · บอกจำนวนแถว source อื่นในช่วง (ไม่ลบ)", async () => {
    const f = fakeClient(legacyDb());
    const plan = await planLegacyRollback(f.client);
    expect(plan).toEqual({ legacyRows: 6, months: 3, otherSourceRows: 1 });
    expect(f.calls.deletes).toEqual([]);
  });

  it("apply: ลบเฉพาะ legacy ในช่วง · manual/computed/นอกช่วง อยู่ครบ", async () => {
    const f = fakeClient(legacyDb());
    await expect(applyLegacyRollback(f.client, 6)).resolves.toEqual({ deleted: 6 });
    const left = f.db.monthly_branch_snapshots!.map((r) => `${String(r.month_key)}/${String(r.source)}`).sort();
    expect(left).toEqual(["2024-12/legacy", "2024-12/legacy", "2025-02/manual", "2026-10/computed", "2026-10/computed"]);
  });

  it("จำนวนไม่ตรงกับที่ยืนยัน = หยุดก่อนลบ", async () => {
    const f = fakeClient(legacyDb());
    await expect(applyLegacyRollback(f.client, 903)).rejects.toThrow(/จำนวนแถว legacy เปลี่ยน/);
    expect(f.calls.deletes).toEqual([]);
  });
});
