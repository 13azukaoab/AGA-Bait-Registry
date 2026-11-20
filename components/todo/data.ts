/**
 * ชั้นอ่านข้อมูลของหน้า "สถานะทะเบียนบริการ" (/todo) — ฝั่ง server
 *
 * Logic summary:
 *   * รับ Supabase client ของผู้ใช้จริง (RLS ทำงาน · ห้าม service role) · ทุก select ระบุคอลัมน์ ไม่ใช้ `select('*')`
 *   * เดือนของหน้า = oldest_open_month() ส่วนกลาง (ดู logic.ts pickPageScope)
 *   * ความคืบหน้า/รายการ "ยังไม่กรอก" ใช้ loadContractList ของหน้า /service (import อย่างเดียว) → ตัวเลขตรงกัน
 *     (รายสาขาแล้วรวม — ถ้าสาขาใดชนเพดาน 1,000 สัญญา จะตั้ง `truncated` ให้หน้าจอเตือน ไม่แสดงตัวเลขผิดเงียบๆ)
 *   * ตกบริการรอตัดสิน = list_pending_missed_services(p_month = เดือนของหน้า) — สูตรตก/เพดาน อยู่ที่ฐานข้อมูล
 *   * เรื่องที่ปิดแล้ว = missed_service_resolutions (ไม่ชดเชย/ชดเชยแล้ว) ล่าสุด CLOSED_LIMIT แถว
 *   * กล่อง AG รอถอด = stations ชนิด AG สถานะ pending_removal · ลูกค้ารอเก็บสถานี = v_contract_ig_collection + สัญญาที่จบแล้ว
 *   * ทุก query ที่อาจเกิน 1,000 แถว (max_rows ของ PostgREST ตัดเงียบๆ) ต้องดึงครบด้วย keyset (lib/supabase/fetchAll.ts) — ห้ามใช้ .limit(1000) เฉยๆ:
 *       - v_contract_ig_collection เรียงตาม contract_id · stations AG รอถอด เรียงตาม id · ตกบริการ (RPC) ถ้าได้เต็ม 1,000 ให้ดึงซ้ำรายสาขา
 *       - แบ่งก้อน id ตอนอ่านชื่อ/สถานะสัญญา (CHUNK) อยู่แล้ว · ถ้ายังชนเพดานจริงตั้ง `truncated` ให้หน้าจอเตือน
 *   * อ่านพลาด = คืน error ให้หน้าจอแจ้งชัด · ไม่แสดงตัวเลขสมมติ
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadContractList, loadServiceMaster } from "@/components/service/data";
import type { ContractListItem } from "@/components/service/types";
import { effectiveEndDate } from "@/lib/rules";
import { currentBangkokMonth, todayBangkok } from "@/lib/service/months";
import { termMonthsOf } from "@/lib/service/termMonths";

import { fetchAllKeyset, KEYSET_PAGE_SIZE } from "@/lib/supabase/fetchAll";
import { loadPendingMissedRows } from "@/lib/supabase/pendingMissed";

import {
  CLOSED_LIMIT,
  computeProgress,
  pickPageScope,
  sortClosed,
  sortPending,
  summarizeCollect,
  toMonthKey,
  type ClosedMissed,
  type CollectContractInput,
  type CollectSummary,
  type OldestOpenRow,
  type PendingMissed,
  type Progress,
} from "./logic";

export { CLOSED_LIMIT };
const CHUNK = 80;
/** PostgREST max_rows (supabase/config.toml) — ผลที่ได้เต็มเพดานนี้ = อาจถูกตัด */
const MAX_ROWS = KEYSET_PAGE_SIZE;

export interface AgPendingItem {
  stationId: string;
  contractId: string;
  customerId: string;
  customerName: string;
  branchName: string;
  contractNo: string;
  /** ป้ายจุด หรือเลขสถานี — ว่างได้ */
  label: string;
}

