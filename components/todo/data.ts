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
 *   * อ่านพลาด = ให้หน้าจอแจ้งชัด · ไม่แสดงตัวเลขสมมติ
 *
 * โครงการโหลด (แก้ 28 พ.ย. 2026 · เร็วขึ้น + ไม่พังทั้งหน้า):
 *   * ขั้นจำเป็น (พลาด = หน้า error ทั้งหน้า): ① เดือน/ส่วน oldest_open_month ② ข้อมูลอ้างอิง + รายชื่อสาขา
 *   * 5 กล่อง ไม่ขึ้นต่อกัน → ยิงพร้อมกัน (Promise.all) แทนต่อกันทีละขั้น:
 *       progress (ความคืบหน้า + ยังไม่กรอก) · pending (ตกบริการรอตัดสิน) · closed (เรื่องที่ปิดแล้ว) · agPending (AG รอถอด) · collect (รอเก็บสถานี)
 *   * หลังได้ครบ → อ่านชื่อ/สาขาของสัญญา (loadContractNames) ครั้งเดียว แล้วประกอบ pending/closed/agPending/collect
 *   * แต่ละกล่องคืน `Section` = { ok: true, value } หรือ { ok: false } — กล่องพลาดแสดง "โหลดส่วนนี้ไม่สำเร็จ" เฉพาะกล่องนั้น กล่องอื่นแสดงปกติ
 *     (ไม่ส่งข้อความ error ของฐานข้อมูลไปหน้าจอ · log ฝั่ง server `[todo] box <ชื่อ> ...` · ห้ามแสดงตัวเลขสมมติแทน)
 *   * อ่านชื่อสัญญาพลาด → กล่องที่ต้องใช้ชื่อ (และมีแถวให้แสดง) ขึ้นว่าโหลดไม่สำเร็จ · กล่องที่ไม่มีแถวยังแสดงว่าง (จริง)
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

/** ผลของ 1 กล่อง: โหลดได้ (มีค่า) หรือโหลดไม่สำเร็จ (ไม่มีค่า — หน้าจอต้องบอกว่าโหลดไม่ได้ ห้ามแสดงเป็น 0) */
export type Section<T> = { ok: true; value: T } | { ok: false };

export interface ProgressSection {
  progress: Progress;
  unfilled: ContractListItem[];
}

export interface TodoData {
  /** 'YYYY-MM' เดือนที่หน้านี้แสดง */
  month: string;
  currentMonth: string;
  /** เดือนของหน้าเก่ากว่าเดือนปัจจุบัน (ยังปิดงานเดือนก่อนไม่เสร็จ) */
  isBehind: boolean;
  /** สาขาใดสาขาหนึ่งชนเพดานแถว → ตัวเลขอาจต่ำกว่าจริง (นับเฉพาะกล่องที่โหลดสำเร็จ) */
  truncated: boolean;
  branchNames: Record<string, string>;
  progress: Section<ProgressSection>;
  pending: Section<PendingMissed[]>;
  closed: Section<ClosedMissed[]>;
  agPending: Section<AgPendingItem[]>;
  collect: Section<CollectSummary>;
}

type AgRow = { id: string; contract_id: string; station_no: number | null; point_label: string | null };
type ColRow = { contract_id: string; remaining: number };
type ClosedRaw = {
  contract_id: string;
  missed_month: string;
  kind: "makeup" | "waived";
  reason: string | null;
  decided_at: string;
};

/** ผลดิบของ 1 กล่องก่อนประกอบ */
type BoxStep<T> = { ok: true; value: T; truncated: boolean } | { ok: false };

/**
 * รัน 1 กล่องแบบกันพัง: error (หรือ exception) → log ฝั่ง server แล้วคืน { ok: false } ไม่ให้กล่องอื่นพลอยพัง
 * (log เฉพาะข้อความ error ของฐานข้อมูล ไม่มีข้อมูลลูกค้า)
 */
