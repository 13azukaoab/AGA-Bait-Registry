/**
 * เทสชั้นเขียน DB ของการนำเข้าทะเบียนส่วนกลาง ด้วย client ปลอม (ไม่แตะฐานข้อมูลจริง · ข้อมูลสมมติทั้งหมด)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { TIER_RULES } from "../rules/__fixtures__/tierRules";
import { FORM_COLUMNS, formHeaders, formRowValues, planManualRows, readManualRowsForm, type FormRow } from "./manualRowsForm";
import { findExistingContracts, importRegistryPlan, safeDbError, verifyBatchImport, verifyRegistryImport } from "./registryDbImport";
import { planRegistryImport, type RegistryImportPlan } from "./registryImportPlan";
import type { CellValue } from "./registrySheet";

type Row = Record<string, unknown>;

function serial(iso: string): number {
  return (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000;
}
const TOP: CellValue[] = [null, null, null, null, null, "Site plan", "ระยะสัญญา", null, "มูลค่าสัญญา", null, "ประเภทลูกค้า", "ประเภทสัญญา"];
const BOTTOM: CellValue[] = ["ลำดับ", "ชื่อลูกค้า", "ที่อยู่ลูกค้า", "เลขที่สัญญา", "เบอร์โทรลูกค้า", "IG", "เริ่ม", "สิ้นสุด", "1 ปี", "3 ปี", "H = บ้าน /T = ทาวน์โฮม/R=ห้อง", false, false, "ทีม"];
const sheet = (rows: CellValue[][]): CellValue[][] => [[], ["สาขาสมมติ"], [], TOP, BOTTOM, ...rows];

const PLAN: RegistryImportPlan = planRegistryImport(
  [
    {
      sheet: "สาทร",
      branch: "สาทร",
      grid: sheet([
        [1, "ลูกค้าสมมติ 1", " บ้านสมมติ 1  ถนนสมมติ ", "CT26-0000001", "081-000-0001 คุณสมมติ / 02-000-0002", 4, serial("2026-01-15"), serial("2027-01-14"), 15000.5, null, "H", true, false, "A"],
        [2, "ลูกค้าสมมติ 2", "", "CT25-0000002", "081-000-00012 ผิดรูป", 4, serial("2025-06-01"), serial("2028-05-31"), null, 150000, "T", false, true, "B,C"],
        [3, "ลูกค้าสมมติ 3", "", "CT26-0000003", "", 4, serial("2026-05-15"), serial("2026-10-14"), 50000, null, "R", false, false, ""],
      ]),
    },
    {
      sheet: "ปทุมวัน",
      branch: "ปทุมวัน",
      grid: sheet([[1, "ลูกค้าสมมติ 4", "ที่อยู่สมมติ 4", "CT26-0000004", "089-000-0004", 4, serial("2026-07-01"), serial("2027-06-30"), 45000, null, "H", true, false, "A"]]),
    },
  ],
  { rules: TIER_RULES, month: "2026-10", importBatch: "registry-TEST" },
);

interface FakeInit {
  failInsert?: string;
  /** แก้แถวตอนเก็บ (จำลอง DB เก็บค่าไม่ตรงที่ส่ง) */
  mutateInsert?: (table: string, row: Row) => Row;
  types?: Row[];
  teams?: Row[];
  customers?: Row[];
  contracts?: Row[];
}