export interface TodoData {
  /** 'YYYY-MM' เดือนที่หน้านี้แสดง */
  month: string;
  currentMonth: string;
  /** เดือนของหน้าเก่ากว่าเดือนปัจจุบัน (ยังปิดงานเดือนก่อนไม่เสร็จ) */
  isBehind: boolean;
  progress: Progress;
  unfilled: ContractListItem[];
  /** สาขาใดสาขาหนึ่งชนเพดานแถว → ตัวเลขความคืบหน้าอาจต่ำกว่าจริง */
  truncated: boolean;
  branchNames: Record<string, string>;
  pending: PendingMissed[];
  closed: ClosedMissed[];
  agPending: AgPendingItem[];
  collect: CollectSummary;
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

type ContractName = { contractNo: string; customerId: string; customerName: string; branchId: string };

/** ชื่อลูกค้า/เลขสัญญา/สาขา ของสัญญาที่ระบุ (อ่านตาม RLS) */
async function loadContractNames(
  supabase: SupabaseClient,
  ids: readonly string[],
): Promise<{ map: Map<string, ContractName>; error: string | null }> {
  const map = new Map<string, ContractName>();
  const results = await Promise.all(
    chunks([...new Set(ids)], CHUNK).map((part) =>
      supabase
        .from("contracts")
        .select("id, contract_no, customer_id, customers!inner ( name, branch_id )")
        .in("id", part),
    ),
  );
  for (const r of results) {
    if (r.error) return { map, error: r.error.message };
    for (const c of (r.data ?? []) as unknown as {
      id: string;
      contract_no: string;
      customer_id: string;
      customers: { name: string; branch_id: string };
    }[]) {
      map.set(c.id, {
        contractNo: c.contract_no,
        customerId: c.customer_id,
        customerName: c.customers.name,
        branchId: c.customers.branch_id,
      });
    }
  }
  return { map, error: null };
}

export async function loadTodo(supabase: SupabaseClient): Promise<{ data: TodoData | null; error: string | null }> {
  const currentMonth = currentBangkokMonth();
  const today = todayBangkok();

  // 1) เดือนของหน้า
  const open = await supabase.rpc("oldest_open_month");
  if (open.error) return { data: null, error: open.error.message };
  const rows: OldestOpenRow[] = ((open.data ?? []) as { scope: "central" | "province"; oldest_open_month: string; is_behind: boolean }[]).map(
    (r) => ({ scope: r.scope, month: toMonthKey(r.oldest_open_month), isBehind: r.is_behind }),
  );
  const picked = pickPageScope(rows);
  const month = picked?.month ?? currentMonth;
  const scope = picked?.scope ?? "central";

  // 2) ข้อมูลอ้างอิง (สาขาของส่วนที่แสดง + เกณฑ์ Tier สำหรับป้ายในรายการ)
  const [master, branchRes] = await Promise.all([
    loadServiceMaster(supabase),
    supabase.from("branches").select("id, name, zone_id, division").eq("is_active", true).eq("division", scope).order("name"),
  ]);
  if (!master.master || master.error) return { data: null, error: master.error ?? "โหลดข้อมูลอ้างอิงไม่สำเร็จ" };
  if (branchRes.error) return { data: null, error: branchRes.error.message };
  const branches = (branchRes.data ?? []) as { id: string; name: string; zone_id: string }[];
  const zoneOf: Record<string, string> = Object.fromEntries(branches.map((b) => [b.id, b.zone_id]));
  const branchNames: Record<string, string> = Object.fromEntries(branches.map((b) => [b.id, b.name]));
  const branchIds = new Set(branches.map((b) => b.id));

  // 3) ความคืบหน้า + รายการยังไม่กรอก (รายสาขาแล้วรวม — กันชนเพดานต่อคำขอ)
  const lists = await Promise.all(
    branches.map((b) => loadContractList(supabase, month, [b.id], master.master?.tierRules ?? [])),
  );
  const listError = lists.find((l) => l.error);
  if (listError?.error) return { data: null, error: listError.error };
  const items = lists.flatMap((l) => l.items);
  let truncated = lists.some((l) => l.truncated);
  const progress = computeProgress(items);
  const unfilled = items
    .filter((i) => i.routineCountInMonth === 0)
    .sort((a, b) => a.customerName.localeCompare(b.customerName, "th"));

  // 4) ตกบริการรอตัดสิน
  const pendRes = await loadPendingMissedRows(supabase, month, [...branchIds]);
  if (pendRes.error) return { data: null, error: pendRes.error };
  if (pendRes.truncated) truncated = true;
  const pendRaw = pendRes.rows.filter((p) => branchIds.has(p.branch_id));

  // 5) เรื่องที่ปิดแล้ว
  const closedRes = await supabase
    .from("missed_service_resolutions")
    .select("contract_id, missed_month, kind, reason, decided_at")
    .order("decided_at", { ascending: false })
    .limit(CLOSED_LIMIT);
  if (closedRes.error) return { data: null, error: closedRes.error.message };
  const closedRaw = (closedRes.data ?? []) as {
    contract_id: string;
    missed_month: string;
    kind: "makeup" | "waived";
    reason: string | null;
    decided_at: string;
  }[];

  // 6) กล่อง AG รอถอด
  type AgRow = { id: string; contract_id: string; station_no: number | null; point_label: string | null };
  const agRes = await fetchAllKeyset<AgRow>(
    async (after) => {
      let q = supabase
        .from("stations")
        .select("id, contract_id, station_no, point_label")
        .eq("type", "AG")
        .eq("status", "pending_removal")
        .order("id", { ascending: true })
        .limit(MAX_ROWS);
      if (after !== null) q = q.gt("id", after);
      const r = await q;
      return { data: (r.data ?? null) as AgRow[] | null, error: r.error };
    },
    (r) => r.id,
  );
  if (agRes.error) return { data: null, error: agRes.error };
  if (agRes.truncated) truncated = true;
  const agRaw = agRes.rows;

  // 7) ลูกค้ารอเก็บสถานี
  // ⚠ ต้องดึงครบทุกแถวด้วย keyset (เดิม .limit(1000) ไม่เรียง → ได้แถวสุ่ม 1,000 แล้วกรอง "จบแล้ว" ทีหลัง = นับต่ำกว่าจริง · บั๊ก B1)
  type ColRow = { contract_id: string; remaining: number };
  const colRes = await fetchAllKeyset<ColRow>(
    async (after) => {
      let q = supabase
        .from("v_contract_ig_collection")
        .select("contract_id, remaining")
        .gt("remaining", 0)
        .order("contract_id", { ascending: true })
        .limit(MAX_ROWS);
      if (after !== null) q = q.gt("contract_id", after);
      const r = await q;
      return { data: (r.data ?? null) as ColRow[] | null, error: r.error };
    },
    (r) => r.contract_id,
  );
  if (colRes.error) return { data: null, error: colRes.error };
  if (colRes.truncated) truncated = true;
  const colRaw = colRes.rows;

  // ชื่อ/สาขาของสัญญาที่เกี่ยวข้องทั้งหมด (ครั้งเดียว)
  const names = await loadContractNames(supabase, [
    ...pendRaw.map((p) => p.contract_id),
    ...closedRaw.map((c) => c.contract_id),
    ...agRaw.map((a) => a.contract_id),
    ...colRaw.map((c) => c.contract_id),
  ]);
  if (names.error) return { data: null, error: names.error };
  const nameOf = (id: string) => names.map.get(id);

  const pending: PendingMissed[] = sortPending(
    pendRaw.flatMap((p) => {
      const n = nameOf(p.contract_id);
      if (!n) return [];
      return [
        {
          contractId: p.contract_id,
          customerId: n.customerId,
          customerName: n.customerName,
          branchName: branchNames[p.branch_id] ?? "-",
          branchId: p.branch_id,
          zoneId: zoneOf[p.branch_id] ?? "",
          contractNo: n.contractNo,
          missedMonth: toMonthKey(p.missed_month),
          lastServiceMonth: toMonthKey(p.last_service_month),
          deadlineMonth: toMonthKey(p.makeup_deadline_month),
          pastDeadline: p.past_deadline,
        },
      ];
    }),
  );

  const closed: ClosedMissed[] = sortClosed(
    closedRaw.flatMap((c) => {
      const n = nameOf(c.contract_id);
      if (!n || !branchIds.has(n.branchId)) return [];
      return [
        {
          contractId: c.contract_id,
          customerId: n.customerId,
          customerName: n.customerName,
          branchName: branchNames[n.branchId] ?? "-",
          contractNo: n.contractNo,
          missedMonth: toMonthKey(c.missed_month),
          kind: c.kind,
          reason: c.reason,
          decidedOn: c.decided_at ? c.decided_at.slice(0, 10) : null,
        },
      ];
    }),
  );

  const agPending: AgPendingItem[] = agRaw.flatMap((a) => {
    const n = nameOf(a.contract_id);
    if (!n || !branchIds.has(n.branchId)) return [];
    return [
      {
        stationId: a.id,
        contractId: a.contract_id,
        customerId: n.customerId,
        customerName: n.customerName,
        branchName: branchNames[n.branchId] ?? "-",
        contractNo: n.contractNo,
        label: a.point_label?.trim() || (a.station_no !== null ? String(a.station_no) : ""),
      },
    ];
  });

  // ลูกค้ารอเก็บ: ต้องรู้สถานะ/วันจบสัญญา (วันจบคำนวณด้วย lib/rules)
  const colIds = colRaw.map((c) => c.contract_id).filter((id) => {
    const n = nameOf(id);
    return n ? branchIds.has(n.branchId) : false;
  });
  const colContracts = await Promise.all(
    chunks(colIds, CHUNK).map((part) =>
      supabase.from("contracts").select("id, status, start_date, end_date, term_months").in("id", part),
    ),
  );
  const colErr = colContracts.find((r) => r.error);
  if (colErr?.error) return { data: null, error: colErr.error.message };
  const remainingById = new Map(colRaw.map((c) => [c.contract_id, c.remaining]));
  const collectInputs: CollectContractInput[] = colContracts.flatMap((r) =>
    ((r.data ?? []) as { id: string; status: CollectContractInput["status"]; start_date: string; end_date: string | null; term_months: number }[]).map(
      (c) => ({
        customerId: nameOf(c.id)?.customerId ?? c.id,
        remaining: remainingById.get(c.id) ?? 0,
        status: c.status,
        endDate: effectiveEndDate({
          startDate: c.start_date,
          endDate: c.end_date ?? undefined,
          termMonths: termMonthsOf(c.term_months),
        }),
      }),
    ),
  );

  return {
    data: {
      month,
      currentMonth,
      isBehind: month < currentMonth,
      progress,
      unfilled,
      truncated,
      branchNames,
      pending,
      closed,
      agPending,
      collect: summarizeCollect(collectInputs, today),
    },
    error: null,
  };
}
