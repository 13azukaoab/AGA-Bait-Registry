/**
 * ถอยการนำเข้า (แผนนำเข้า cloud 23 พ.ย. 2026 หัวข้อ 3 ข้อ 6 + หัวข้อ 5) — ใช้กับ scripts/rollback-registry-import.ts
 *
 * Logic summary — ทะเบียน (ตาม contracts.import_batch · DECISIONS 2.86):
 *   planRegistryRollback (อ่านอย่างเดียว = dry-run):
 *     1. อ่านสัญญาทั้งหมดของ batch (id, customer_id) แบบแบ่งหน้า
 *     2. ด่านหยุด (blockers) — มีแม้แถวเดียว = ห้ามลบ ให้ไปทางกู้จากสำรอง (แผน 5.3):
 *        - visits อ้างสัญญาใน batch (FK RESTRICT · มีคนบันทึกผลบริการแล้ว)
 *        - สัญญานอก batch บนลูกค้าของ batch (ลูกค้าถูกใช้ต่อในแอป · ลบลูกค้าไม่ได้ RESTRICT)
 *        - สัญญานอก batch ที่ renewed_from_contract_id ชี้เข้า batch (FK SET NULL → ลิงก์ต่ออายุหายเงียบๆ)
 *     3. นับสิ่งที่จะหายตาม CASCADE ให้คนยืนยันเห็นก่อน: contract_teams · customer_phones · stations ·
 *        contract_files (⚠ ไฟล์ใน Storage ไม่หายตาม ต้องลบเอง) · missed_service_resolutions · missed_service_notes · station_transfers
 *   applyRegistryRollback(client, batch, expectedContracts):
 *     1. วางแผนใหม่อีกรอบ (สถานะอาจเปลี่ยนระหว่างรอพิมพ์ยืนยัน) · blocked หรือจำนวนสัญญา ≠ ที่ยืนยัน = หยุดก่อนลบ
 *     2. ลบเป็นคู่ทีละชุด: สัญญาชุดละ 200 → ลูกค้าที่สัญญาใน batch หมดแล้วทันที
 *        (ลูกค้าหาได้ผ่าน contracts.import_batch เท่านั้น — ถ้าลบสัญญาหมดก่อนแล้วลบลูกค้าพัง รันซ้ำจะหาลูกค้าไม่เจอ)
 *        PostgREST 1 คำขอ = 1 transaction แต่ทั้งงานไม่ใช่ transaction เดียว → พังกลางทาง = throw RollbackIncompleteError
 *        พร้อม id ลูกค้าที่สัญญาถูกลบแล้วแต่ลูกค้ายังค้าง (uuid ไม่ใช่ข้อมูลส่วนบุคคล · สคริปต์เขียนลง log) · สัญญาที่เหลือรันซ้ำได้
 *     3. ตรวจหลังลบ: สัญญาของ batch = 0 และลูกค้าของ batch = 0
 *
 * Logic summary — legacy (monthly_branch_snapshots source='legacy' เดือน 2025-01 … 2026-09 · แผน 5.2):
 *   planLegacyRollback นับแถว legacy / จำนวนเดือน / แถว source อื่นในช่วง (ไม่ลบ · ไม่แตะ)
 *   applyLegacyRollback นับใหม่ ≠ ที่ยืนยัน = หยุด · ลบด้วยคำขอเดียว (transaction เดียว) แล้วนับซ้ำต้องเป็น 0
 *
 * สิทธิ์: ผู้เรียกส่ง client service_role ผ่าน PostgREST (ห้าม role postgres — CLAUDE.md กฎ Deploy) · ไฟล์นี้ไม่สร้าง client
 * PDPA: อ่านเฉพาะคอลัมน์ id / FK / import_batch · ข้อความ error มีแค่จำนวน + code/message ของ PostgREST
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { safeDbError } from "./registryDbImport";

type Row = Record<string, unknown>;

const CHUNK = 200;
const PAGE = 1000;

/** รูปแบบเดียวกับ CHECK contracts_import_batch_format (migration M41) */
const IMPORT_BATCH_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** --batch ต้องมีค่าและตรงรูปแบบ (กันค่าว่างกลายเป็นเงื่อนไขกว้าง) */
export function assertImportBatch(batch: string | undefined): string {
  if (batch === undefined || !IMPORT_BATCH_RE.test(batch)) {
    throw new Error("หยุด: --batch ต้องเป็นรหัสชุดนำเข้า (A–Z a–z 0–9 . _ - · 1–64 ตัว) เช่น registry-OCT26");
  }
  return batch;
}

