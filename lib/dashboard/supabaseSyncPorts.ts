/**
 * ตัวเชื่อม `DashboardSyncPorts` กับ Supabase + GitHub จริง (M27) — ใช้ฝั่ง server เท่านั้น
 *
 * - รับ Supabase client จากผู้เรียก (ไฟล์นี้ไม่ import service role เอง — กฎ import ของ lib/supabase/admin.ts):
 *     * cron   → client แบบ service role (`app/api/cron/sync`)
 *     * ส่งตอนนี้ → client ของผู้ใช้ (JWT ของ host · RLS ให้ host อ่านทุกตารางที่ใช้)
 *   ต่อผ่าน PostgREST เท่านั้น ไม่ต่อด้วย role postgres (CLAUDE.md กฎ Deploy)
 * - อ่านทุกตารางแบบแบ่งหน้า (PostgREST คืนครั้งละไม่เกิน 1,000 แถว) — ตกหล่นแถว = ตัวเลขผิดเงียบๆ
 * - ไม่เขียน `monthly_branch_snapshots` เลย (อ่านอย่างเดียว · กฎ 7)
 * - GitHub token + ปลายทางอ่านจาก env ของ Vercel เท่านั้น (กฎ 8) · ไม่มี token = รอบนี้ล้มเหลว `config_missing` (ยังบันทึก log)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Contract, Visit, VisitType } from "../rules/types";
import { toTierRules, TIER_RULE_COLUMNS, type TierRuleRow } from "../tierRules";
import { buildDashboardData } from "./buildDashboardData";
import { DashboardSyncError } from "./errors";
import type { DashboardSyncPorts, FinishLogInput, SyncSource } from "./runSync";
import {
  assembleDashboardSources,
  bangkokMonth,
  previousMonth,
  type BranchContract,
  type StoredSnapshotRow,
} from "./sources";
import { syncDashboardData, type DashboardRepoTarget } from "./sync";
import type { DashboardData } from "./types";

const PAGE = 1000;
const KEYSET = { keyset: true } as const;

/** env ที่ต้องตั้งใน Vercel (ชื่อเท่านั้น — ห้าม log ค่า) */
export const DASHBOARD_ENV = {
  token: "DASHBOARD_GITHUB_TOKEN",
  repo: "DASHBOARD_GITHUB_REPO",
  branch: "DASHBOARD_GITHUB_BRANCH",
} as const;

/** ปลายทางตั้งต้นตาม SPEC §9.2 */
const DEFAULT_REPO = "13azukaoab/AGA-Bait-Dashboard";

export interface DashboardSyncConfig {
  token: string;
  target: DashboardRepoTarget;
}

/** อ่านค่าจาก env — ไม่มี token / repo ผิดรูปแบบ = throw `config_missing` (ข้อความไม่มีค่า env) */
export function dashboardSyncConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): DashboardSyncConfig {
  const token = env[DASHBOARD_ENV.token]?.trim();
  if (!token) {
    throw new DashboardSyncError(
      "config_missing",
      `ยังไม่ได้ตั้ง ${DASHBOARD_ENV.token} ใน Environment Variables ของ Vercel`,
    );
  }
  const repo = env[DASHBOARD_ENV.repo]?.trim() || DEFAULT_REPO;
  const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(repo);
  if (!match) {
    throw new DashboardSyncError("config_missing", `${DASHBOARD_ENV.repo} ต้องเป็นรูป owner/repo`);
  }
  const branch = env[DASHBOARD_ENV.branch]?.trim() || "main";
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new DashboardSyncError("config_missing", `${DASHBOARD_ENV.branch} มีตัวอักษรที่ใช้ไม่ได้`);
  }
  return { token, target: { owner: match[1]!, repo: match[2]!, branch } };
}

type Row = Record<string, unknown>;

/**
 * อ่านทุกแถวแบบแบ่งหน้า (PostgREST คืนครั้งละไม่เกิน 1,000 แถว)
 * - `keyset: true` (ตารางที่มีคอลัมน์ `id` ไม่ซ้ำ): หน้าถัดไป = `id > id สุดท้าย` — มีคนเพิ่ม/ลบแถวระหว่างอ่าน
 *   ก็ไม่ได้แถวซ้ำหรือข้ามแถว (แบบ offset จะเลื่อนแล้วนับสัญญาซ้ำได้)
 * - ตารางอื่น (snapshot · คีย์ประกอบ): offset + เรียงตามคีย์หลัก แล้วตัดแถวซ้ำด้วย `dedupeKey`
 */
