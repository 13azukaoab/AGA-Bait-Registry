/**
 * เขียนแผนนำเข้าทะเบียนส่วนกลาง (registryImportPlan.ts) ลง customers / contracts / contract_teams + ตรวจยอดหลังเขียน
 * (phase 6 · SPEC §10, §15 · DECISIONS 2.70 / 2.73 / 2.76 / 2.78)
 *
 * Logic summary — importRegistryPlan:
 *   1. อ่านตารางอ้างอิงจาก DB: branches (ชื่อ → id) · customer_types (ป้าย → code · ต้อง is_active)
 *      · teams (รหัส → id: ทีมของสาขาก่อน ไม่มีใช้ทีมกลาง branch_id NULL · ห้าม supervisor / ปิดใช้งาน)
 *      หาไม่เจอแม้ตัวเดียว = หยุดก่อนเขียน (ไม่เดา)
 *   2. ด่านกันนำเข้าซ้ำ: มีลูกค้าในสาขาเป้าหมายอยู่แล้ว หรือมีเลขสัญญาในแผนอยู่แล้ว = หยุด (รันซ้ำไม่เกิดแถวซ้ำ)
 *   3. dryRun = จบตรงนี้ (ไม่เขียน)
 *   4. เขียนทีละตาราง customers → contracts → contract_teams (แบ่งชุดละ CHUNK แถว · id สร้างฝั่งนี้)
 *      PostgREST 1 คำขอ = 1 transaction แต่ "ข้ามตาราง" ไม่ใช่ transaction เดียว → ถ้าคำขอไหนพัง
 *      ลบที่เขียนไปแล้วคืน (contracts ก่อน → contract_teams หายตาม cascade → customers) แล้ว throw
 *      (การลบคืนลง audit_log ด้วย — ยอมรับได้ · DB ในเครื่องเท่านั้น)
 *   5. อ่านกลับแล้วเทียบทุกช่อง (เลขสัญญา/วันที่/เดือน/มูลค่าสตางค์/ประเภทขาย/ผู้ขาย/ลูกค้า/ทีม) ไม่ตรง = throw
 *
 * Logic summary — verifyRegistryImport (อ่านอย่างเดียว):
 *   อ่าน customers + contracts ของสาขาเป้าหมาย + tier_rules จาก DB → computeCentralRows (lib/dashboard/sources ·
 *   ตัวเดียวกับ Auto Sync → buildBranchSnapshot ใน lib/rules · ไม่มีสูตรใหม่) → เทียบกับ plan.expected ทุกช่อง (เงินเทียบสตางค์)
 *   + ชุดเลขสัญญาใน DB = ชุดในแผน (แถวกรอกมือ/แถวที่กันไว้ไม่หลุดเข้า DB) + จำนวน sale_name / am_name / ทีม
 *
 * สิทธิ์: ผู้เรียกส่ง client ที่เป็น service_role ผ่าน PostgREST (CLAUDE.md กฎ Deploy: ห้ามต่อด้วย role postgres)
 *   trigger ที่ตรวจกฎหน้าจอ (AG012 Renew ไม่ผูก · team_links_guard ฯลฯ) ยกเว้น service_role ตามที่ออกแบบไว้สำหรับนำเข้า
 *   → ตัวนี้จึงตรวจทีมเอง (ห้ามทีมหัวหน้างาน/ทีมปิด) · ไม่สร้าง client เอง
 * PDPA: ข้อความ error ใช้แค่ code + message ของ PostgREST (ไม่ใช้ details / hint ซึ่งมีค่าทั้งแถว) · ไม่พิมพ์ชื่อลูกค้า
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { computeCentralRows, type BranchContract } from "../dashboard/sources";
import { TIER_RULE_COLUMNS, toTierRules, type TierRuleRow } from "../tierRules";
import type { PlannedContract, RegistryImportPlan } from "./registryImportPlan";

type Row = Record<string, unknown>;

/** แถวต่อคำขอ — ต่ำกว่า max rows ของ PostgREST (1,000) เสมอ และ URL ของ .in() ไม่ยาวเกิน */
const CHUNK = 200;
const PAGE = 1000;