/** PostgREST จำลองขั้นต่ำ: select(head/count) · in · order · range · insert · delete (contracts → cascade contract_teams) */
function fakeClient(init: FakeInit = {}) {
  const db: Record<string, Row[]> = {
    branches: [
      { id: "b-sathorn", name: "สาทร" },
      { id: "b-pathum", name: "ปทุมวัน" },
      { id: "b-other", name: "หัวหิน" },
    ],
    customer_types: init.types ?? [
      { code: "house", label: "บ้านเดี่ยว", is_active: true },
      { code: "townhome", label: "ทาวน์โฮม / ตึกแถว", is_active: true },
      { code: "condo", label: "คอนโด / อพาร์ตเมนต์ / หอพัก", is_active: true },
      { code: "other", label: "อื่นๆ (ระบุในหมายเหตุ)", is_active: true },
    ],
    teams: init.teams ?? [
      { id: "t-A", code: "A", branch_id: null, kind: "service", is_active: true },
      { id: "t-B", code: "B", branch_id: null, kind: "service", is_active: true },
      { id: "t-C", code: "C", branch_id: null, kind: "service", is_active: true },
      { id: "t-A-sathorn", code: "A", branch_id: "b-sathorn", kind: "service", is_active: true },
    ],
    tier_rules: [
      { tier: "S", min_annual: 0, effective_month: "2000-01-01" },
      { tier: "M", min_annual: 30000, effective_month: "2000-01-01" },
      { tier: "L", min_annual: 50000, effective_month: "2000-01-01" },
      { tier: "XL", min_annual: 100000, effective_month: "2000-01-01" },
    ],
    customers: (init.customers ?? []).map((r) => ({ ...r })),
    contracts: (init.contracts ?? []).map((r) => ({ ...r })),
    contract_teams: [],
    customer_phones: [],
  };
  const log = { inserts: 0, deletes: [] as string[] };
  const client = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let mode: "select" | "insert" | "delete" = "select";
      let head = false;
      let range: [number, number] | null = null;
      let payload: Row[] = [];
      const exec = () => {
        const t = db[table]!;
        if (mode === "insert") {
          if (init.failInsert === table) {
            return { error: { code: "23514", message: `new row for relation "${table}" violates check constraint "x"`, details: "Failing row contains (ลูกค้าสมมติ 1)" } };
          }
          if (table === "contracts" && payload.some((p) => t.some((r) => r.contract_no === p.contract_no))) {
            return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          log.inserts++;
          const stored = payload.map((r) => ({ cancelled_at: null, stations_initialized_at: null, renewed_from_contract_id: null, ...r }));
          t.push(...(init.mutateInsert ? stored.map((r) => init.mutateInsert!(table, r)) : stored));
          return { error: null };
        }
        const hit = t.filter((r) => filters.every((f) => f(r)));
        if (mode === "delete") {
          log.deletes.push(table);
          db[table] = t.filter((r) => !hit.includes(r));
          const ids = new Set(hit.map((r) => r.id));
          if (table === "contracts") db.contract_teams = db.contract_teams!.filter((r) => !ids.has(r.contract_id));
          if (table === "customers") db.customer_phones = db.customer_phones!.filter((r) => !ids.has(r.customer_id));
          return { error: null };
        }
        if (head) return { data: null, count: hit.length, error: null };
        return { data: range ? hit.slice(range[0], range[1] + 1) : hit, error: null };
      };
      const q = {
        select(_cols?: string, o?: { head?: boolean }) {
          if (o?.head) head = true;
          return q;
        },
        in(col: string, vals: unknown[]) {
          filters.push((r) => vals.includes(r[col]));
          return q;
        },
        order: () => q,
        range(a: number, b: number) {
          range = [a, b];
          return q;
        },
        insert(rows: Row[]) {
          mode = "insert";
          payload = rows;
          return q;
        },
        delete() {
          mode = "delete";
          return q;
        },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve(exec()).then(res, rej);
        },
      };
      return q;
    },
  };
  let n = 0;
  const newId = () => `id-${++n}`;
  return { client: client as unknown as SupabaseClient, db, log, newId };
}

