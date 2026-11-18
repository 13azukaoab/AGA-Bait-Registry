/**
 * นำแถว legacy (dashboard_data.json เดิม) เข้า `monthly_branch_snapshots` (DECISIONS 2.72 ก)
 *
 * Logic summary:
 *   1. อ่าน `go_live_month()` จาก DB (ห้าม hardcode) → แปลงไฟล์ด้วย convertLegacyDashboardData (ตรวจครบทุกแถว)
 *   2. อ่าน `branches` → map ชื่อ → id · ชื่อใน 43 สาขาหาไม่เจอแม้ตัวเดียว = หยุด
 *   3. อ่านแถวที่มีอยู่ของเดือนเหล่านั้น — **ถ้ามีแถว computed / manual แม้แถวเดียว = หยุด**
 *      (คีย์หลักคือ (month_key, branch_id) ไม่รวม source → upsert จะทับแถวที่ไม่ใช่ legacy)
 *   4. `dryRun` = จบตรงนี้ (ไม่เขียน) · ไม่งั้น upsert ทั้งหมด **ในคำขอเดียว** (PostgREST ทำใน transaction เดียว
 *      สำเร็จทั้งหมดหรือไม่เขียนเลย) · รันซ้ำได้ (แถว legacy เดิมถูกเขียนทับด้วยค่าเดียวกัน)
 *   5. อ่านกลับแถว legacy ของเดือนเหล่านั้น → ต้องครบจำนวนและทุกช่องตรง (สตางค์) ไม่งั้น throw
 *
 * สิทธิ์: client ต้องเป็น host (JWT) หรือ service_role — RLS `snapshots_host_write` · ไม่ต่อด้วย role postgres
 * (CLAUDE.md กฎ Deploy) · ไฟล์นี้ไม่สร้าง client เอง (ผู้เรียกส่งมา) เหมือน lib/dashboard/supabaseSyncPorts.ts
 * ⚠ audit trigger ของ snapshot ทำงานเฉพาะแถว source='manual' → การนำเข้า legacy **ไม่ลง audit_log**
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { BRANCHES } from "../dashboard/branches";
import {
  COUNT_FIELDS,
  MONEY_FIELDS,
  convertLegacyDashboardData,
  legacyTotalsByMonth,
  toCents,
  toSnapshotInsertRows,
  type LegacyConversion,
  type LegacyMonthTotal,
} from "./legacySnapshots";

const PAGE = 1000;
const TABLE = "monthly_branch_snapshots";
const READBACK_COLUMNS =
  'month_key, branch_id, source, s1, s3, m1, m3, l1, l3, xl1, xl3, cust, "vS", "vM", "vL", "vXL", value';

type Row = Record<string, unknown>;

export interface LegacyImportOptions {
  /** true = ตรวจอย่างเดียว ไม่เขียน DB */
  dryRun?: boolean;
}

export interface LegacyImportResult {
  goLiveMonth: string;
  dryRun: boolean;
  conversion: LegacyConversion;
  /** แถว legacy ที่มีอยู่แล้วก่อนรัน (ของเดือนที่นำเข้า) */
  existingLegacyBefore: number;
  /** แถวที่เขียน (dryRun = 0) */
  written: number;
  /** ยอดรวมต่อเดือนที่อ่านกลับจาก DB หลังเขียน (dryRun = ยอดจากไฟล์) */
  totals: LegacyMonthTotal[];
}

async function readGoLiveMonth(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.rpc("go_live_month");
  if (error) throw new Error(`legacy: อ่าน go_live_month ไม่สำเร็จ: ${error.message}`);
  const month = typeof data === "string" ? data.slice(0, 7) : "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("legacy: go_live_month คืนค่าที่ไม่ใช่วันที่");
  }
  return month;
}

