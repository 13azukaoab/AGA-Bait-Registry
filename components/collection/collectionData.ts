/**
 * ชั้นอ่านข้อมูลหน้า /collection — ใช้ฝั่ง server (page.tsx) ด้วย client ของผู้ใช้จริง (RLS ทำงาน · ไม่ใช้ service role)
 *
 * Logic summary:
 *   1) โหลดสัญญาที่ "อาจหมดแล้ว" (status ไม่ใช่ active หรือ end_date < วันนี้ หรือ end_date ว่าง) ใหม่สุดก่อน
 *      แล้วกรองซ้ำด้วยกฎเดียวกับ CL001 ใน TS (`isContractEnded`) — เพดาน COLLECTION_MAX_CONTRACTS สัญญา
 *      เกินแล้ว `truncated = true` (หน้าแสดงคำเตือน ไม่ตัดเงียบ)
 *   2) ตัวเลข IG ต่อสัญญา = view `v_contract_ig_collection` · วัน/ทีมล่าสุด + ยอด "ทำเดือนนี้" = view `v_ig_collection_monthly`
 *      (ดึงทีละ CHUNK สัญญา กัน URL ยาวเกิน)
 *   3) ทีม (ชื่อทีมของการเก็บล่าสุด + ตัวเลือกในฟอร์ม) · เรื่องตกบริการรอชดเชย (ซ่อนแถวตาม mockup) — อ่านพลาดไม่ล้มทั้งหน้า
 *   * เก็บเฉพาะสัญญาที่มี IG ที่ต้องจัดการ (igTotal − moved > 0) — IC / AG ไม่อยู่ในหน้านี้ (DECISIONS 2.42)
 *   * ⚠ PDPA: ผลลัพธ์มีชื่อลูกค้า — ห้าม console.log · error คืนแค่ code
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { effectiveEndDate, igBase, isContractEnded, pickLastAction, splitHeld } from "./collectionRules";
import type { CollectionRow, ContractStatus, HeldContract, TeamOption } from "./collectionTypes";
import type { TeamKind } from "@/lib/service/teamKind";

export const COLLECTION_MAX_CONTRACTS = 3000;
const PAGE = 1000;
const CHUNK = 150;

export type CollectionLoadResult =
  | { ok: true; rows: CollectionRow[]; teams: TeamOption[]; held: HeldContract[]; truncated: boolean }
  | { ok: false; code: string };

export interface ContractDb {
  id: string;
  contract_no: string;
  customer_id: string;
  start_date: string;
  end_date: string | null;
  term_months: number;
  status: ContractStatus;
  closed_at: string | null;
  cancelled_at: string | null;
  customers: {
    name: string | null;
    branches: { name: string | null; division: string } | { name: string | null; division: string }[] | null;
  } | null;
  contract_teams: { team_id: string }[] | null;
}

export interface IgSummaryDb {
  contract_id: string;
  ig_total: number;
  collected: number;
  not_collected: number;
  moved_to_renewal: number;
  remaining: number;
}

export interface IgMonthlyDb {
  contract_id: string;
  month: string;
  kind: string;
  team_id: string | null;
  stations: number;
  last_on: string | null;
  reasons: string[] | null;
}

const CONTRACT_SELECT =
  "id, contract_no, customer_id, start_date, end_date, term_months, status, closed_at, cancelled_at, " +
  "customers!inner(name, branches!inner(name, division)), contract_teams(team_id)";

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** สร้างแถวจากข้อมูลดิบ — แยกเป็น pure function เพื่อทดสอบ */
export function buildRow(
  c: ContractDb,
  ig: IgSummaryDb,
  monthly: readonly IgMonthlyDb[],
  currentMonth: string,
): CollectionRow | null {
  const branch = first(c.customers?.branches);
  if (!c.customers || !branch) return null;
  const endDate = effectiveEndDate(c.start_date, c.end_date, c.term_months);
  const last = pickLastAction(monthly);
  const inMonth = (m: IgMonthlyDb) => m.month.slice(0, 7) === currentMonth;
  const sum = (kind: string) => monthly.filter((m) => m.kind === kind && inMonth(m)).reduce((n, m) => n + m.stations, 0);
  const remaining = ig.remaining;
  return {
    contractId: c.id,
    customerId: c.customer_id,
    customerName: c.customers.name ?? "(ไม่มีชื่อ)",
    branchName: branch.name ?? "-",
    division: branch.division,
    contractNo: c.contract_no,
    startDate: c.start_date,
    endDate,
    termMonths: c.term_months,
    status: c.status,
    closedAt: c.closed_at,
    cancelledAt: c.cancelled_at,
    igTotal: ig.ig_total,
    collected: ig.collected,
    notCollected: ig.not_collected,
    moved: ig.moved_to_renewal,
    remaining,
    last,
    finishMonth: remaining === 0 && last ? last.date.slice(0, 7) : null,
    collectedThisMonth: sum("collected"),
    notCollectedThisMonth: sum("not_collected"),
    teamIds: (c.contract_teams ?? []).map((t) => t.team_id),
  };
}