describe("importRegistryPlan", () => {
  it("dryRun: ตรวจครบแต่ไม่เขียน", async () => {
    const f = fakeClient();
    const res = await importRegistryPlan(f.client, PLAN, { dryRun: true, newId: f.newId });
    expect(res.planned).toEqual({ customers: 4, customerPhones: 3, contracts: 4, contractTeams: 4 });
    expect(res.written).toEqual({ customers: 0, customerPhones: 0, contracts: 0, contractTeams: 0 });
    expect(f.log.inserts).toBe(0);
  });

  it("เขียนจริง: 1 แถวสัญญา = ลูกค้า 1 ราย · ประเภทเป็น code · ทีมของสาขาก่อนทีมกลาง · มูลค่า 2 ตำแหน่ง", async () => {
    const f = fakeClient();
    const res = await importRegistryPlan(f.client, PLAN, { newId: f.newId });
    expect(res.written).toEqual({ customers: 4, customerPhones: 3, contracts: 4, contractTeams: 4 });
    // เบอร์: ตัวเลขล้วน · ข้อความ = label · ผิดรูป = ไม่เก็บ (ลูกค้า 2 ไม่มีเบอร์)
    const c1Customer = f.db.contracts!.find((c) => c.contract_no === "CT26-0000001")!.customer_id;
    expect(f.db.customer_phones!.filter((p) => p.customer_id === c1Customer)).toMatchObject([
      { customer_id: c1Customer, phone: "0810000001", label: "คุณสมมติ", sort_order: 0 },
      { customer_id: c1Customer, phone: "020000002", label: null, sort_order: 1 },
    ]);
    const c2Customer = f.db.contracts!.find((c) => c.contract_no === "CT25-0000002")!.customer_id;
    expect(f.db.customer_phones!.filter((p) => p.customer_id === c2Customer)).toEqual([]);
    expect(f.db.customers!.map((c) => [c.branch_id, c.customer_type])).toEqual([
      ["b-sathorn", "house"], ["b-sathorn", "townhome"], ["b-sathorn", "condo"], ["b-pathum", "house"],
    ]);
    const c1 = f.db.contracts!.find((c) => c.contract_no === "CT26-0000001")!;
    expect(f.db.contracts!.every((c) => c.import_batch === "registry-TEST")).toBe(true);
    expect(c1).toMatchObject({ value_total: "15000.50", term_months: 12, sale_type: "new", start_date: "2026-01-15", end_date: "2027-01-14", is_urgent: false });
    expect(f.db.contracts!.find((c) => c.contract_no === "CT26-0000003")).toMatchObject({ term_months: 5, sale_type: null, status: "active" });
    // ทีม A ของสาทร = ทีมประจำสาขา · ปทุมวันไม่มีทีมประจำ → ทีมกลาง
    const teamOf = (no: string) =>
      f.db.contract_teams!.filter((t) => t.contract_id === f.db.contracts!.find((c) => c.contract_no === no)!.id).map((t) => t.team_id);
    expect(teamOf("CT26-0000001")).toEqual(["t-A-sathorn"]);
    expect(teamOf("CT25-0000002")).toEqual(["t-B", "t-C"]);
    expect(teamOf("CT26-0000004")).toEqual(["t-A"]);
  });

  it("2.102: ที่อยู่ลง customers.address (ล้างช่องว่างแล้ว · ว่าง = null) — ที่อยู่สมมติ", async () => {
    const f = fakeClient();
    await importRegistryPlan(f.client, PLAN, { newId: f.newId });
    expect(f.db.customers!.map((c) => c.address)).toEqual(["บ้านสมมติ 1 ถนนสมมติ", null, null, "ที่อยู่สมมติ 4"]);
  });

  it("2.102: อ่านกลับแล้วที่อยู่ไม่ตรง = หยุด · ข้อความไม่มีที่อยู่", async () => {
    const f = fakeClient({ mutateInsert: (t, r) => (t === "customers" && r.address ? { ...r, address: `${String(r.address)}x` } : r) });
    const err = await importRegistryPlan(f.client, PLAN, { newId: f.newId }).catch((e: Error) => e);
    expect(String(err)).toMatch(/อ่านกลับไม่ตรง.*ช่องไม่ตรง 2/);
    expect(String(err)).not.toContain("สมมติ");
  });

  it("รันซ้ำ = หยุดก่อนเขียน (ไม่เกิดแถวซ้ำ)", async () => {
    const f = fakeClient();
    await importRegistryPlan(f.client, PLAN, { newId: f.newId });
    const inserts = f.log.inserts;
    await expect(importRegistryPlan(f.client, PLAN, { newId: f.newId })).rejects.toThrow(/พบข้อมูลเดิม/);
    expect(f.log.inserts).toBe(inserts);
    expect(f.db.contracts).toHaveLength(4);
  });

  it("มีเลขสัญญาในแผนอยู่แล้ว (สาขาอื่น) = หยุด", async () => {
    const f = fakeClient({ contracts: [{ id: "x", customer_id: "c-x", contract_no: "CT26-0000004" }] });
    await expect(importRegistryPlan(f.client, PLAN, { dryRun: true })).rejects.toThrow(/เลขสัญญาในแผน 1/);
  });

  it("มีลูกค้าในสาขาเป้าหมายอยู่แล้ว = หยุด", async () => {
    const f = fakeClient({ customers: [{ id: "c-x", branch_id: "b-pathum", name: "เดิม" }] });
    await expect(importRegistryPlan(f.client, PLAN, { dryRun: true })).rejects.toThrow(/ลูกค้า 1/);
  });

  it("ประเภทลูกค้าไม่อยู่ใน master หรือปิดใช้ = หยุด (ข้อความมีแค่ป้ายประเภท)", async () => {
    const types = [
      { code: "house", label: "บ้านเดี่ยว", is_active: true },
      { code: "townhome", label: "ทาวน์โฮม / ตึกแถว", is_active: false },
    ];
    const f = fakeClient({ types });
    const err = await importRegistryPlan(f.client, PLAN, { dryRun: true }).catch((e: Error) => e);
    expect(String(err)).toMatch(/ทาวน์โฮม \/ ตึกแถว.*คอนโด/);
    expect(String(err)).not.toContain("ลูกค้าสมมติ");
  });

  it("ทีมไม่พบ / ทีมหัวหน้างาน / ทีมปิด = หยุด", async () => {
    const teams = [
      { id: "t-A", code: "A", branch_id: null, kind: "supervisor", is_active: true },
      { id: "t-B", code: "B", branch_id: null, kind: "service", is_active: false },
    ];
    const err = await importRegistryPlan(fakeClient({ teams }).client, PLAN, { dryRun: true }).catch((e: Error) => e);
    expect(String(err)).toMatch(/ทีม A เป็นทีมหัวหน้างาน/);
    expect(String(err)).toMatch(/ทีม B ปิดใช้งาน/);
    expect(String(err)).toMatch(/ไม่พบทีม C/);
  });

  it("เขียนพังกลางทาง → ลบที่เขียนแล้วคืนครบ · error ไม่มีข้อมูลลูกค้า (ไม่ใช้ details)", async () => {
    const f = fakeClient({ failInsert: "contract_teams" });
    const err = await importRegistryPlan(f.client, PLAN, { newId: f.newId }).catch((e: Error) => e);
    expect(String(err)).toMatch(/เขียน contract_teams ไม่สำเร็จ: \[23514\]/);
    expect(String(err)).toMatch(/ลบที่เขียนไปแล้วคืนครบ/);
    expect(String(err)).not.toContain("ลูกค้าสมมติ");
    expect(f.db.customers).toHaveLength(0);
    expect(f.db.customer_phones).toHaveLength(0);
    expect(f.db.contracts).toHaveLength(0);
    expect(f.log.deletes).toEqual(["contracts", "customers"]);
  });

  it("safeDbError ใช้แค่ code + message", () => {
    expect(safeDbError({ code: "23505", message: "dup", details: "Key (contract_no)=(CT…)" } as never)).toBe("[23505] dup");
  });
});