function chunks<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function countIn(client: SupabaseClient, table: string, col: string, values: readonly string[]): Promise<number> {
  let n = 0;
  for (const part of chunks(values)) {
    const res = await client.from(table).select(col, { count: "exact", head: true }).in(col, part);
    if (res.error) throw new Error(`ถอย: นับ ${table} ไม่สำเร็จ: ${safeDbError(res.error)}`);
    n += res.count ?? 0;
  }
  return n;
}

async function selectIn(client: SupabaseClient, table: string, columns: string, col: string, values: readonly string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (const part of chunks(values)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client.from(table).select(columns).in(col, part).order("id").range(from, from + PAGE - 1);
      if (error) throw new Error(`ถอย: อ่าน ${table} ไม่สำเร็จ: ${safeDbError(error)}`);
      const rows = (data ?? []) as unknown as Row[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

async function readBatchContracts(client: SupabaseClient, batch: string): Promise<{ id: string; customerId: string }[]> {
  const out: { id: string; customerId: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("contracts")
      .select("id, customer_id")
      .eq("import_batch", batch)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`ถอย: อ่านสัญญาของ batch ไม่สำเร็จ: ${safeDbError(error)}`);
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows.map((r) => ({ id: String(r.id), customerId: String(r.customer_id) })));
    if (rows.length < PAGE) return out;
  }
}

// ---------------------------------------------------------------------
// ทะเบียน
// ---------------------------------------------------------------------

export interface RegistryRollbackPlan {
  batch: string;
  contracts: number;
  customers: number;
  /** มีค่า > 0 ตัวใดตัวหนึ่ง = ห้ามลบ */
  blockers: { visits: number; otherContractsOnCustomers: number; renewalsFromOutside: number };
  /** จะหายตาม ON DELETE CASCADE */
  cascades: {
    contractTeams: number;
    customerPhones: number;
    stations: number;
    contractFiles: number;
    missedServiceResolutions: number;
    missedServiceNotes: number;
    stationTransfers: number;
  };
  blocked: boolean;
}

interface PlanWithIds {
  plan: RegistryRollbackPlan;
  contracts: { id: string; customerId: string }[];
}

async function buildPlan(client: SupabaseClient, batch: string): Promise<PlanWithIds> {
  const contracts = await readBatchContracts(client, batch);
  const contractIds = contracts.map((c) => c.id);
  const customerIds = [...new Set(contracts.map((c) => c.customerId))];

  const visits = await countIn(client, "visits", "contract_id", contractIds);
  const onCustomers = await selectIn(client, "contracts", "id, import_batch", "customer_id", customerIds);
  const otherContractsOnCustomers = onCustomers.filter((r) => r.import_batch !== batch).length;
  const renewals = await selectIn(client, "contracts", "id, import_batch", "renewed_from_contract_id", contractIds);
  const renewalsFromOutside = renewals.filter((r) => r.import_batch !== batch).length;

  const transfers = await selectIn(client, "station_transfers", "id", "from_contract_id", contractIds);
  const transfersTo = await selectIn(client, "station_transfers", "id", "to_contract_id", contractIds);
  const stationTransfers = new Set([...transfers, ...transfersTo].map((r) => String(r.id))).size;

  const blockers = { visits, otherContractsOnCustomers, renewalsFromOutside };
  return {
    contracts,
    plan: {
      batch,
      contracts: contracts.length,
      customers: customerIds.length,
      blockers,
      cascades: {
        contractTeams: await countIn(client, "contract_teams", "contract_id", contractIds),
        customerPhones: await countIn(client, "customer_phones", "customer_id", customerIds),
        stations: await countIn(client, "stations", "contract_id", contractIds),
        contractFiles: await countIn(client, "contract_files", "contract_id", contractIds),
        missedServiceResolutions: await countIn(client, "missed_service_resolutions", "contract_id", contractIds),
        missedServiceNotes: await countIn(client, "missed_service_notes", "contract_id", contractIds),
        stationTransfers,
      },
      blocked: Object.values(blockers).some((n) => n > 0),
    },
  };
}

/** dry-run ของการถอยทะเบียน (อ่านอย่างเดียว) */
export async function planRegistryRollback(client: SupabaseClient, batch: string): Promise<RegistryRollbackPlan> {
  return (await buildPlan(client, assertImportBatch(batch))).plan;
}

export function describeBlockers(b: RegistryRollbackPlan["blockers"]): string {
  return `visits ${b.visits} · สัญญาในแอปบนลูกค้านำเข้า ${b.otherContractsOnCustomers} · สัญญาต่ออายุที่อ้างสัญญานำเข้า ${b.renewalsFromOutside}`;
}

/** ลบไม่ครบ — มี id ลูกค้าที่ค้าง (สัญญาถูกลบแล้ว) ให้สคริปต์บันทึกลง log ไว้ลบต่อ */
export class RollbackIncompleteError extends Error {
  constructor(
    message: string,
    readonly deletedContracts: number,
    readonly deletedCustomers: number,
    readonly orphanCustomerIds: string[],
  ) {
    super(message);
    this.name = "RollbackIncompleteError";
  }
}

/** ถอยทะเบียนจริง (ดู Logic summary) · expectedContracts = จำนวนที่คนพิมพ์ยืนยัน */
export async function applyRegistryRollback(
  client: SupabaseClient,
  batch: string,
  expectedContracts: number,
): Promise<{ deletedContracts: number; deletedCustomers: number }> {
  const { plan, contracts } = await buildPlan(client, assertImportBatch(batch));
  if (plan.blocked) {
    throw new Error(`ถอย: หยุด ไม่ลบ — มีข้อมูลที่ผู้ใช้สร้างอ้างสัญญานำเข้า (${describeBlockers(plan.blockers)}) → ใช้ทางกู้จากสำรอง`);
  }
  if (plan.contracts !== expectedContracts) {
    throw new Error(`ถอย: จำนวนสัญญาเปลี่ยนจากตอนยืนยัน (ตอนนี้ ${plan.contracts} / ยืนยัน ${expectedContracts}) — หยุด ไม่ลบ`);
  }

  // ลูกค้า → จำนวนสัญญาใน batch ที่ยังไม่ถูกลบ
  const remaining = new Map<string, number>();
  for (const c of contracts) remaining.set(c.customerId, (remaining.get(c.customerId) ?? 0) + 1);
  const orphans = new Set<string>();
  let deletedContracts = 0;
  let deletedCustomers = 0;

  const fail = (what: string, err: { code?: string; message: string }): never => {
    throw new RollbackIncompleteError(
      `ถอย: ลบ ${what} ไม่สำเร็จ: ${safeDbError(err)} — ลบแล้ว สัญญา ${deletedContracts} · ลูกค้า ${deletedCustomers}` +
        ` · ลูกค้าค้าง (สัญญาถูกลบแล้ว) ${orphans.size} ราย → id อยู่ในไฟล์ log · สัญญาที่เหลือรันสคริปต์ซ้ำได้`,
      deletedContracts,
      deletedCustomers,
      [...orphans],
    );
  };

  for (const part of chunks(contracts)) {
    const del = await client.from("contracts").delete({ count: "exact" }).in("id", part.map((c) => c.id));
    if (del.error) fail("สัญญา", del.error);
    if (del.count !== part.length) {
      fail("สัญญา", { message: `ลบได้ ${String(del.count)} / ต้องได้ ${part.length}` });
    }
    deletedContracts += part.length;
    for (const c of part) {
      const left = (remaining.get(c.customerId) ?? 1) - 1;
      remaining.set(c.customerId, left);
      if (left === 0) orphans.add(c.customerId);
    }

    const ready = [...orphans];
    for (const cpart of chunks(ready)) {
      const res = await client.from("customers").delete({ count: "exact" }).in("id", cpart);
      if (res.error) fail("ลูกค้า", res.error);
      if (res.count !== cpart.length) fail("ลูกค้า", { message: `ลบได้ ${String(res.count)} / ต้องได้ ${cpart.length}` });
      deletedCustomers += cpart.length;
      for (const id of cpart) orphans.delete(id);
    }
  }

  const leftContracts = await client.from("contracts").select("id", { count: "exact", head: true }).eq("import_batch", batch);
  if (leftContracts.error) throw new Error(`ถอย: ตรวจหลังลบไม่สำเร็จ: ${safeDbError(leftContracts.error)}`);
  const leftCustomers = await countIn(client, "customers", "id", [...remaining.keys()]);
  if ((leftContracts.count ?? 0) !== 0 || leftCustomers !== 0) {
    throw new Error(`ถอย: ตรวจหลังลบไม่ผ่าน (สัญญาของ batch เหลือ ${String(leftContracts.count)} · ลูกค้าเหลือ ${leftCustomers})`);
  }
  return { deletedContracts, deletedCustomers };
}

// ---------------------------------------------------------------------
// legacy snapshot
// ---------------------------------------------------------------------

/** ช่วงเดือนของ legacy ตามแผน (JAN.25 … SEP.26 · เดือนก่อน go-live 2026-10) */
export const LEGACY_ROLLBACK_MONTHS = { from: "2025-01", to: "2026-09" } as const;

const SNAPSHOTS = "monthly_branch_snapshots";

export interface LegacyRollbackPlan {
  legacyRows: number;
  months: number;
  /** แถว manual/computed ในช่วงเดียวกัน (ไม่ลบ · แสดงให้เห็น) */
  otherSourceRows: number;
}

/** dry-run ของการถอย legacy (อ่านอย่างเดียว) */
export async function planLegacyRollback(client: SupabaseClient): Promise<LegacyRollbackPlan> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from(SNAPSHOTS)
      .select("month_key, branch_id, source")
      .gte("month_key", LEGACY_ROLLBACK_MONTHS.from)
      .lte("month_key", LEGACY_ROLLBACK_MONTHS.to)
      .order("month_key")
      .order("branch_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`ถอย legacy: อ่าน ${SNAPSHOTS} ไม่สำเร็จ: ${safeDbError(error)}`);
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const legacy = rows.filter((r) => r.source === "legacy");
  return {
    legacyRows: legacy.length,
    months: new Set(legacy.map((r) => String(r.month_key))).size,
    otherSourceRows: rows.length - legacy.length,
  };
}

/** ถอย legacy จริง · expectedRows = จำนวนที่คนพิมพ์ยืนยัน */
export async function applyLegacyRollback(client: SupabaseClient, expectedRows: number): Promise<{ deleted: number }> {
  const plan = await planLegacyRollback(client);
  if (plan.legacyRows !== expectedRows) {
    throw new Error(`ถอย legacy: จำนวนแถว legacy เปลี่ยนจากตอนยืนยัน (ตอนนี้ ${plan.legacyRows} / ยืนยัน ${expectedRows}) — หยุด ไม่ลบ`);
  }
  const res = await client
    .from(SNAPSHOTS)
    .delete({ count: "exact" })
    .eq("source", "legacy")
    .gte("month_key", LEGACY_ROLLBACK_MONTHS.from)
    .lte("month_key", LEGACY_ROLLBACK_MONTHS.to);
  if (res.error) throw new Error(`ถอย legacy: ลบไม่สำเร็จ (ไม่มีแถวใดถูกลบ): ${safeDbError(res.error)}`);
  const after = await planLegacyRollback(client);
  if (res.count !== expectedRows || after.legacyRows !== 0) {
    throw new Error(`ถอย legacy: ตรวจหลังลบไม่ผ่าน (ลบได้ ${String(res.count)} / ต้องได้ ${expectedRows} · เหลือ ${after.legacyRows})`);
  }
  return { deleted: expectedRows };
}