interface DbError {
  code?: string;
  message: string;
}

/** ข้อความ error ที่ปลอดภัย (ไม่มีค่าในแถว) */
export function safeDbError(e: DbError): string {
  return `${e.code ? `[${e.code}] ` : ""}${e.message}`;
}

function chunks<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const toCents = (v: number): number => Math.round(v * 100);

// ---------------------------------------------------------------------
// อ่านตารางอ้างอิง
// ---------------------------------------------------------------------

export interface ReferenceIds {
  branchId: Map<string, string>;
  typeCode: Map<string, string>;
  /** `${branchId}|${code}` → team id */
  teamId: Map<string, string>;
}

async function selectAll(client: SupabaseClient, table: string, columns: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select(columns).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`นำเข้า: อ่าน ${table} ไม่สำเร็จ: ${safeDbError(error)}`);
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** อ่าน + ตรวจตารางอ้างอิงทุกค่าที่แผนต้องใช้ · ขาด = throw (ข้อความมีแค่ชื่อสาขา/ป้ายประเภท/รหัสทีม) */
export async function loadReferenceIds(client: SupabaseClient, plan: RegistryImportPlan): Promise<ReferenceIds> {
  const [branches, types, teams] = await Promise.all([
    selectAll(client, "branches", "id, name"),
    client.from("customer_types").select("code, label, is_active"),
    selectAll(client, "teams", "id, code, branch_id, kind, is_active"),
  ]);
  if (types.error) throw new Error(`นำเข้า: อ่าน customer_types ไม่สำเร็จ: ${safeDbError(types.error)}`);

  const branchId = new Map(branches.map((b) => [String(b.name), String(b.id)]));
  const missingBranches = plan.branches.map((b) => b.branch).filter((n) => !branchId.has(n));
  if (missingBranches.length) throw new Error(`นำเข้า: ตาราง branches ไม่มีสาขา: ${missingBranches.join(", ")}`);

  const typeRows = (types.data ?? []) as unknown as Row[];
  const typeCode = new Map<string, string>();
  const inactive = new Set<string>();
  for (const t of typeRows) {
    typeCode.set(String(t.label), String(t.code));
    if (t.is_active === false) inactive.add(String(t.label));
  }
  const labels = [...new Set(plan.branches.flatMap((b) => b.contracts.map((c) => c.customerTypeLabel)))];
  const badLabels = labels.filter((l) => !typeCode.has(l) || inactive.has(l));
  if (badLabels.length) {
    throw new Error(`นำเข้า: ประเภทลูกค้าไม่อยู่ใน master หรือปิดใช้แล้ว: ${badLabels.join(", ")}`);
  }

  const teamId = new Map<string, string>();
  const problems: string[] = [];
  for (const b of plan.branches) {
    const bid = branchId.get(b.branch)!;
    const codes = [...new Set(b.contracts.flatMap((c) => c.teamCodes))].sort();
    for (const code of codes) {
      const team =
        teams.find((t) => t.code === code && t.branch_id === bid) ??
        teams.find((t) => t.code === code && (t.branch_id === null || t.branch_id === undefined));
      if (!team) problems.push(`${b.branch}: ไม่พบทีม ${code}`);
      else if (team.kind === "supervisor") problems.push(`${b.branch}: ทีม ${code} เป็นทีมหัวหน้างาน`);
      else if (team.is_active === false) problems.push(`${b.branch}: ทีม ${code} ปิดใช้งาน`);
      else teamId.set(`${bid}|${code}`, String(team.id));
    }
  }
  if (problems.length) throw new Error(`นำเข้า: ทีมใช้ไม่ได้ — ${problems.join(" · ")}`);

  return { branchId, typeCode, teamId };
}

// ---------------------------------------------------------------------
// ด่านกันนำเข้าซ้ำ
// ---------------------------------------------------------------------