describe("verifyRegistryImport", () => {
  it("หลังนำเข้า: ยอดเดือนจาก DB ตรงกับแผนทุกสาขา", async () => {
    const f = fakeClient();
    await importRegistryPlan(f.client, PLAN, { newId: f.newId });
    const v = await verifyRegistryImport(f.client, PLAN);
    expect(v.ok).toBe(true);
    expect(v.branches.map((b) => b.mismatches)).toEqual([[], []]);
    // สาทร: 1 ปี + 3 ปี ครอบ ต.ค. · 5 เดือน (พ.ค.–ก.ย.) ไม่ครอบ
    expect(v.branches[0]).toMatchObject({ dbContracts: 3, expected: { cust: 2, value: 165000.5 }, actual: { cust: 2, value: 165000.5 } });
    expect(v.totals).toMatchObject({ plannedContracts: 4, dbContracts: 4, expectedCust: 3, actualCust: 3 });
  });

  it("มูลค่าใน DB ต่างจากแผน → ไม่ผ่าน (บอกชื่อช่อง)", async () => {
    const f = fakeClient();
    await importRegistryPlan(f.client, PLAN, { newId: f.newId });
    f.db.contracts!.find((c) => c.contract_no === "CT26-0000001")!.value_total = "15000.49";
    const v = await verifyRegistryImport(f.client, PLAN);
    expect(v.ok).toBe(false);
    expect(v.branches[0]!.mismatches).toEqual(["vS", "value"]);
  });

  it("สัญญาใน DB ไม่มี import_batch ตามแผน → ไม่ผ่าน", async () => {
    const f = fakeClient();
    await importRegistryPlan(f.client, PLAN, { newId: f.newId });
    f.db.contracts!.find((c) => c.contract_no === "CT26-0000004")!.import_batch = null;
    const v = await verifyRegistryImport(f.client, PLAN);
    expect(v.branches.map((b) => b.mismatches)).toEqual([[], ["import_batch"]]);
  });

  it("2.102: จำนวนลูกค้าที่มีที่อยู่ต่อสาขาไม่ตรงแผน → ไม่ผ่าน (บอกชื่อช่องเท่านั้น)", async () => {
    const f = fakeClient();
    await importRegistryPlan(f.client, PLAN, { newId: f.newId });
    f.db.customers!.find((c) => c.address === "ที่อยู่สมมติ 4")!.address = null;
    const v = await verifyRegistryImport(f.client, PLAN);
    expect(v.branches.map((b) => b.mismatches)).toEqual([[], ["ที่อยู่"]]);
    expect(v.branches.map((b) => b.addresses)).toEqual([{ expected: 1, actual: 1 }, { expected: 1, actual: 0 }]);
    expect(JSON.stringify(v)).not.toContain("สมมติ");
  });

  it("เบอร์ใน DB ไม่ครบตามแผน → ไม่ผ่าน", async () => {
    const f = fakeClient();
    await importRegistryPlan(f.client, PLAN, { newId: f.newId });
    f.db.customer_phones!.pop();
    const v = await verifyRegistryImport(f.client, PLAN);
    expect(v.branches.flatMap((b) => b.mismatches)).toEqual(["เบอร์โทร"]);
  });

  it("มีสัญญาเกินแผนในสาขา (เช่นแถวกรอกมือหลุดเข้า) → ไม่ผ่าน", async () => {
    const f = fakeClient();
    await importRegistryPlan(f.client, PLAN, { newId: f.newId });
    f.db.contracts!.push({
      id: "extra", customer_id: f.db.customers![0]!.id, contract_no: "CT26-0000999", start_date: "2026-01-01",
      end_date: "2026-12-31", term_months: 12, value_total: "100.00", cancelled_at: null, stations_initialized_at: null,
      renewed_from_contract_id: null, sale_name: null, am_name: null,
    });
    const v = await verifyRegistryImport(f.client, PLAN);
    expect(v.branches[0]!.mismatches).toEqual(expect.arrayContaining(["ชุดเลขสัญญา", "จำนวนสัญญา", "cust"]));
  });
});