async function runBox<T>(
  name: string,
  fn: () => PromiseLike<{ value: T; truncated?: boolean; error: string | null }>,
): Promise<BoxStep<T>> {
  try {
    const r = await fn();
    if (r.error) {
      console.error(`[todo] box ${name} load error`, r.error);
      return { ok: false };
    }
    return { ok: true, value: r.value, truncated: r.truncated ?? false };
  } catch (e) {
    console.error(`[todo] box ${name} load error`, e instanceof Error ? e.message : String(e));
    return { ok: false };
  }
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

  // ขั้นจำเป็น 1) เดือนของหน้า — พลาด = ทั้งหน้า error
  const open = await supabase.rpc("oldest_open_month");
  if (open.error) return { data: null, error: open.error.message };
  const rows: OldestOpenRow[] = ((open.data ?? []) as { scope: "central" | "province"; oldest_open_month: string; is_behind: boolean }[]).map(
    (r) => ({ scope: r.scope, month: toMonthKey(r.oldest_open_month), isBehind: r.is_behind }),
  );
  const picked = pickPageScope(rows);
  const month = picked?.month ?? currentMonth;
  const scope = picked?.scope ?? "central";

  // ขั้นจำเป็น 2) ข้อมูลอ้างอิง (สาขาของส่วนที่แสดง + เกณฑ์ Tier สำหรับป้ายในรายการ) — พลาด = ทั้งหน้า error
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
  const tierRules = master.master.tierRules ?? [];

  // 3–7) 5 กล่องไม่ขึ้นต่อกัน → ยิงพร้อมกัน (ความขนานภายในกล่อง progress = รายสาขาเหมือนเดิม ไม่เพิ่ม)
  const [progressStep, pendStep, closedStep, agStep, colStep] = await Promise.all([
    // 3) ความคืบหน้า + รายการยังไม่กรอก (รายสาขาแล้วรวม — กันชนเพดานต่อคำขอ)
    runBox<ProgressSection>("progress", async () => {
      const lists = await Promise.all(branches.map((b) => loadContractList(supabase, month, [b.id], tierRules)));
      const listError = lists.find((l) => l.error);
      if (listError?.error) return { value: { progress: computeProgress([]), unfilled: [] }, error: listError.error };
      const items = lists.flatMap((l) => l.items);
      const unfilled = items
        .filter((i) => i.routineCountInMonth === 0)
        .sort((a, b) => a.customerName.localeCompare(b.customerName, "th"));
      return { value: { progress: computeProgress(items), unfilled }, truncated: lists.some((l) => l.truncated), error: null };
    }),
    // 4) ตกบริการรอตัดสิน
    runBox("pending", async () => {
      const r = await loadPendingMissedRows(supabase, month, [...branchIds]);
      return { value: r.rows.filter((p) => branchIds.has(p.branch_id)), truncated: r.truncated, error: r.error };
    }),
    // 5) เรื่องที่ปิดแล้ว
    runBox<ClosedRaw[]>("closed", async () => {
      const r = await supabase
        .from("missed_service_resolutions")
        .select("contract_id, missed_month, kind, reason, decided_at")
        .order("decided_at", { ascending: false })
        .limit(CLOSED_LIMIT);
      return { value: (r.data ?? []) as ClosedRaw[], error: r.error?.message ?? null };
    }),
    // 6) กล่อง AG รอถอด
    runBox<AgRow[]>("agPending", async () => {
      const r = await fetchAllKeyset<AgRow>(
        async (after) => {
          let q = supabase
            .from("stations")
            .select("id, contract_id, station_no, point_label")
            .eq("type", "AG")
            .eq("status", "pending_removal")
            .order("id", { ascending: true })
            .limit(MAX_ROWS);
          if (after !== null) q = q.gt("id", after);
          const res = await q;
          return { data: (res.data ?? null) as AgRow[] | null, error: res.error };
        },
        (row) => row.id,
      );
      return { value: r.rows, truncated: r.truncated, error: r.error };
    }),
    // 7) ลูกค้ารอเก็บสถานี
    // ⚠ ต้องดึงครบทุกแถวด้วย keyset (เดิม .limit(1000) ไม่เรียง → ได้แถวสุ่ม 1,000 แล้วกรอง "จบแล้ว" ทีหลัง = นับต่ำกว่าจริง · บั๊ก B1)
    runBox<ColRow[]>("collect", async () => {
      const r = await fetchAllKeyset<ColRow>(
        async (after) => {
          let q = supabase
            .from("v_contract_ig_collection")
            .select("contract_id, remaining")
            .gt("remaining", 0)
            .order("contract_id", { ascending: true })
            .limit(MAX_ROWS);
          if (after !== null) q = q.gt("contract_id", after);
          const res = await q;
          return { data: (res.data ?? null) as ColRow[] | null, error: res.error };
        },
        (row) => row.contract_id,
      );
      return { value: r.rows, truncated: r.truncated, error: r.error };
    }),
  ]);

  const pendRaw = pendStep.ok ? pendStep.value : [];
  const closedRaw = closedStep.ok ? closedStep.value : [];
  const agRaw = agStep.ok ? agStep.value : [];
  const colRaw = colStep.ok ? colStep.value : [];

  // ชื่อ/สาขาของสัญญาที่เกี่ยวข้องทั้งหมด (ครั้งเดียว · ต้องรอผลกล่อง 4–7 ก่อน)
  const names = await runBox("contractNames", async () => {
    const r = await loadContractNames(supabase, [
      ...pendRaw.map((p) => p.contract_id),
      ...closedRaw.map((c) => c.contract_id),
      ...agRaw.map((a) => a.contract_id),
      ...colRaw.map((c) => c.contract_id),
    ]);
    return { value: r.map, error: r.error };
  });
  const nameMap = names.ok ? names.value : new Map<string, ContractName>();
  const nameOf = (id: string) => nameMap.get(id);
  /** กล่องที่ต้องใช้ชื่อ: อ่านชื่อพลาดและมีแถวให้แสดง = โหลดไม่สำเร็จ (ไม่โกหกว่าว่าง) · ไม่มีแถวเลย = ว่างจริง */
  const needNames = (rowCount: number) => !names.ok && rowCount > 0;

  let truncated = false;
  for (const step of [progressStep, pendStep, closedStep, agStep, colStep]) {
    if (step.ok && step.truncated) truncated = true;
  }

  const progress: Section<ProgressSection> = progressStep.ok ? { ok: true, value: progressStep.value } : { ok: false };

  const pending: Section<PendingMissed[]> =
    !pendStep.ok || needNames(pendRaw.length)
      ? { ok: false }
      : {
          ok: true,
          value: sortPending(
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
          ),
        };

  const closed: Section<ClosedMissed[]> =
    !closedStep.ok || needNames(closedRaw.length)
      ? { ok: false }
      : {
          ok: true,
          value: sortClosed(
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
          ),
        };

  const agPending: Section<AgPendingItem[]> =
    !agStep.ok || needNames(agRaw.length)
      ? { ok: false }
      : {
          ok: true,
          value: agRaw.flatMap((a) => {
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
          }),
        };

  // ลูกค้ารอเก็บ: ต้องรู้สถานะ/วันจบสัญญา (วันจบคำนวณด้วย lib/rules)
  let collect: Section<CollectSummary> = { ok: false };
  if (colStep.ok && !needNames(colRaw.length)) {
    const colIds = colRaw.map((c) => c.contract_id).filter((id) => {
      const n = nameOf(id);
      return n ? branchIds.has(n.branchId) : false;
    });
    const remainingById = new Map(colRaw.map((c) => [c.contract_id, c.remaining]));
    const collectStep = await runBox<CollectSummary>("collectContracts", async () => {
      const colContracts = await Promise.all(
        chunks(colIds, CHUNK).map((part) =>
          supabase.from("contracts").select("id, status, start_date, end_date, term_months").in("id", part),
        ),
      );
      const colErr = colContracts.find((r) => r.error);
      if (colErr?.error) return { value: summarizeCollect([], today), error: colErr.error.message };
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
      return { value: summarizeCollect(collectInputs, today), error: null };
    });
    if (collectStep.ok) collect = { ok: true, value: collectStep.value };
  }

  return {
    data: {
      month,
      currentMonth,
      isBehind: month < currentMonth,
      truncated,
      branchNames,
      progress,
      pending,
      closed,
      agPending,
      collect,
    },
    error: null,
  };
}