export async function loadCollection(
  supabase: SupabaseClient,
  opts: { today: string; currentMonth: string },
): Promise<CollectionLoadResult> {
  // 1) สัญญาที่อาจหมดแล้ว (ใหม่สุดก่อน)
  const contracts: ContractDb[] = [];
  let total = 0;
  for (let from = 0; from < COLLECTION_MAX_CONTRACTS; from += PAGE) {
    const { data, error, count } = await supabase
      .from("contracts")
      .select(CONTRACT_SELECT, { count: "exact" })
      .or(`status.neq.active,end_date.lt.${opts.today},end_date.is.null`)
      .order("end_date", { ascending: false, nullsFirst: false })
      .order("id")
      .range(from, Math.min(from + PAGE, COLLECTION_MAX_CONTRACTS) - 1);
    if (error) return { ok: false, code: error.code ?? "contracts" };
    const batch = (data ?? []) as unknown as ContractDb[];
    contracts.push(...batch);
    total = count ?? contracts.length;
    if (batch.length < PAGE || contracts.length >= total) break;
  }
  const truncated = total > contracts.length;
  const ended = contracts.filter((c) =>
    isContractEnded(c.status, effectiveEndDate(c.start_date, c.end_date, c.term_months), opts.today),
  );

  // 2) ตัวเลข IG + ประวัติรายเดือน
  const ids = ended.map((c) => c.id);
  const summaryParts = await Promise.all(
    chunks(ids, CHUNK).map((part) => supabase.from("v_contract_ig_collection").select("*").in("contract_id", part)),
  );
  const summaryErr = summaryParts.find((r) => r.error);
  if (summaryErr?.error) return { ok: false, code: summaryErr.error.code ?? "ig_summary" };
  const summary = new Map<string, IgSummaryDb>();
  for (const r of summaryParts) for (const s of (r.data ?? []) as IgSummaryDb[]) summary.set(s.contract_id, s);

  const withIg = ended.filter((c) => {
    const s = summary.get(c.id);
    return s ? igBase({ igTotal: s.ig_total, moved: s.moved_to_renewal }) > 0 : false;
  });
  const monthlyParts = await Promise.all(
    chunks(
      withIg.map((c) => c.id),
      CHUNK,
    ).map((part) => supabase.from("v_ig_collection_monthly").select("*").in("contract_id", part)),
  );
  const monthlyErr = monthlyParts.find((r) => r.error);
  if (monthlyErr?.error) return { ok: false, code: monthlyErr.error.code ?? "ig_monthly" };
  const monthlyBy = new Map<string, IgMonthlyDb[]>();
  for (const r of monthlyParts)
    for (const m of (r.data ?? []) as IgMonthlyDb[]) {
      const list = monthlyBy.get(m.contract_id);
      if (list) list.push(m);
      else monthlyBy.set(m.contract_id, [m]);
    }

  let rows = withIg
    .map((c) => buildRow(c, summary.get(c.id) as IgSummaryDb, monthlyBy.get(c.id) ?? [], opts.currentMonth))
    .filter((r): r is CollectionRow => r !== null);

  // 3) ทีม + เรื่องตกบริการรอชดเชย (ไม่ล้มทั้งหน้าถ้าอ่านพลาด)
  const teamsRes = await supabase.from("teams").select("id, code, kind, is_active").order("code");
  if (teamsRes.error) return { ok: false, code: teamsRes.error.code ?? "teams" };
  const teams: TeamOption[] = ((teamsRes.data ?? []) as { id: string; code: string; kind: TeamKind; is_active: boolean }[]).map((t) => ({
    id: t.id,
    code: t.code,
    kind: t.kind,
    isActive: t.is_active,
  }));

  const held: HeldContract[] = [];
  const pend = await supabase.rpc("list_pending_missed_services", { p_branch_id: null, p_month: `${opts.currentMonth}-01` });
  if (pend.error) {
    console.error("[collection] pending-missed load error code", pend.error.code ?? "unknown");
  } else {
    const pendingBy = new Map<string, string>();
    for (const p of (pend.data ?? []) as { contract_id: string; missed_month: string }[]) {
      const prev = pendingBy.get(p.contract_id);
      if (!prev || p.missed_month < prev) pendingBy.set(p.contract_id, p.missed_month);
    }
    const split = splitHeld(rows, pendingBy);
    rows = split.visible;
    held.push(...split.held);
  }

  rows.sort((a, b) => (a.endDate === b.endDate ? a.customerName.localeCompare(b.customerName, "th") : a.endDate < b.endDate ? 1 : -1));
  return { ok: true, rows, teams, held, truncated };
}