async function fetchAll(
  client: SupabaseClient,
  table: string,
  columns: string,
  page: { keyset: true } | { orderBy: string[]; dedupeKey: (r: Row) => string },
  where: { eq?: [string, string]; notNull?: string } = {},
): Promise<Row[]> {
  const out = new Map<string, Row>();
  let lastId: string | null = null;
  for (let from = 0; ; from += PAGE) {
    let query = client.from(table).select(columns);
    if (where.eq) query = query.eq(where.eq[0], where.eq[1]);
    if (where.notNull) query = query.not(where.notNull, "is", null);
    let result;
    if ("keyset" in page) {
      if (lastId !== null) query = query.gt("id", lastId);
      result = await query.order("id", { ascending: true }).range(0, PAGE - 1);
    } else {
      for (const col of page.orderBy) query = query.order(col, { ascending: true });
      result = await query.range(from, from + PAGE - 1);
    }
    const { data, error } = result;
    if (error) {
      throw new DashboardSyncError("load_failed", `อ่าน ${table} ไม่สำเร็จ`);
    }
    const rows = (data ?? []) as unknown as Row[];
    for (const r of rows) {
      out.set("keyset" in page ? String(r.id) : page.dedupeKey(r), r);
    }
    if (rows.length < PAGE) return [...out.values()];
    if ("keyset" in page) lastId = String(rows[rows.length - 1]!.id);
  }
}

const num = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new DashboardSyncError("load_failed", `ค่าตัวเลขไม่ถูกต้อง: ${String(v)}`);
  return n;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

const SNAPSHOT_COLUMNS =
  'month_key, branch_id, source, s1, s3, m1, m3, l1, l3, xl1, xl3, cust, "vS", "vM", "vL", "vXL", value';

async function goLiveMonth(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.rpc("go_live_month");
  if (error) throw new DashboardSyncError("load_failed", `อ่าน go_live_month ไม่สำเร็จ: ${error.message}`);
  const month = typeof data === "string" ? data.slice(0, 7) : "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new DashboardSyncError("load_failed", "go_live_month คืนค่าที่ไม่ใช่วันที่");
  }
  return month;
}