/** อ่านแถว snapshot ของเดือนที่กำหนดแบบแบ่งหน้า (PostgREST คืนครั้งละไม่เกิน 1,000 แถว) */
async function readSnapshots(
  client: SupabaseClient,
  columns: string,
  months: readonly string[],
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from(TABLE)
      .select(columns)
      .in("month_key", [...months])
      .order("month_key", { ascending: true })
      .order("branch_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`legacy: อ่าน ${TABLE} ไม่สำเร็จ: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function readBranchIds(client: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await client.from("branches").select("id, name").range(0, PAGE - 1);
  if (error) throw new Error(`legacy: อ่าน branches ไม่สำเร็จ: ${error.message}`);
  const map = new Map<string, string>();
  for (const r of (data ?? []) as unknown as Row[]) map.set(String(r.name), String(r.id));
  const missing = BRANCHES.filter((b) => !map.has(b.branch)).map((b) => b.branch);
  if (missing.length > 0) {
    throw new Error(`legacy: ตาราง branches ไม่มีสาขา (ชื่อต้องตรงทุกตัวอักษร): ${missing.join(", ")}`);
  }
  return map;
}

/** นำเข้า (หรือตรวจอย่างเดียวเมื่อ dryRun) — ดู Logic summary หัวไฟล์ */
export async function importLegacySnapshots(
  client: SupabaseClient,
  data: unknown,
  options: LegacyImportOptions = {},
): Promise<LegacyImportResult> {
  const dryRun = options.dryRun ?? false;
  const goLiveMonth = await readGoLiveMonth(client);
  const conversion = convertLegacyDashboardData(data, { goLiveMonth });
  const ids = await readBranchIds(client);
  const insertRows = toSnapshotInsertRows(conversion.rows, ids);

  const existing = await readSnapshots(client, "month_key, branch_id, source", conversion.months);
  const nonLegacy = existing.filter((r) => r.source !== "legacy");
  if (nonLegacy.length > 0) {
    const sample = nonLegacy
      .slice(0, 5)
      .map((r) => `${String(r.month_key)}/${String(r.source)}`)
      .join(", ");
    throw new Error(
      `legacy: มีแถวที่ไม่ใช่ legacy ${nonLegacy.length} แถวในเดือนที่จะนำเข้า (${sample}) — หยุด ไม่เขียนทับ`,
    );
  }
  const existingLegacyBefore = existing.length;

  if (dryRun) {
    return {
      goLiveMonth,
      dryRun,
      conversion,
      existingLegacyBefore,
      written: 0,
      totals: legacyTotalsByMonth(conversion.rows),
    };
  }

  const { error } = await client.from(TABLE).upsert(insertRows, { onConflict: "month_key,branch_id" });
  if (error) throw new Error(`legacy: เขียน ${TABLE} ไม่สำเร็จ (ไม่มีแถวใดถูกเขียน): ${error.message}`);

  // อ่านกลับแล้วเทียบทุกช่อง
  const back = await readSnapshots(client, READBACK_COLUMNS, conversion.months);
  const backLegacy = back.filter((r) => r.source === "legacy");
  const byKey = new Map(backLegacy.map((r) => [`${String(r.month_key)}|${String(r.branch_id)}`, r]));
  const nameById = new Map([...ids].map(([name, id]) => [id, name]));
  let mismatches = 0;
  for (const want of insertRows) {
    const got = byKey.get(`${want.month_key}|${want.branch_id}`);
    if (!got) {
      mismatches++;
      continue;
    }
    for (const f of COUNT_FIELDS) if (Number(got[f]) !== want[f]) mismatches++;
    for (const f of MONEY_FIELDS) if (toCents(Number(got[f])) !== toCents(want[f])) mismatches++;
  }
  if (backLegacy.length !== insertRows.length || mismatches > 0) {
    throw new Error(
      `legacy: อ่านกลับไม่ตรง (ใน DB ${backLegacy.length} แถว / ต้องได้ ${insertRows.length} · ช่องไม่ตรง ${mismatches})`,
    );
  }

  const totals = legacyTotalsByMonth(
    backLegacy.map((r) => ({
      month: String(r.month_key),
      source: "legacy" as const,
      area: "",
      branch: nameById.get(String(r.branch_id)) ?? "",
      s1: Number(r.s1), s3: Number(r.s3), m1: Number(r.m1), m3: Number(r.m3),
      l1: Number(r.l1), l3: Number(r.l3), xl1: Number(r.xl1), xl3: Number(r.xl3),
      cust: Number(r.cust),
      vS: Number(r.vS), vM: Number(r.vM), vL: Number(r.vL), vXL: Number(r.vXL),
      value: Number(r.value),
    })),
  );

  return {
    goLiveMonth,
    dryRun,
    conversion,
    existingLegacyBefore,
    written: insertRows.length,
    totals,
  };
}
