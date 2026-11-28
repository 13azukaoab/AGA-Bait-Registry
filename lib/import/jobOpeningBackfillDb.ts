/**
 * ชั้นอ่าน/เขียน DB ของงานเติมวันที่รับ Mail / วันนัดบริการครั้งแรก / เวลา (ตรรกะแผนอยู่ที่ jobOpeningBackfill.ts)
 *
 * Logic summary:
 *   1. อ่าน (readDbTargets — อ่านอย่างเดียว ใช้ทั้ง --db dry-run และ --apply):
 *      - สัญญาที่เลขตรงกับไฟล์เปิดงาน (.in('contract_no') ทีละ 200 เลข)
 *      - สัญญาทั้งหมดของ batch ที่จะเติม (แบ่งหน้า .range ทีละ 1,000 แถว — PostgREST คืนได้ไม่เกินนั้นต่อครั้ง)
 *        ใช้นับ "สัญญานำเข้าที่ไม่มีแถวในไฟล์เปิดงาน"
 *      - คอลัมน์ที่อ่าน: id, เลขสัญญา, batch, สถานะ, วันเริ่ม/สิ้นสุด, ประเภทขาย, 3 ช่องที่จะเติม (ไม่มีข้อมูลลูกค้า)
 *   2. เขียน (applyBackfill — เฉพาะ --apply หลังพิมพ์ยืนยัน):
 *      - PATCH ทีละสัญญา ผ่าน PostgREST ด้วย service_role: `update(set).eq(id).is(<ช่องที่เติม>, null)`
 *        → ช่องที่มีคนกรอกระหว่างนั้นจะไม่ถูกทับ (ได้ 0 แถว = นับเป็น changedSinceRead ไม่ error)
 *        เติมเวลาอย่างเดียว: เพิ่ม `.eq(first_service_date, วันที่ในไฟล์)`
 *      - ด่านใน DB ที่ทางนี้ผ่าน (ตรวจจาก migration แล้ว): trigger ล็อกทุกตัวของ contracts ตรวจ current_user = 'authenticated'
 *        (service_role ไม่ติด) · CHECK เวลาต้องมีวันที่ · audit_contracts (AFTER UPDATE) ลง audit_log ทุกแถว (changed_by ว่าง)
 *        · contracts_set_updated_at ขยับ updated_at (หน้าเปิดงานที่เปิดค้างอยู่จะได้ AG008 → รันนอกเวลางาน)
 *      - ทุกแถวที่เขียนสำเร็จเรียก onWritten (สคริปต์ต่อท้ายไฟล์ run log นอก repo ทันที → ใช้ถอยกลับได้แม้หยุดกลางทาง)
 *   3. ถอยกลับ (rollbackBackfill): จาก run log · ตั้งกลับเป็น NULL เฉพาะช่องที่รอบนั้นเติม และค่าปัจจุบันยังเท่าค่าที่เติม
 *      (มีคนแก้ต่อแล้ว = ไม่แตะ นับ skipped) · ถอยวันที่โดยไม่ได้เติมเวลา → ต้องไม่มีเวลาอยู่ (กัน CHECK ล้ม)
 *   ⚠ ห้ามต่อด้วย role postgres (CLAUDE.md กฎ Deploy) · ไม่ import lib/supabase/admin.ts (M21b) · ข้อความ error ใช้ safeDbError
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { BackfillTarget, BackfillUpdate, DbField } from "./jobOpeningBackfill";
import { safeDbError } from "./registryDbImport";

export const TARGET_COLUMNS =
  "id, contract_no, import_batch, status, start_date, end_date, sale_type, mail_received_date, first_service_date, first_service_time";

const IN_CHUNK = 200;
const PAGE = 1000;

interface ContractRow {
  id: string;
  contract_no: string;
  import_batch: string | null;
  status: string;
  start_date: string;
  end_date: string;
  sale_type: string | null;
  mail_received_date: string | null;
  first_service_date: string | null;
  first_service_time: string | null;
}

function toTarget(r: ContractRow): BackfillTarget {
  return {
    id: String(r.id),
    contractNo: String(r.contract_no),
    importBatch: r.import_batch ? String(r.import_batch) : null,
    status: String(r.status),
    startDate: String(r.start_date).slice(0, 10),
    endDate: String(r.end_date).slice(0, 10),
    saleType: r.sale_type ? String(r.sale_type) : null,
    mail: r.mail_received_date ? String(r.mail_received_date).slice(0, 10) : null,
    serviceDate: r.first_service_date ? String(r.first_service_date).slice(0, 10) : null,
    // DB คืน 'HH:MM:SS' → เทียบแบบ 'HH:MM'
    serviceTime: r.first_service_time ? String(r.first_service_time).slice(0, 5) : null,
  };
}

/** อ่านเป้าหมายจาก DB (ข้อ 1) · อ่านอย่างเดียว */
export async function readDbTargets(
  client: SupabaseClient,
  input: { contractNos: readonly string[]; batches: readonly string[] },
): Promise<BackfillTarget[]> {
  const byId = new Map<string, BackfillTarget>();
  const nos = [...new Set(input.contractNos)];
  for (let i = 0; i < nos.length; i += IN_CHUNK) {
    const { data, error } = await client.from("contracts").select(TARGET_COLUMNS).in("contract_no", nos.slice(i, i + IN_CHUNK));
    if (error) throw new Error(`อ่านสัญญาตามเลขไม่สำเร็จ: ${safeDbError(error)}`);
    for (const r of (data ?? []) as unknown as ContractRow[]) byId.set(String(r.id), toTarget(r));
  }
  if (input.batches.length > 0) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from("contracts")
        .select(TARGET_COLUMNS)
        .in("import_batch", [...input.batches])
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`อ่านสัญญาของชุดนำเข้าไม่สำเร็จ: ${safeDbError(error)}`);
      const rows = (data ?? []) as unknown as ContractRow[];
      for (const r of rows) byId.set(String(r.id), toTarget(r));
      if (rows.length < PAGE) break;
    }
  }
  return [...byId.values()];
}

