/**
 * ตัวกรองหน้าประวัติการแก้ไข — ค่าเริ่มต้น · ตรวจ/ปรับให้ถูกต้อง · แปลงไป-กลับกับ URL (pure function)
 *
 * Logic summary:
 *   * ค่าเริ่มต้น = 7 วันล่าสุด (นับวันนี้ตามเวลาไทย) ทุกตัวกรองอื่นว่าง (= ทั้งหมด)
 *   * ช่วงวันที่: วันเริ่มเลยวันสิ้นสุด → สลับให้ · เกิน MAX_RANGE_DAYS → ตัดวันเริ่มให้พอดี (ไม่ให้ query กวาดทั้งตาราง)
 *   * URL เก็บได้เฉพาะ id (uuid) / enum / วันที่ / เดือน — ไม่มีข้อความอิสระ (PDPA) · ค่าที่ไม่ผ่านรูปแบบถูกทิ้งเงียบๆ
 *   * ตัวกรอง "สัญญา" เก็บเป็น contract id (uuid) เท่านั้น — เลขสัญญาถูกแปลงเป็น id ก่อนเก็บ
 */
import { DATA_KINDS } from "./historyLabels";
import type { AuditAction, HistoryFilters } from "./historyTypes";

/** ช่วงวันที่ยาวสุดที่ให้ค้น (วัน) */
export const MAX_RANGE_DAYS = 366;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS: readonly AuditAction[] = ["insert", "update", "delete"];

function ymdToUtcDay(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function utcDayToYmd(day: number): string {
  const d = new Date(day * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function isValidYmd(v: string): boolean {
  if (!YMD_RE.test(v)) return false;
  return utcDayToYmd(ymdToUtcDay(v)) === v;
}

export function addDays(ymd: string, n: number): string {
  return utcDayToYmd(ymdToUtcDay(ymd) + n);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return ymdToUtcDay(toYmd) - ymdToUtcDay(fromYmd);
}

export function defaultFilters(todayYmd: string): HistoryFilters {
  return {
    from: addDays(todayYmd, -6),
    to: todayYmd,
    people: [],
    zones: [],
    branches: [],
    contractId: null,
    months: [],
    kinds: [],
    actions: [],
    postCloseOnly: false,
  };
}

/** ปรับตัวกรองให้ใช้ได้ · clamped = ช่วงถูกตัดเพราะยาวเกิน */
export function normalizeFilters(f: HistoryFilters, todayYmd: string): { filters: HistoryFilters; clamped: boolean } {
  let from = isValidYmd(f.from) ? f.from : addDays(todayYmd, -6);
  let to = isValidYmd(f.to) ? f.to : todayYmd;
  if (from > to) [from, to] = [to, from];
  let clamped = false;
  if (daysBetween(from, to) > MAX_RANGE_DAYS - 1) {
    from = addDays(to, -(MAX_RANGE_DAYS - 1));
    clamped = true;
  }
  return { filters: { ...f, from, to }, clamped };
}

function csv(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  return raw ? raw.split(",").filter((x) => x !== "") : [];
}

/** อ่านตัวกรองจาก query string — ค่าผิดรูปแบบถูกทิ้ง */
export function filtersFromParams(params: URLSearchParams, todayYmd: string): HistoryFilters {
  const base = defaultFilters(todayYmd);
  const from = params.get("from");
  const to = params.get("to");
  const contract = params.get("c");
  const kindCodes = new Set(DATA_KINDS.map((k) => k.code as string));
  return {
    from: from && isValidYmd(from) ? from : base.from,
    to: to && isValidYmd(to) ? to : base.to,
    people: csv(params, "who").filter((x) => UUID_RE.test(x)),
    zones: csv(params, "zone").filter((x) => UUID_RE.test(x)),
    branches: csv(params, "br").filter((x) => UUID_RE.test(x)),
    contractId: contract && UUID_RE.test(contract) ? contract : null,
    months: csv(params, "m").filter((x) => YM_RE.test(x)),
    kinds: csv(params, "k").filter((x) => kindCodes.has(x)),
    actions: csv(params, "a").filter((x): x is AuditAction => (ACTIONS as readonly string[]).includes(x)),
    postCloseOnly: params.get("pc") === "1",
  };
}

/** แปลงตัวกรองเป็น query string — ใส่เฉพาะค่าที่ต่างจากค่าเริ่มต้น */
export function filtersToParams(f: HistoryFilters, todayYmd: string): URLSearchParams {
  const base = defaultFilters(todayYmd);
  const p = new URLSearchParams();
  if (f.from !== base.from) p.set("from", f.from);
  if (f.to !== base.to) p.set("to", f.to);
  if (f.people.length) p.set("who", f.people.join(","));
  if (f.zones.length) p.set("zone", f.zones.join(","));
  if (f.branches.length) p.set("br", f.branches.join(","));
  if (f.contractId) p.set("c", f.contractId);
  if (f.months.length) p.set("m", f.months.join(","));
  if (f.kinds.length) p.set("k", f.kinds.join(","));
  if (f.actions.length) p.set("a", f.actions.join(","));
  if (f.postCloseOnly) p.set("pc", "1");
  return p;
}

/** จำนวนตัวกรองที่ใช้อยู่ (นับช่วงวันที่เป็น 1 เมื่อไม่ใช่ค่าเริ่มต้น) */
export function countActiveFilters(f: HistoryFilters, todayYmd: string): number {
  const base = defaultFilters(todayYmd);
  return (
    (f.from !== base.from || f.to !== base.to ? 1 : 0) +
    f.people.length +
    f.zones.length +
    f.branches.length +
    (f.contractId ? 1 : 0) +
    f.months.length +
    f.kinds.length +
    f.actions.length +
    (f.postCloseOnly ? 1 : 0)
  );
}