// ---------------------------------------------------------------------
// โหมด append — แบบฟอร์มกรอกแถวที่นำเข้าไม่ได้ (DECISIONS 2.104 · ข้อมูลสมมติ)
// ---------------------------------------------------------------------

function fixPlan(batch = "registry-OCT26-fix1", skip?: Set<string>): RegistryImportPlan {
  const blank = Object.fromEntries(FORM_COLUMNS.map((c) => [c.key, ""])) as FormRow;
  const r = (o: Partial<FormRow>): FormRow => ({
    ...blank,
    fixed: "ใช่",
    customerType: "H",
    startDate: "01/07/2026",
    endDate: "30/06/2027",
    value1y: "45000",
    saleType: "Renew",
    team: "A",
    ...o,
  });
  const read = readManualRowsForm([
    formHeaders(),
    formRowValues(r({ branch: "สาทร", excelRow: "19", contractNo: "CT26-0000101", customerName: "ลูกค้าสมมติ 101", phone: "0810000101", address: "ที่อยู่สมมติ 101" })),
    formRowValues(r({ branch: "ปทุมวัน", excelRow: "7", contractNo: "CT26-0000102", customerName: "ลูกค้าสมมติ 102", value1y: "", value3y: "150000", startDate: "01/01/2026", endDate: "31/12/2028" })),
  ]);
  expect(read.invalid).toEqual([]);
  return planManualRows(read.accepted, { rules: TIER_RULES, month: "2026-10", importBatch: batch, skipContractNos: skip }).plan;
}