/** 1 บรรทัดใน run log (ใช้ถอยกลับ) — เลขสัญญา/วันที่เท่านั้น */
export interface RunLogEntry {
  id: string;
  contractNo: string;
  set: Partial<Record<DbField, string>>;
}

export interface ApplyResult {
  written: number;
  /** ไม่ถูกแก้เพราะช่องถูกกรอก/เปลี่ยนระหว่างอ่านกับเขียน — เลขสัญญา */
  changedSinceRead: string[];
}

/** เขียนจริง (ข้อ 2) · updates ต้องมี id (มาจากโหมด DB) */
export async function applyBackfill(
  client: SupabaseClient,
  updates: readonly BackfillUpdate[],
  opts: { onWritten: (entry: RunLogEntry) => void; onProgress?: (done: number, total: number) => void; progressEvery?: number },
): Promise<ApplyResult> {
  const missing = updates.filter((u) => !u.id).length;
  if (missing > 0) throw new Error(`เขียนจริง: มี ${missing} รายการไม่มี id (แผนต้องมาจากโหมด DB) — หยุด`);
  const every = opts.progressEvery ?? 50;
  const out: ApplyResult = { written: 0, changedSinceRead: [] };
  let done = 0;
  for (const u of updates) {
    const fields = Object.keys(u.set) as DbField[];
    if (fields.length === 0) continue;
    let q = client.from("contracts").update(u.set).eq("id", u.id!);
    for (const f of fields) q = q.is(f, null);
    if (u.requireServiceDate) q = q.eq("first_service_date", u.requireServiceDate);
    const { data, error } = await q.select("id");
    if (error) throw new Error(`เขียน ${u.contractNo} ไม่สำเร็จ (เขียนแล้ว ${out.written} สัญญา · ดู run log): ${safeDbError(error)}`);
    if ((data ?? []).length === 1) {
      out.written += 1;
      opts.onWritten({ id: u.id!, contractNo: u.contractNo, set: u.set });
    } else {
      out.changedSinceRead.push(u.contractNo);
    }
    done += 1;
    if (opts.onProgress && (done % every === 0 || done === updates.length)) opts.onProgress(done, updates.length);
  }
  return out;
}

export interface RollbackResult {
  reverted: number;
  /** ค่าเปลี่ยนไปแล้วหลังรอบที่เติม (หรือมีเวลาที่รอบนั้นไม่ได้เติม) — ไม่แตะ · เลขสัญญา */
  skipped: string[];
}

/** ถอยกลับจาก run log (ข้อ 3) */
export async function rollbackBackfill(client: SupabaseClient, entries: readonly RunLogEntry[]): Promise<RollbackResult> {
  const out: RollbackResult = { reverted: 0, skipped: [] };
  for (const e of entries) {
    const fields = Object.keys(e.set) as DbField[];
    if (fields.length === 0) continue;
    const nulls = Object.fromEntries(fields.map((f) => [f, null])) as Partial<Record<DbField, null>>;
    let q = client.from("contracts").update(nulls).eq("id", e.id);
    for (const f of fields) q = q.eq(f, e.set[f]!);
    // ถอยวันที่แต่รอบนั้นไม่ได้เติมเวลา → เวลาต้องว่าง ไม่งั้น CHECK เวลาต้องมีวันที่ล้ม
    if (e.set.first_service_date && !e.set.first_service_time) q = q.is("first_service_time", null);
    const { data, error } = await q.select("id");
    if (error) throw new Error(`ถอย ${e.contractNo} ไม่สำเร็จ (ถอยแล้ว ${out.reverted}): ${safeDbError(error)}`);
    if ((data ?? []).length === 1) out.reverted += 1;
    else out.skipped.push(e.contractNo);
  }
  return out;
}

/** อ่าน run log (JSON Lines) → รายการ · บรรทัดเสีย = throw (ไม่ถอยครึ่งๆ กลางๆ) */
export function parseRunLog(text: string): RunLogEntry[] {
  const out: RunLogEntry[] = [];
  const allowed: ReadonlySet<string> = new Set<DbField>(["mail_received_date", "first_service_date", "first_service_time"]);
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === "") return;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      throw new Error(`run log บรรทัด ${i + 1} อ่านไม่ได้ — หยุด`);
    }
    const e = v as Partial<RunLogEntry>;
    const keys = e.set && typeof e.set === "object" ? Object.keys(e.set) : [];
    if (
      typeof e.id !== "string" ||
      typeof e.contractNo !== "string" ||
      keys.length === 0 ||
      keys.some((k) => !allowed.has(k) || typeof (e.set as Record<string, unknown>)[k] !== "string")
    ) {
      throw new Error(`run log บรรทัด ${i + 1} รูปแบบไม่ถูก — หยุด`);
    }
    out.push({ id: e.id, contractNo: e.contractNo, set: e.set as RunLogEntry["set"] });
  });
  return out;
}