export interface ExistingData {
  /** ลูกค้าที่มีอยู่แล้วในสาขาเป้าหมาย */
  customersInBranches: number;
  /** เลขสัญญาในแผนที่มีอยู่แล้วใน DB */
  contractNos: number;
}

export async function findExistingData(
  client: SupabaseClient,
  plan: RegistryImportPlan,
  refs: ReferenceIds,
): Promise<ExistingData> {
  const branchIds = plan.branches.map((b) => refs.branchId.get(b.branch)!);
  const cust = await client.from("customers").select("id", { count: "exact", head: true }).in("branch_id", branchIds);
  if (cust.error) throw new Error(`นำเข้า: ตรวจลูกค้าเดิมไม่สำเร็จ: ${safeDbError(cust.error)}`);

  let contractNos = 0;
  const nos = plan.branches.flatMap((b) => b.contracts.map((c) => c.contractNo));
  for (const part of chunks(nos)) {
    const res = await client.from("contracts").select("id", { count: "exact", head: true }).in("contract_no", part);
    if (res.error) throw new Error(`นำเข้า: ตรวจเลขสัญญาเดิมไม่สำเร็จ: ${safeDbError(res.error)}`);
    contractNos += res.count ?? 0;
  }
  return { customersInBranches: cust.count ?? 0, contractNos };
}

// ---------------------------------------------------------------------
// สร้างแถว
// ---------------------------------------------------------------------

export interface InsertRows {
  customers: Row[];
  contracts: Row[];
  contractTeams: Row[];
}

function contractRow(c: PlannedContract, id: string, customerId: string): Row {
  return {
    id,
    customer_id: customerId,
    contract_no: c.contractNo,
    start_date: c.startDate,
    end_date: c.endDate,
    term_months: c.termMonths,
    value_total: (toCents(c.valueTotal) / 100).toFixed(2),
    sale_type: c.saleType,
    sale_name: c.saleName,
    am_name: c.amName,
    is_urgent: c.isUrgent,
  };
}