describe("importRegistryPlan โหมด append (2.104)", () => {
  it("สาขามีข้อมูลรอบแรกอยู่แล้ว: full = หยุดเหมือนเดิม · append = เขียนได้ · ตรวจรอบด้วย verifyBatchImport ผ่าน", async () => {
    const f = fakeClient();
    await importRegistryPlan(f.client, PLAN, { newId: f.newId }); // รอบแรก (registry-TEST)
    const fix = fixPlan();
    await expect(importRegistryPlan(f.client, fix, { dryRun: true })).rejects.toThrow(/พบข้อมูลเดิมในสาขาเป้าหมาย/);
    const dry = await importRegistryPlan(f.client, fix, { dryRun: true, mode: "append", newId: f.newId });
    expect(dry.existing).toMatchObject({ customersInBranches: 4, contractNos: 0, batchContracts: 0 });
    const res = await importRegistryPlan(f.client, fix, { mode: "append", newId: f.newId });
    expect(res.written).toEqual({ customers: 2, customerPhones: 1, contracts: 2, contractTeams: 2 });
    expect(f.db.contracts!.filter((c) => c.import_batch === "registry-OCT26-fix1").map((c) => c.contract_no)).toEqual(["CT26-0000101", "CT26-0000102"]);
    expect(f.db.contracts!.filter((c) => c.import_batch === "registry-TEST")).toHaveLength(4); // รอบแรกไม่ถูกแตะ

    const v = await verifyBatchImport(f.client, fix);
    expect(v.ok).toBe(true);
    expect(v.branches.map((b) => [b.branch, b.dbContracts, b.mismatches])).toEqual([
      ["สาทร", 1, []],
      ["ปทุมวัน", 1, []],
    ]);
    expect(v.totals).toMatchObject({ plannedContracts: 2, dbContracts: 2, expectedCust: 2, actualCust: 2, expectedValue: 195000, actualValue: 195000 });
    // ตัวตรวจทะเบียนเต็มใช้กับรอบ append ไม่ได้ (นับสัญญารอบแรกด้วย) — เหตุที่ต้องมี verifyBatchImport
    expect((await verifyRegistryImport(f.client, fix)).ok).toBe(false);
    expect(JSON.stringify(v)).not.toContain("สมมติ");
  });

  it("ห้ามใช้ batch รอบแรก · batch นี้มีสัญญาแล้ว = หยุด (1 รอบ = 1 batch)", async () => {
    const f = fakeClient();
    await expect(importRegistryPlan(f.client, { ...fixPlan(), importBatch: "registry-OCT26" }, { dryRun: true, mode: "append" })).rejects.toThrow(
      /ห้ามใช้ batch รอบแรก/,
    );
    await importRegistryPlan(f.client, fixPlan(), { mode: "append", newId: f.newId });
    const again = fixPlan("registry-OCT26-fix1", new Set(["CT26-0000101", "CT26-0000102"]));
    await expect(importRegistryPlan(f.client, again, { dryRun: true, mode: "append" })).rejects.toThrow(/batch registry-OCT26-fix1 มีสัญญาอยู่แล้ว 2/);
  });

  it("เลขสัญญาในแผนมีใน DB แล้ว = หยุด (ด่านสุดท้าย) · findExistingContracts บอก batch + สาขา แล้วตัดออกจากแผนได้", async () => {
    const f = fakeClient();
    await importRegistryPlan(f.client, PLAN, { newId: f.newId });
    // จำลอง: แอดมินเปิดสัญญา CT26-0000101 ในแอปไปแล้ว (import_batch ว่าง)
    f.db.contracts!.push({ id: "app-1", customer_id: f.db.customers![3]!.id, contract_no: "CT26-0000101", import_batch: null });
    await expect(importRegistryPlan(f.client, fixPlan("registry-OCT26-fix2"), { dryRun: true, mode: "append" })).rejects.toThrow(
      /เลขสัญญาในแผนมีใน DB แล้ว 1/,
    );
    const existing = await findExistingContracts(f.client, ["CT26-0000101", "CT26-0000102", "CT26-0000001"]);
    expect([...existing.values()]).toEqual([
      { contractNo: "CT26-0000001", importBatch: "registry-TEST", branch: "สาทร" },
      { contractNo: "CT26-0000101", importBatch: null, branch: "ปทุมวัน" },
    ]);
    const trimmed = fixPlan("registry-OCT26-fix2", new Set(existing.keys()));
    const res = await importRegistryPlan(f.client, trimmed, { mode: "append", newId: f.newId });
    expect(res.written.contracts).toBe(1);
    expect((await verifyBatchImport(f.client, trimmed)).ok).toBe(true);
  });

  it("verifyBatchImport: สัญญาของ batch อยู่สาขานอกแผน = ไม่ผ่าน", async () => {
    const f = fakeClient();
    const fix = fixPlan();
    await importRegistryPlan(f.client, fix, { mode: "append", newId: f.newId });
    const onlySathorn = { ...fix, branches: fix.branches.filter((b) => b.branch === "สาทร") };
    const v = await verifyBatchImport(f.client, onlySathorn);
    expect(v.ok).toBe(false);
    expect(v.strayContracts).toBe(1);
  });
});