/** อ่านฐานข้อมูลทั้งหมดที่ต้องใช้ แล้วประกอบไฟล์ Dashboard (ไม่เขียนอะไรลงฐานข้อมูล) */
export async function loadDashboardData(
  client: SupabaseClient,
  now: Date = new Date(),
): Promise<DashboardData> {
  const goLive = await goLiveMonth(client);
  const lastMonth = previousMonth(bangkokMonth(now));

  const [branches, snapshots, closures, tierRows, customers, contracts, visits] = await Promise.all([
    fetchAll(client, "branches", "id, name", KEYSET),
    fetchAll(client, "monthly_branch_snapshots", SNAPSHOT_COLUMNS, {
      orderBy: ["month_key", "branch_id"],
      dedupeKey: (r) => `${String(r.month_key)}|${String(r.branch_id)}`,
    }),
    fetchAll(client, "month_closures", "month_key, scope", {
      orderBy: ["month_key", "scope"],
      dedupeKey: (r) => `${String(r.month_key)}|${String(r.scope)}`,
    }, {
      eq: ["scope", "central"],
      notNull: "closed_at",
    }),
    fetchAll(client, "tier_rules", TIER_RULE_COLUMNS, {
      orderBy: ["effective_month", "tier"],
      dedupeKey: (r) => `${String(r.effective_month)}|${String(r.tier)}`,
    }),
    fetchAll(client, "customers", "id, branch_id", KEYSET),
    fetchAll(
      client,
      "contracts",
      "id, customer_id, start_date, end_date, term_months, value_total, cancelled_at, stations_initialized_at, renewed_from_contract_id",
      KEYSET,
    ),
    // สูตร snapshot / ตกบริการใช้เฉพาะการเข้าแบบ routine (lib/rules) — ไม่ต้องอ่านแบบอื่น
    fetchAll(client, "visits", "id, contract_id, visit_date, visit_type, makeup_for_month", KEYSET, {
      eq: ["visit_type", "routine"],
    }),
  ]);

  const branchName = new Map(branches.map((b) => [String(b.id), String(b.name)]));
  const customerBranch = new Map(customers.map((c) => [String(c.id), String(c.branch_id)]));
  const nameOf = (branchId: unknown): string => {
    const name = branchName.get(String(branchId));
    if (!name) throw new DashboardSyncError("load_failed", `ไม่พบสาขา id ${String(branchId)}`);
    return name;
  };

  const storedRows: StoredSnapshotRow[] = snapshots.map((s) => ({
    month: String(s.month_key),
    source: s.source as StoredSnapshotRow["source"],
    area: "", // buildDashboardData ใส่เขตปัจจุบันตามรายชื่อ 43 สาขาเอง (DECISIONS 6.7)
    branch: nameOf(s.branch_id),
    s1: num(s.s1), s3: num(s.s3), m1: num(s.m1), m3: num(s.m3),
    l1: num(s.l1), l3: num(s.l3), xl1: num(s.xl1), xl3: num(s.xl3),
    cust: num(s.cust),
    vS: num(s.vS), vM: num(s.vM), vL: num(s.vL), vXL: num(s.vXL),
    value: num(s.value),
  }));

  const registryContracts: BranchContract[] = contracts.map((c) => {
    const contract: Contract = {
      id: String(c.id),
      startDate: String(c.start_date),
      termMonths: num(c.term_months),
      valueTotal: num(c.value_total),
      cancelledAt: str(c.cancelled_at),
      stationsInitializedAt: str(c.stations_initialized_at),
      renewedFromContractId: str(c.renewed_from_contract_id),
      customerId: String(c.customer_id),
      endDate: str(c.end_date),
    };
    return { ...contract, branch: nameOf(customerBranch.get(String(c.customer_id))) };
  });

  const registryVisits: Visit[] = visits.map((v) => ({
    contractId: String(v.contract_id),
    visitDate: String(v.visit_date),
    visitType: v.visit_type as VisitType,
    makeupForMonth: str(v.makeup_for_month),
  }));

  const sources = assembleDashboardSources({
    goLiveMonth: goLive,
    lastMonth,
    snapshots: storedRows,
    closedCentralMonths: new Set(closures.map((c) => String(c.month_key))),
    registry: {
      contracts: registryContracts,
      visits: registryVisits,
      rules: toTierRules(tierRows as unknown as TierRuleRow[]),
    },
  });

  return buildDashboardData(sources, { goLiveMonth: goLive });
}

export interface SupabaseSyncPortsOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/** ports จริง: log ผ่าน RPC start_sync_log / finish_sync_log (ไม่มีสิทธิ์เขียนตารางตรง) */
export function supabaseSyncPorts(
  client: SupabaseClient,
  options: SupabaseSyncPortsOptions = {},
): DashboardSyncPorts {
  return {
    async startLog(source: SyncSource) {
      const { data, error } = await client.rpc("start_sync_log", { p_source: source });
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data === null ? null : Number(data);
    },

    async finishLog(id: number, input: FinishLogInput) {
      const { error } = await client.rpc("finish_sync_log", {
        p_id: id,
        p_result: input.result,
        p_error_code: input.errorCode ?? null,
        p_error_message: input.errorMessage ?? null,
        p_months_sent: input.monthsSent,
        p_month_count: input.monthCount ?? null,
        p_commit_sha: input.commitSha ?? null,
      });
      if (error) throw new Error(`บันทึก sync_logs ไม่สำเร็จ: ${error.message}`);
    },

    loadData: () => loadDashboardData(client, options.now?.() ?? new Date()),

    async push(data: DashboardData) {
      const config = dashboardSyncConfigFromEnv(options.env);
      return syncDashboardData(data, {
        target: config.target,
        token: config.token,
        fetchImpl: options.fetchImpl,
      });
    },
  };
}