/** แผน → แถวของ 3 ตาราง (1 แถวสัญญา = ลูกค้า 1 ราย · DECISIONS 2.59) */
export function buildInsertRows(plan: RegistryImportPlan, refs: ReferenceIds, newId: () => string): InsertRows {
  const out: InsertRows = { customers: [], contracts: [], contractTeams: [] };
  for (const b of plan.branches) {
    const bid = refs.branchId.get(b.branch)!;
    for (const c of b.contracts) {
      const customerId = newId();
      const contractId = newId();
      out.customers.push({ id: customerId, branch_id: bid, name: c.customerName, customer_type: refs.typeCode.get(c.customerTypeLabel)! });
      out.contracts.push(contractRow(c, contractId, customerId));
      for (const code of c.teamCodes) out.contractTeams.push({ contract_id: contractId, team_id: refs.teamId.get(`${bid}|${code}`)! });
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// นำเข้า
// ---------------------------------------------------------------------

export interface RegistryDbImportOptions {
  /** true = ตรวจอย่างเดียว ไม่เขียน */
  dryRun?: boolean;
  /** ตัวสร้าง uuid (เทสส่งตัวที่คาดได้) */
  newId?: () => string;
}

export interface RegistryDbImportResult {
  dryRun: boolean;
  existing: ExistingData;
  planned: { customers: number; contracts: number; contractTeams: number };
  written: { customers: number; contracts: number; contractTeams: number };
}

async function deleteByIds(client: SupabaseClient, table: string, ids: string[]): Promise<string | null> {
  for (const part of chunks(ids)) {
    const { error } = await client.from(table).delete().in("id", part);
    if (error) return `${table}: ${safeDbError(error)}`;
  }
  return null;
}

/** นำเข้า (หรือตรวจอย่างเดียวเมื่อ dryRun) — ดู Logic summary หัวไฟล์ */
export async function importRegistryPlan(
  client: SupabaseClient,
  plan: RegistryImportPlan,
  opts: RegistryDbImportOptions = {},
): Promise<RegistryDbImportResult> {
  const dryRun = opts.dryRun ?? false;
  const refs = await loadReferenceIds(client, plan);
  const existing = await findExistingData(client, plan, refs);
  if (existing.customersInBranches > 0 || existing.contractNos > 0) {
    throw new Error(
      `นำเข้า: พบข้อมูลเดิมในสาขาเป้าหมาย (ลูกค้า ${existing.customersInBranches} · เลขสัญญาในแผน ${existing.contractNos}) — หยุด ไม่เขียนซ้ำ`,
    );
  }
  const rows = buildInsertRows(plan, refs, opts.newId ?? (() => crypto.randomUUID()));
  const planned = { customers: rows.customers.length, contracts: rows.contracts.length, contractTeams: rows.contractTeams.length };
  if (dryRun) return { dryRun, existing, planned, written: { customers: 0, contracts: 0, contractTeams: 0 } };

  const written = { customers: 0, contracts: 0, contractTeams: 0 };
  const steps: [keyof typeof written, string, Row[]][] = [
    ["customers", "customers", rows.customers],
    ["contracts", "contracts", rows.contracts],
    ["contractTeams", "contract_teams", rows.contractTeams],
  ];
  for (const [key, table, list] of steps) {
    for (const part of chunks(list)) {
      const { error } = await client.from(table).insert(part);
      if (error) {
        const undo = [
          await deleteByIds(client, "contracts", rows.contracts.map((r) => String(r.id))),
          await deleteByIds(client, "customers", rows.customers.map((r) => String(r.id))),
        ].filter(Boolean);
        throw new Error(
          `นำเข้า: เขียน ${table} ไม่สำเร็จ: ${safeDbError(error)} — ` +
            (undo.length ? `⚠ ลบคืนไม่ครบ (${undo.join(" · ")}) ต้อง db reset` : "ลบที่เขียนไปแล้วคืนครบ (ไม่มีข้อมูลค้าง)"),
        );
      }
      written[key] += part.length;
    }
  }

  await readBackAndCompare(client, rows);
  return { dryRun, existing, planned, written };
}

/** อ่านกลับทุกแถวที่เขียน แล้วเทียบทุกช่อง (ไม่ตรง = throw · ข้อความมีแค่จำนวน) */
async function readBackAndCompare(client: SupabaseClient, rows: InsertRows): Promise<void> {
  let mismatches = 0;
  let found = 0;
  const wantContract = new Map(rows.contracts.map((r) => [String(r.id), r]));
  for (const part of chunks([...wantContract.keys()])) {
    const { data, error } = await client
      .from("contracts")
      .select("id, customer_id, contract_no, start_date, end_date, term_months, value_total, sale_type, sale_name, am_name, is_urgent")
      .in("id", part);
    if (error) throw new Error(`นำเข้า: อ่านกลับ contracts ไม่สำเร็จ: ${safeDbError(error)}`);
    for (const got of (data ?? []) as unknown as Row[]) {
      const want = wantContract.get(String(got.id));
      if (!want) continue;
      found++;
      for (const k of ["customer_id", "contract_no", "start_date", "end_date", "sale_type", "sale_name", "am_name", "is_urgent"]) {
        if ((got[k] ?? null) !== (want[k] ?? null)) mismatches++;
      }
      if (Number(got.term_months) !== want.term_months) mismatches++;
      if (toCents(Number(got.value_total)) !== toCents(Number(want.value_total))) mismatches++;
    }
  }

  const wantCustomer = new Map(rows.customers.map((r) => [String(r.id), r]));
  let customersFound = 0;
  for (const part of chunks([...wantCustomer.keys()])) {
    const { data, error } = await client.from("customers").select("id, branch_id, name, customer_type").in("id", part);
    if (error) throw new Error(`นำเข้า: อ่านกลับ customers ไม่สำเร็จ: ${safeDbError(error)}`);
    for (const got of (data ?? []) as unknown as Row[]) {
      const want = wantCustomer.get(String(got.id));
      if (!want) continue;
      customersFound++;
      // ชื่อ: DB เก็บตามที่ส่ง (importContracts ตัดช่องว่างหัวท้ายแล้ว)
      for (const k of ["branch_id", "name", "customer_type"]) if (got[k] !== want[k]) mismatches++;
    }
  }

  let teamsFound = 0;
  for (const part of chunks([...wantContract.keys()])) {
    const res = await client.from("contract_teams").select("contract_id", { count: "exact", head: true }).in("contract_id", part);
    if (res.error) throw new Error(`นำเข้า: อ่านกลับ contract_teams ไม่สำเร็จ: ${safeDbError(res.error)}`);
    teamsFound += res.count ?? 0;
  }

  if (
    found !== rows.contracts.length ||
    customersFound !== rows.customers.length ||
    teamsFound !== rows.contractTeams.length ||
    mismatches > 0
  ) {
    throw new Error(
      `นำเข้า: อ่านกลับไม่ตรง (สัญญา ${found}/${rows.contracts.length} · ลูกค้า ${customersFound}/${rows.customers.length}` +
        ` · ทีม ${teamsFound}/${rows.contractTeams.length} · ช่องไม่ตรง ${mismatches}) — ข้อมูลอยู่ใน DB แล้ว ตรวจแล้ว db reset`,
    );
  }
}

// ---------------------------------------------------------------------
// ตรวจยอดหลังนำเข้า (อ่านอย่างเดียว)
// ---------------------------------------------------------------------

export interface BranchVerification {
  branch: string;
  plannedContracts: number;
  dbContracts: number;
  expected: { cust: number; value: number };
  actual: { cust: number; value: number };
  /** รายการที่ไม่ตรง (ชื่อช่องเท่านั้น) — ว่าง = ตรงทุกช่อง */
  mismatches: string[];
}

export interface RegistryVerification {
  month: string;
  ok: boolean;
  branches: BranchVerification[];
  totals: {
    plannedContracts: number;
    dbContracts: number;
    expectedCust: number;
    actualCust: number;
    expectedValue: number;
    actualValue: number;
  };
}

const COUNT_KEYS = ["s1", "s3", "m1", "m3", "l1", "l3", "xl1", "xl3", "cust"] as const;
const MONEY_KEYS = ["vS", "vM", "vL", "vXL", "value"] as const;

async function selectIn(
  client: SupabaseClient,
  table: string,
  columns: string,
  col: string,
  values: string[],
  orderBy: string[] = ["id"],
): Promise<Row[]> {
  const out: Row[] = [];
  for (const part of chunks(values)) {
    for (let from = 0; ; from += PAGE) {
      let q = client.from(table).select(columns).in(col, part);
      for (const o of orderBy) q = q.order(o);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error(`ตรวจยอด: อ่าน ${table} ไม่สำเร็จ: ${safeDbError(error)}`);
      const rows = (data ?? []) as unknown as Row[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/** คำนวณยอดเดือนของแผนจากข้อมูลใน DB แล้วเทียบกับ plan.expected (ดู Logic summary หัวไฟล์) */
export async function verifyRegistryImport(client: SupabaseClient, plan: RegistryImportPlan): Promise<RegistryVerification> {
  const branches = await selectAll(client, "branches", "id, name");
  const nameById = new Map(branches.map((b) => [String(b.id), String(b.name)]));
  const idByName = new Map(branches.map((b) => [String(b.name), String(b.id)]));
  const targetIds = plan.branches.map((b) => {
    const id = idByName.get(b.branch);
    if (!id) throw new Error(`ตรวจยอด: ไม่พบสาขา ${b.branch}`);
    return id;
  });

  const customers = await selectIn(client, "customers", "id, branch_id", "branch_id", targetIds);
  const customerBranch = new Map(customers.map((c) => [String(c.id), nameById.get(String(c.branch_id))!]));
  const contracts = await selectIn(
    client,
    "contracts",
    "id, customer_id, contract_no, start_date, end_date, term_months, value_total, cancelled_at, stations_initialized_at, renewed_from_contract_id, sale_name, am_name",
    "customer_id",
    [...customerBranch.keys()],
  );
  const teams = await selectIn(client, "contract_teams", "contract_id, team_id", "contract_id", contracts.map((c) => String(c.id)), [
    "contract_id",
    "team_id",
  ]);
  const { data: tierData, error: tierErr } = await client.from("tier_rules").select(TIER_RULE_COLUMNS);
  if (tierErr) throw new Error(`ตรวจยอด: อ่าน tier_rules ไม่สำเร็จ: ${safeDbError(tierErr)}`);
  const rules = toTierRules((tierData ?? []) as unknown as TierRuleRow[]);

  const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
  const registryContracts: BranchContract[] = contracts.map((c) => ({
    id: String(c.id),
    startDate: String(c.start_date),
    termMonths: Number(c.term_months),
    valueTotal: Number(c.value_total),
    cancelledAt: str(c.cancelled_at),
    stationsInitializedAt: str(c.stations_initialized_at),
    renewedFromContractId: str(c.renewed_from_contract_id),
    customerId: String(c.customer_id),
    endDate: str(c.end_date),
    branch: customerBranch.get(String(c.customer_id))!,
  }));
  // ทางเดียวกับ Auto Sync (เดือนที่ยังไม่ปิด คำนวณสดจากทะเบียน) — นำเข้าใหม่ยังไม่มีการเข้าบริการ
  const computed = new Map(
    computeCentralRows({ contracts: registryContracts, visits: [], rules }, plan.month).map((r) => [r.branch, r]),
  );
  const teamCount = new Map<string, number>();
  for (const t of teams) teamCount.set(String(t.contract_id), (teamCount.get(String(t.contract_id)) ?? 0) + 1);

  const result: BranchVerification[] = plan.branches.map((b) => {
    const mismatches: string[] = [];
    const exp = b.expected;
    const got = computed.get(b.branch);
    const mine = contracts.filter((c) => customerBranch.get(String(c.customer_id)) === b.branch);
    if (!got) mismatches.push("ไม่มีแถวยอดของสาขา");
    else {
      for (const k of COUNT_KEYS) if (got[k] !== exp[k]) mismatches.push(k);
      for (const k of MONEY_KEYS) if (toCents(got[k]) !== toCents(exp[k])) mismatches.push(k);
    }
    const dbNos = new Set(mine.map((c) => String(c.contract_no)));
    const planNos = new Set(b.contracts.map((c) => c.contractNo));
    if (dbNos.size !== planNos.size || [...planNos].some((n) => !dbNos.has(n))) mismatches.push("ชุดเลขสัญญา");
    if (mine.length !== b.contracts.length) mismatches.push("จำนวนสัญญา");
    if (mine.filter((c) => c.sale_name).length !== b.sellers.saleName) mismatches.push("sale_name");
    if (mine.filter((c) => c.am_name).length !== b.sellers.amName) mismatches.push("am_name");
    const dbTeams = mine.reduce((n, c) => n + (teamCount.get(String(c.id)) ?? 0), 0);
    if (dbTeams !== b.contracts.reduce((n, c) => n + c.teamCodes.length, 0)) mismatches.push("ทีม");
    return {
      branch: b.branch,
      plannedContracts: b.contracts.length,
      dbContracts: mine.length,
      expected: { cust: exp.cust, value: toCents(exp.value) / 100 },
      actual: { cust: got?.cust ?? 0, value: toCents(got?.value ?? 0) / 100 },
      mismatches,
    };
  });

  const sum = (f: (b: BranchVerification) => number) => result.reduce((n, b) => n + f(b), 0);
  return {
    month: plan.month,
    ok: result.every((b) => b.mismatches.length === 0),
    branches: result,
    totals: {
      plannedContracts: sum((b) => b.plannedContracts),
      dbContracts: sum((b) => b.dbContracts),
      expectedCust: sum((b) => b.expected.cust),
      actualCust: sum((b) => b.actual.cust),
      expectedValue: toCents(sum((b) => b.expected.value)) / 100,
      actualValue: toCents(sum((b) => b.actual.value)) / 100,
    },
  };
}
