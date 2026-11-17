/**
 * ตรรกะล้วน (pure function) ของหน้า "รายละเอียดลูกค้า" — แยกจาก UI/DB เพื่อเทสได้
 *
 * Logic summary:
 *   * สูตร Tier / เดือนบริการ / วันสิ้นสุด / ตกบริการ มาจาก lib/rules เท่านั้น (ไฟล์นี้ไม่มีสูตรของตัวเอง)
 *   * สิทธิ์ปุ่ม (customerPermissions): ซ่อน/ปิดปุ่มให้ตรงกับ SPEC §5 — ด่านจริงคือ RLS/RPC ที่ฐานข้อมูล
 *       - admin ดูอย่างเดียวในส่วนตัดสินตกบริการ (DECISIONS 2.57) · แก้ข้อมูลติดต่อได้ทุก role ที่เข้าหน้านี้
 *       - ไทม์ไลน์ (audit_log) = host เท่านั้น
 *   * เดือนตกบริการ: นับตั้งแต่เดือนที่ตั้งสถานี (trackingStartMonth) — เดือนก่อนหน้านั้นแสดง "ยังไม่นับ" ไม่ใช่ "ตก"
 *     สถานะตัดสิน 4 แบบมาจาก missedResolutionStatus (โมฆะใช้ isSuperseded — M28)
 *   * "พบปลวก": IG/IC = แถวผลตรวจที่ตรวจแล้วและมีกลุ่มปลวก · AG = ตรวจแล้วและมีสัดส่วนปลวก (รวม "ปลวกตาย")
 *     นับจุด = สถานีไม่ซ้ำต่อเดือน (เดือนละ 1 ครั้งต่อสถานี)
 *   * ข้อมูลติดต่อ: ส่งเฉพาะช่องที่เปลี่ยนไป RPC (ถ้าไม่เปลี่ยนเลยไม่เรียก — ไม่ประทับ "แก้ล่าสุด" ปลอม)
 */
import type { DbErrorLike } from "@/components/service/errors";
import {
  isSuperseded,
  lastServiceMonth,
  missedMonths,
  missedResolutionStatus,
  serviceMonthsForTerm,
  trackingStartMonth,
  effectiveEndDate,
  type Contract as RuleContract,
  type MissedResolutionStatus,
  type MissedServiceResolution,
  type Visit as RuleVisit,
} from "@/lib/rules";
import { monthOf } from "@/lib/rules/date";
import type { UserRole } from "@/lib/db/types";

import type {
  CheckRow,
  ContractRow,
  ContractStatus,
  FileRow,
  PhoneRow,
  ResolutionRow,
  StationRow,
  StationStatus,
  StationType,
  TimberMonth,
  VisitRow,
  VisitType,
} from "./types";

// ───────────────────────── รูปแบบข้อความ ─────────────────────────

const TH_MONTH_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."] as const;

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (ค.ศ. — SPEC §12) · ว่าง → '—' */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function fmtNum(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** 'YYYY-MM' → 'ต.ค. 2026' */
export function monthTh(month: string): string {
  return `${TH_MONTH_SHORT[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;
}

export function monthShortTh(month: string): string {
  return TH_MONTH_SHORT[Number(month.slice(5, 7)) - 1] ?? month;
}

/** วันที่ใน timestamptz → วันที่เวลาไทย 'YYYY-MM-DD' */
export function bangkokDate(ts: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / 86_400_000);
}

// ───────────────────────── ป้ายสถานะ ─────────────────────────

export type Tone = "ok" | "miss" | "pend" | "na" | "info";

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, { text: string; tone: Tone }> = {
  active: { text: "ใช้งาน", tone: "ok" },
  expired_pending_collection: { text: "หมดสัญญา · รอเก็บสถานี", tone: "pend" },
  closed: { text: "ปิดสัญญาแล้ว", tone: "na" },
  cancelled: { text: "ยกเลิก", tone: "miss" },
};

export const VISIT_TYPE_LABEL: Record<VisitType, { text: string; tone: Tone }> = {
  routine: { text: "รอบประจำเดือน", tone: "info" },
  problem: { text: "รอบแก้ไขปัญหา", tone: "miss" },
  follow_up: { text: "รอบติดตามผล", tone: "pend" },
};

const STATION_STATUS_LABEL: Record<StationStatus, { text: string; tone: Tone }> = {
  active: { text: "ใช้งาน", tone: "ok" },
  pending_removal: { text: "รอถอด", tone: "pend" },
  removed: { text: "ถอดแล้ว", tone: "na" },
  lost: { text: "หาย", tone: "miss" },
  withdrawn: { text: "ถอนออก", tone: "na" },
  eliminated: { text: "จบงาน", tone: "na" },
};

/** สถานะที่แสดง: AG ที่ active = "ติดตามผล" (ไม่มี "กำจัดแล้ว" — DECISIONS 2.34) */
export function stationStatusLabel(s: Pick<StationRow, "type" | "status">): { text: string; tone: Tone } {
  if (s.status === "active" && s.type === "AG") return { text: "ติดตามผล", tone: "info" };
  return STATION_STATUS_LABEL[s.status];
}

/** ยังอยู่หน้างาน (หาย/ถอนออก/ถอดแล้วไม่นับ) */
export function inArea(s: Pick<StationRow, "status">): boolean {
  return s.status !== "removed" && s.status !== "lost" && s.status !== "withdrawn";
}

export interface StationCounts {
  IG: number;
  IC: number;
  AG: number;
  total: number;
  byStatus: Record<StationStatus, number>;
}

export function stationCounts(list: readonly Pick<StationRow, "type" | "status">[]): StationCounts {
  const r: StationCounts = {
    IG: 0,
    IC: 0,
    AG: 0,
    total: list.length,
    byStatus: { active: 0, pending_removal: 0, removed: 0, lost: 0, withdrawn: 0, eliminated: 0 },
  };
  for (const s of list) {
    r[s.type] += 1;
    r.byStatus[s.status] += 1;
  }
  return r;
}

// ───────────────────────── สิทธิ์ปุ่ม ─────────────────────────

export interface CustomerPermissions {
  /** เข้าหน้านี้ได้ไหม (viewer ห้าม — PDPA) */
  canView: boolean;
  /** แก้ผู้ติดต่อ/เบอร์/หมายเหตุ (host · admin · หัวหน้างาน) */
  editContact: boolean;
  /** ลิงก์ไปหน้าลงข้อมูลบริการ / กล่อง AG (host · หัวหน้างาน) */
  entry: boolean;
  /** ลิงก์ไปหน้าเปิดงานเพื่อแก้ข้อมูล/สัญญา/แนบไฟล์ (host · admin) */
  edit: boolean;
  /** ตัดสินตกบริการ: ไม่ชดเชย / เปิดเรื่องกลับ (host · หัวหน้างาน — admin ดูอย่างเดียว · 2.57) */
  resolve: boolean;
  /** แท็บไทม์ไลน์ (audit_log) */
  timeline: boolean;
  /** ลิงก์ไปหน้าลูกค้ารอเก็บสถานี */
  collect: boolean;
}

export function customerPermissions(role: UserRole): CustomerPermissions {
  const staff = role === "host" || role === "admin" || role === "recorder";
  return {
    canView: staff,
    editContact: staff,
    entry: role === "host" || role === "recorder",
    edit: role === "host" || role === "admin",
    resolve: role === "host" || role === "recorder",
    timeline: role === "host",
    collect: staff,
  };
}

/** admin แก้สัญญาปิดแล้ว/ยกเลิกไม่ได้ · host แก้ได้ (DECISIONS 3.11) */
export function canEditContract(role: UserRole, status: ContractStatus): boolean {
  if (role === "host") return true;
  return role === "admin" && status !== "closed" && status !== "cancelled";
}

/** ไฟล์: ปิดแล้วล็อกทุกคน · ยกเลิก host แก้ได้ admin ไม่ได้ (DECISIONS 3.13) */
export function canAttachContract(role: UserRole, status: ContractStatus): boolean {
  if (role === "host") return status !== "closed";
  return role === "admin" && status !== "closed" && status !== "cancelled";
}

// ───────────────────────── สัญญา / Tier / วันสิ้นสุด ─────────────────────────

export function ruleContract(c: ContractRow, customerId?: string): RuleContract {
  return {
    id: c.id,
    startDate: c.startDate,
    termMonths: c.termMonths,
    valueTotal: c.valueTotal,
    ...(c.cancelledAt ? { cancelledAt: c.cancelledAt } : {}),
    ...(c.stationsInitializedAt ? { stationsInitializedAt: c.stationsInitializedAt } : {}),
    ...(c.renewedFromId ? { renewedFromContractId: c.renewedFromId } : {}),
    ...(customerId ? { customerId } : {}),
    ...(c.endDate ? { endDate: c.endDate } : {}),
  };
}

/** วันสิ้นสุดที่ใช้จริง = end_date ถ้ามี · ไม่มี = วันเริ่ม + N เดือน − 1 วัน (lib/rules) */
export function contractEnd(c: ContractRow): string {
  return effectiveEndDate({ startDate: c.startDate, termMonths: c.termMonths, ...(c.endDate ? { endDate: c.endDate } : {}) });
}

/** วันสิ้นสุดตามกฎ (ไม่สนใจ end_date) — ใช้เตือน "วันสิ้นสุดไม่ตรงกฎ" */
export function ruleEnd(c: ContractRow): string {
  return effectiveEndDate({ startDate: c.startDate, termMonths: c.termMonths });
}

export function termText(termMonths: number): string {
  if (termMonths === 12) return "1 ปี";
  if (termMonths === 36) return "3 ปี";
  return `${termMonths} เดือน`;
}

export function sortContracts(list: readonly ContractRow[]): ContractRow[] {
  return [...list].sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0));
}

/** สัญญาที่ใช้เป็นหัวการ์ด: ใช้งาน → หมดสัญญารอเก็บ → ล่าสุด */
export function primaryContract(list: readonly ContractRow[]): ContractRow | null {
  const sorted = sortContracts(list);
  return (
    sorted.find((c) => c.status === "active") ??
    sorted.find((c) => c.status === "expired_pending_collection") ??
    sorted[0] ??
    null
  );
}

// ───────────────────────── ตกบริการ ─────────────────────────

/** สถานะเดือนในแถบเดือนบริการ — pre = ก่อนเริ่มนับตก (ยังไม่ตั้งสถานี) */
export type MonthState = "ok" | "miss" | "now" | "fut" | "cx" | "pre";

export function toRuleVisits(visits: readonly VisitRow[]): RuleVisit[] {
  return visits.map((v) => ({
    contractId: v.contractId,
    visitDate: v.date,
    visitType: v.type,
    ...(v.makeupForMonth ? { makeupForMonth: v.makeupForMonth.slice(0, 7) } : {}),
  }));
}

export function monthStates(c: ContractRow, visits: readonly VisitRow[], currentMonth: string): { month: string; state: MonthState }[] {
  const routine = new Set(
    visits.filter((v) => v.contractId === c.id && v.type === "routine" && !v.makeupForMonth).map((v) => monthOf(v.date)),
  );
  const from = trackingStartMonth(ruleContract(c));
  const cancelM = c.cancelledAt ? monthOf(c.cancelledAt) : null;
  return serviceMonthsForTerm(c.startDate, c.termMonths).map((month) => {
    let state: MonthState;
    if (cancelM && month >= cancelM) state = "cx";
    else if (routine.has(month)) state = "ok";
    else if (month > currentMonth) state = "fut";
    else if (month === currentMonth) state = "now";
    else if (from === null || month < from) state = "pre";
    else state = "miss";
    return { month, state };
  });
}

export interface MissedItem {
  contractId: string;
  contractNo: string;
  month: string;
  status: MissedResolutionStatus;
  /** เดือนสุดท้ายที่หัวหน้างานชดเชยได้ */
  deadlineMonth: string;
  pastDeadline: boolean;
  /** วันที่ไปชดเชยจริง (เมื่อ status = made_up) */
  makeupDate: string | null;
  makeupTeams: string[];
  reason: string | null;
  evidencePath: string | null;
  decidedByName: string | null;
  supersededByNo: string | null;
}

/** เพิ่มจำนวนเดือนให้ 'YYYY-MM' */
export function addMonths(month: string, delta: number): string {
  const total = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function computeMissed(args: {
  contracts: readonly ContractRow[];
  visits: readonly VisitRow[];
  resolutions: readonly ResolutionRow[];
  customerId: string;
  currentMonth: string;
  deadlineMonths: number;
}): MissedItem[] {
  const ruleContracts = args.contracts.map((c) => ruleContract(c, args.customerId));
  const ruleVisits = toRuleVisits(args.visits);
  const out: MissedItem[] = [];
  for (const c of args.contracts) {
    const rc = ruleContracts.find((r) => r.id === c.id) as RuleContract;
    const superseded = isSuperseded(rc, ruleContracts);
    const supersedeNo = superseded
      ? (args.contracts.find((o) => o.renewedFromId === c.id && !o.cancelledAt)?.no ?? null)
      : null;
    const deadlineMonth = addMonths(lastServiceMonth(rc), args.deadlineMonths);
    for (const month of missedMonths(rc, ruleVisits, args.currentMonth)) {
      const res = args.resolutions.find((r) => r.contractId === c.id && monthOf(r.missedMonth) === month);
      const ruleRes: MissedServiceResolution | undefined = res
        ? { contractId: c.id, missedMonth: month, kind: res.kind }
        : undefined;
      const status = missedResolutionStatus(rc, month, ruleRes, ruleVisits, superseded);
      const makeup =
        status === "made_up"
          ? args.visits.find((v) => v.contractId === c.id && v.type === "routine" && v.makeupForMonth && monthOf(v.makeupForMonth) === month)
          : undefined;
      out.push({
        contractId: c.id,
        contractNo: c.no,
        month,
        status,
        deadlineMonth,
        pastDeadline: args.currentMonth > deadlineMonth,
        makeupDate: makeup?.date ?? null,
        makeupTeams: makeup?.teamCodes ?? [],
        reason: res?.kind === "waived" ? res.reason : null,
        evidencePath: res?.kind === "waived" ? res.evidencePath : null,
        decidedByName: res?.decidedByName ?? null,
        supersededByNo: status === "void_renewed" ? supersedeNo : null,
      });
    }
  }
  return out;
}

export function missedCounts(items: readonly MissedItem[]): { total: number; pending: number; madeUp: number; waived: number; voided: number } {
  const r = { total: items.length, pending: 0, madeUp: 0, waived: 0, voided: 0 };
  for (const i of items) {
    if (i.status === "pending") r.pending += 1;
    else if (i.status === "made_up") r.madeUp += 1;
    else if (i.status === "waived") r.waived += 1;
    else r.voided += 1;
  }
  return r;
}

export const MISSED_STATUS_LABEL: Record<MissedResolutionStatus, { text: string; tone: Tone }> = {
  pending: { text: "รอตัดสิน", tone: "miss" },
  made_up: { text: "ชดเชยแล้ว", tone: "ok" },
  waived: { text: "ไม่ชดเชย", tone: "na" },
  void_renewed: { text: "โมฆะ (ต่อสัญญาแล้ว)", tone: "na" },
};

/** ปุ่มของแถวรอตัดสิน — ตรงกับหน้า /todo: เลยเพดาน หัวหน้างานชดเชยไม่ได้ (Host ได้) · สัญญายกเลิกไม่มีปุ่ม */
export function missedActions(args: {
  role: UserRole;
  contractStatus: ContractStatus;
  item: Pick<MissedItem, "status" | "pastDeadline">;
}): { waive: boolean; record: boolean; recordOverCap: boolean; reopen: boolean } {
  const decide = args.role === "host" || args.role === "recorder";
  const cancelled = args.contractStatus === "cancelled";
  const pending = args.item.status === "pending";
  return {
    waive: decide && pending && !cancelled,
    record: decide && pending && !cancelled && (!args.item.pastDeadline || args.role === "host"),
    recordOverCap: args.role === "host" && args.item.pastDeadline,
    reopen: decide && args.item.status === "waived",
  };
}

// ───────────────────────── การ์ดตัวเลข + แถบเตือน ─────────────────────────

export interface CollectProgress {
  done: number;
  waived: number;
  pending: number;
  total: number;
}

/** เก็บสถานี IG คืน (DECISIONS 2.42): IG ที่ไม่ใช่หาย/ถอนออก */
export function collectProgress(stations: readonly StationRow[], contractId: string): CollectProgress {
  const list = stations.filter((s) => s.contractId === contractId && s.type === "IG" && s.status !== "lost" && s.status !== "withdrawn");
  const done = list.filter((s) => s.collectedAt).length;
  const waived = list.filter((s) => !s.collectedAt && s.notCollectedOn).length;
  return { done, waived, pending: list.length - done - waived, total: list.length };
}

/** สถานะ IG ของสัญญาที่หมด/ปิดแล้ว */
export function igCollectState(s: StationRow, contract: ContractRow | undefined): "pending" | "collected" | "waived" | "" {
  if (s.type !== "IG" || !contract) return "";
  if (contract.status !== "expired_pending_collection" && contract.status !== "closed") return "";
  if (s.status === "lost" || s.status === "withdrawn") return "";
  return s.collectedAt ? "collected" : s.notCollectedOn ? "waived" : "pending";
}

/** IC ของสัญญาที่หมดแล้ว/ปิดแล้ว = มอบให้ลูกค้า (DECISIONS 2.42) */
export function icHanded(s: StationRow, contract: ContractRow | undefined): "expired" | "closed" | "" {
  if (s.type !== "IC" || !contract) return "";
  return contract.status === "closed" ? "closed" : contract.status === "expired_pending_collection" ? "expired" : "";
}

export type AgCardState =
  | { kind: "pending"; list: StationRow[] }
  | { kind: "tracking"; list: StationRow[] }
  | { kind: "none" };

export function agCardState(stations: readonly StationRow[]): AgCardState {
  const ags = stations.filter((s) => s.type === "AG");
  const pend = ags.filter((s) => s.status === "pending_removal");
  if (pend.length) return { kind: "pending", list: pend };
  const trk = ags.filter((s) => s.status === "active");
  if (trk.length) return { kind: "tracking", list: trk };
  return { kind: "none" };
}

/** ชื่อจุด AG ในการ์ด: "AG-02 โถงหน้า" (สูงสุด 3 จุด แล้ว +N) */
export function agNames(list: readonly Pick<StationRow, "code" | "pointLabel">[]): string {
  const names = list.map((x) => (x.pointLabel ? `${x.code} ${x.pointLabel}` : x.code));
  return names.length > 3 ? `${names.slice(0, 3).join(" · ")} · +${names.length - 3}` : names.join(" · ");
}

export interface DetailAlert {
  tone: "warn" | "info";
  title: string;
  body: string;
  /** ปุ่มลัด */
  action?: { kind: "contract"; contractNo: string; label: string } | { kind: "collect"; label: string };
}

export function buildAlerts(args: {
  contracts: readonly ContractRow[];
  stations: readonly StationRow[];
  today: string;
  role: UserRole;
  customerTeamCodes: readonly string[];
  myTeamCode: string | null;
  canGoCollect: boolean;
}): DetailAlert[] {
  const out: DetailAlert[] = [];
  for (const c of args.contracts) {
    if (c.status === "active") {
      const end = contractEnd(c);
      const left = daysBetween(args.today, end);
      if (left <= 90) {
        out.push({ tone: "warn", title: `สัญญา ${c.no} ใกล้หมด`, body: left >= 0 ? `อีก ${left} วัน (หมด ${fmtDate(end)})` : `เลยวันสิ้นสุด ${fmtDate(end)} แล้ว` });
      }
      if (c.endDate && c.endDate.slice(0, 10) !== ruleEnd(c)) {
        out.push({
          tone: "warn",
          title: `วันสิ้นสุด ${c.no} ไม่ตรงกฎ`,
          body: `${fmtDate(c.endDate)} (ควรเป็น ${fmtDate(ruleEnd(c))})`,
          action: { kind: "contract", contractNo: c.no, label: "ดูสัญญา" },
        });
      }
    }
    if (c.status === "expired_pending_collection") {
      const p = collectProgress(args.stations, c.id);
      out.push({
        tone: "warn",
        title: `หมดสัญญา — IG รอเก็บ ${p.pending} จุด`,
        body: `เก็บแล้ว ${p.done}${p.waived ? ` · ไม่เก็บ ${p.waived}` : ""} / ${p.total} · ปิดสัญญาได้แม้ยังไม่เก็บ · IC มอบให้ลูกค้า (${c.no})`,
        ...(args.canGoCollect ? { action: { kind: "collect", label: "ไปหน้าลูกค้ารอเก็บสถานี" } as const } : {}),
      });
    }
  }
  if (args.role === "recorder" && isCrossTeamLocal(args.customerTeamCodes, args.myTeamCode)) {
    out.push({
      tone: "info",
      title: `ลูกค้าของทีม ${args.customerTeamCodes.join(", ")}`,
      body: `คุณเป็นทีม ${args.myTeamCode ?? "—"} — ถ้ากรอกผลบริการให้ลูกค้ารายนี้ ระบบจะถามยืนยัน 1 ครั้งและบันทึกการแก้ไว้`,
    });
  }
  return out;
}

/** ใช้แสดงแถบเตือนเท่านั้น — การตัดสินข้ามทีมจริงอยู่ที่ RPC customer_contact_is_cross_team */
export function isCrossTeamLocal(customerTeams: readonly string[], myTeam: string | null): boolean {
  return customerTeams.length > 0 && (myTeam === null || !customerTeams.includes(myTeam));
}

// ───────────────────────── สถานี: ต้องดู / กรอง ─────────────────────────

export interface StationFilter {
  attn: boolean;
  contractId: string;
  type: StationType | "all";
  status: StationStatus | "all";
  q: string;
}

export const TYPE_ORDER: Record<StationType, number> = { AG: 0, IG: 1, IC: 2 };

export function prevMonth(month: string): string {
  return addMonths(month, -1);
}

/** found = พบปลวก: IG/IC มีกลุ่มปลวก · AG มีสัดส่วนปลวก (รวมปลวกตาย) — เฉพาะผลตรวจที่ตรวจแล้ว */
export function isFoundCheck(type: StationType, c: Pick<CheckRow, "checked" | "caste" | "termiteGroup">): boolean {
  if (!c.checked) return false;
  return type === "AG" ? c.caste !== null : c.termiteGroup !== null;
}

/** "ต้องดู" = AG ที่ยังไม่จบ + IG/IC ที่พบปลวกเดือนนี้/เดือนก่อน + สถานีหาย/ถอนออก */
export function isAttention(
  s: StationRow,
  foundMonths: ReadonlySet<string> | undefined,
  currentMonth: string,
): boolean {
  if (s.status === "lost" || s.status === "withdrawn") return true;
  if (s.type === "AG") return s.status === "active" || s.status === "pending_removal";
  if (s.status !== "active" || !foundMonths) return false;
  const from = prevMonth(currentMonth);
  for (const m of foundMonths) if (m >= from) return true;
  return false;
}

export function filterStations(
  stations: readonly StationRow[],
  f: StationFilter,
  foundByStation: ReadonlyMap<string, ReadonlySet<string>>,
  currentMonth: string,
): StationRow[] {
  const q = f.q.trim().toLowerCase();
  return stations
    .filter(
      (s) =>
        (!f.attn || isAttention(s, foundByStation.get(s.id), currentMonth)) &&
        (f.contractId === "all" || s.contractId === f.contractId) &&
        (f.type === "all" || s.type === f.type) &&
        (f.status === "all" || s.status === f.status) &&
        (!q || s.code.toLowerCase().includes(q)),
    )
    .sort((a, b) => {
      if (a.contractId !== b.contractId) return a.contractId < b.contractId ? 1 : -1;
      if (a.type !== b.type) return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
      return (a.no ?? 0) - (b.no ?? 0) || a.code.localeCompare(b.code);
    });
}

/** ผลตรวจของสถานีเรียงตามวันที่เข้า (เก่า→ใหม่) พร้อมลำดับ "ครั้งที่" สำหรับ IG/IC */
export interface StationCheckLine {
  check: CheckRow;
  date: string;
  visitType: VisitType;
  /** F ของ AG (follow_up_no จากฐานข้อมูล) · IG/IC = ลำดับครั้งที่พบ */
  no: number;
}

export function checkLinesByStation(
  stations: readonly StationRow[],
  checks: readonly CheckRow[],
  visits: readonly VisitRow[],
): Map<string, StationCheckLine[]> {
  const visitById = new Map(visits.map((v) => [v.id, v]));
  const typeById = new Map(stations.map((s) => [s.id, s.type]));
  const by = new Map<string, StationCheckLine[]>();
  for (const c of checks) {
    const v = visitById.get(c.visitId);
    const t = typeById.get(c.stationId);
    if (!v || !t || !isFoundCheck(t, c)) continue;
    const arr = by.get(c.stationId) ?? [];
    arr.push({ check: c, date: v.date, visitType: v.type, no: 0 });
    by.set(c.stationId, arr);
  }
  for (const [id, arr] of by) {
    arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const isAg = typeById.get(id) === "AG";
    arr.forEach((l, i) => {
      l.no = isAg && l.check.followUpNo ? l.check.followUpNo : i + 1;
    });
  }
  return by;
}

// ───────────────────────── กราฟภาพรวม ─────────────────────────

export interface DashFilter {
  ext: boolean;
  ag: boolean;
  timber: boolean;
}

export interface DashMonth {
  month: string;
  state: MonthState;
  ig: number;
  ic: number;
  ag: number;
  ext: number;
  t: number;
  igL: string[];
  icL: string[];
  agL: string[];
  tL: string[];
}

/**
 * สรุปรายเดือนบริการของ 1 สัญญา — นับ "จุด" = สถานีไม่ซ้ำต่อเดือน
 * พบปลวกจาก station_checks · เปลี่ยนไม้จาก v_contract_monthly_timber (ฐานข้อมูลสรุปให้แล้ว ≤ 36 แถวต่อสัญญา)
 */
export function termiteByMonth(args: {
  contract: ContractRow;
  stations: readonly StationRow[];
  checks: readonly CheckRow[];
  visits: readonly VisitRow[];
  timber: readonly TimberMonth[];
  currentMonth: string;
}): DashMonth[] {
  const { contract: k } = args;
  const stById = new Map(args.stations.filter((s) => s.contractId === k.id).map((s) => [s.id, s]));
  const visitDate = new Map(args.visits.filter((v) => v.contractId === k.id).map((v) => [v.id, v.date]));
  const found = new Map<string, { IG: Set<string>; IC: Set<string>; AG: Set<string> }>();
  const slot = (m: string) => {
    let o = found.get(m);
    if (!o) {
      o = { IG: new Set(), IC: new Set(), AG: new Set() };
      found.set(m, o);
    }
    return o;
  };
  for (const c of args.checks) {
    const s = stById.get(c.stationId);
    const d = visitDate.get(c.visitId);
    if (!s || !d || !isFoundCheck(s.type, c)) continue;
    slot(monthOf(d))[s.type].add(s.code);
  }
  const tByMonth = new Map(args.timber.filter((t) => t.contractId === k.id).map((t) => [monthOf(t.month), t]));
  const states = new Map(monthStates(k, args.visits, args.currentMonth).map((x) => [x.month, x.state]));
  const sortCodes = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return serviceMonthsForTerm(k.startDate, k.termMonths).map((month) => {
    const o = found.get(month);
    const tm = tByMonth.get(month);
    const igL = o ? sortCodes(o.IG) : [];
    const icL = o ? sortCodes(o.IC) : [];
    const agL = o ? sortCodes(o.AG) : [];
    const tL = tm ? [...tm.igNos.map((n) => `IG-${n}`), ...tm.icNos.map((n) => `IC-${n}`)] : [];
    return {
      month,
      state: states.get(month) ?? "fut",
      ig: igL.length,
      ic: icL.length,
      ag: agL.length,
      ext: igL.length + icL.length,
      t: tL.length,
      igL,
      icL,
      agL,
      tL,
    };
  });
}

export function dashPoints(r: DashMonth, f: DashFilter): number {
  return (f.ext ? r.ext : 0) + (f.ag ? r.ag : 0);
}

export function dashHasFind(f: DashFilter): boolean {
  return f.ext || f.ag;
}

/** ช่วงเดือนที่ดู: from/to = null → เริ่มสัญญา … เดือนปัจจุบัน · '' (to) = ทั้งสัญญา · สลับให้ถ้าเลือกกลับด้าน */
export function dashRange(
  all: readonly DashMonth[],
  from: string | null,
  to: string | null,
): { rows: DashMonth[]; from: string; to: string; full: boolean; toNow: boolean } {
  const ms = all.map((r) => r.month);
  const last = ms[ms.length - 1] ?? "";
  let nowIdx = -1;
  all.forEach((r, i) => {
    if (r.state !== "fut") nowIdx = i;
  });
  const nowM = nowIdx >= 0 ? (ms[nowIdx] as string) : (ms[0] ?? "");
  let a = from !== null && ms.includes(from) ? from : (ms[0] ?? "");
  let b = to === null ? nowM : ms.includes(to) ? to : last;
  if (a > b) [a, b] = [b, a];
  return { rows: all.filter((r) => r.month >= a && r.month <= b), from: a, to: b, full: a === ms[0] && b === last, toNow: a === ms[0] && b === nowM };
}

export function dashHeadline(rows: readonly DashMonth[], f: DashFilter): string {
  const past = rows.filter((r) => r.state !== "fut");
  if (!past.length) return "ยังไม่มีเดือนที่ผ่านมา";
  if (dashHasFind(f)) {
    const fm = past.filter((r) => dashPoints(r, f) > 0);
    if (!fm.length) return `ไม่พบปลวกในทุก ${past.length} เดือนที่ผ่านมา`;
    const mx = Math.max(...fm.map((r) => dashPoints(r, f)));
    const tops = fm.filter((r) => dashPoints(r, f) === mx).map((r) => monthShortTh(r.month));
    return `พบปลวก ${fm.length} จาก ${past.length} เดือน · สูงสุด ${tops.join(", ")} (${mx} จุด)`;
  }
  const tot = past.reduce((a, r) => a + r.t, 0);
  return `เปลี่ยนไม้เฉลี่ย ${(tot / past.length).toFixed(1)} จุด/เดือน`;
}

/** สถานีที่เคยพบปลวก/เปลี่ยนไม้ในช่วง (นับสถานีละ 1 ครั้งทั้งช่วง) */
export function dashDistinctStations(rows: readonly DashMonth[], f: DashFilter): number {
  const seen = new Set<string>();
  for (const r of rows) {
    if (dashHasFind(f)) {
      if (f.ext) [...r.igL, ...r.icL].forEach((c) => seen.add(c));
      if (f.ag) r.agL.forEach((c) => seen.add(c));
    } else r.tL.forEach((c) => seen.add(c));
  }
  return seen.size;
}

export function daNiceMax(v: number, step: number): number {
  return Math.max(step * 2, Math.ceil(v / step) * step);
}

// ───────────────────────── ข้อมูลติดต่อ ─────────────────────────

export const CONTACT_NAME_MAX = 80;
export const NOTE_MAX = 300;
export const PHONE_LABEL_MAX = 40;
const PHONE_RE = /^[0-9+() ,/.-]{8,40}$/;

export function validateContactName(v: string): string | null {
  const t = v.trim();
  if (!t) return "กรุณากรอกชื่อผู้ติดต่อ";
  if (t.length > CONTACT_NAME_MAX) return `ชื่อผู้ติดต่อยาวเกิน ${CONTACT_NAME_MAX} ตัวอักษร`;
  return null;
}

export function validateNote(v: string): string | null {
  return v.trim().length > NOTE_MAX ? `หมายเหตุยาวเกิน ${NOTE_MAX} ตัวอักษร` : null;
}

export const digitsOf = (s: string): string => s.replace(/\D/g, "");

/** ตรวจเบอร์ที่เพิ่ม/แก้ — `editingId` = id ของเบอร์ที่กำลังแก้ (ไม่นับว่าซ้ำกับตัวเอง) */
export function validatePhone(phone: string, label: string, others: readonly Pick<PhoneRow, "id" | "phone">[], editingId: string | null): string | null {
  const p = phone.trim();
  if (!PHONE_RE.test(p) || !/[0-9]/.test(p)) return "เบอร์โทรไม่ถูกต้อง — ใช้ตัวเลข เว้นวรรค - + ( ) ได้ อย่างน้อย 8 ตัว";
  if (label.trim().length > PHONE_LABEL_MAX) return `ชื่อ/หน้าที่ของเบอร์ยาวเกิน ${PHONE_LABEL_MAX} ตัวอักษร`;
  if (others.some((o) => o.id !== editingId && digitsOf(o.phone) === digitsOf(p))) return "มีเบอร์นี้อยู่แล้ว";
  return null;
}

export type ContactEdit =
  | { field: "contact"; value: string }
  | { field: "note"; value: string }
  | { field: "phone"; id: string | null; phone: string; label: string };

/** สร้าง payload ของ save_customer_contact จากการแก้ 1 ช่อง — null = ไม่มีอะไรเปลี่ยน (ไม่ต้องเรียก RPC) */
export function buildContactPayload(
  customerId: string,
  edit: ContactEdit,
  current: { contactName: string | null; note: string | null; phones: readonly PhoneRow[] },
  confirmCrossTeam: boolean,
): Record<string, unknown> | null {
  const base: Record<string, unknown> = { customer_id: customerId, ...(confirmCrossTeam ? { confirm_cross_team: true } : {}) };
  if (edit.field === "contact") {
    return edit.value.trim() === (current.contactName ?? "") ? null : { ...base, contact_name: edit.value.trim() };
  }
  if (edit.field === "note") {
    return edit.value.trim() === (current.note ?? "") ? null : { ...base, note: edit.value.trim() };
  }
  const phone = edit.phone.trim();
  const label = edit.label.trim();
  if (edit.id) {
    const old = current.phones.find((p) => p.id === edit.id);
    if (old && old.phone === phone && (old.label ?? "") === label) return null;
    return { ...base, phones_upsert: [{ id: edit.id, phone, label: label || null, sort_order: old?.sortOrder }] };
  }
  return { ...base, phones_upsert: [{ phone, label: label || null }] };
}

export function buildPhoneDeletePayload(customerId: string, phoneId: string, confirmCrossTeam: boolean): Record<string, unknown> {
  return { customer_id: customerId, phones_delete: [phoneId], ...(confirmCrossTeam ? { confirm_cross_team: true } : {}) };
}

export interface ContactErrorInfo {
  message: string;
  /** CC001: ต้องยืนยันก่อน (ลูกค้าทีมอื่น) */
  needsCrossTeamConfirm: boolean;
  teamCodes: string[];
  isBug: boolean;
}

/** แปล error ของ save_customer_contact เป็นไทย · log เฉพาะ code (ผู้เรียก) — ไม่ log details/payload */
export function describeContactError(error: DbErrorLike): ContactErrorInfo {
  const code = error.code ?? "";
  if (code === "CC001") {
    let teams: string[] = [];
    try {
      const parsed = JSON.parse(error.details ?? "{}") as { team_codes?: unknown };
      if (Array.isArray(parsed.team_codes)) teams = parsed.team_codes.filter((x): x is string => typeof x === "string");
    } catch {
      teams = [];
    }
    return { message: "ลูกค้ารายนี้เป็นของทีมอื่น — ยืนยันก่อนแก้ข้อมูลติดต่อ", needsCrossTeamConfirm: true, teamCodes: teams, isBug: false };
  }
  const known: Record<string, string> = {
    CC002: error.message ?? "ข้อมูลไม่ถูกต้อง",
    CC003: "มีเบอร์นี้อยู่แล้ว",
    CC004: "ลบเบอร์สุดท้ายไม่ได้ — ลูกค้าต้องมีเบอร์โทรอย่างน้อย 1 เบอร์",
    AG004: "ไม่พบลูกค้าหรือเบอร์นี้ (อาจถูกลบไปแล้ว) รีเฟรชหน้า",
    "42501": "ไม่มีสิทธิ์แก้ข้อมูลติดต่อของลูกค้ารายนี้",
  };
  const msg = known[code];
  if (msg) return { message: msg, needsCrossTeamConfirm: false, teamCodes: [], isBug: false };
  return {
    message: "บันทึกไม่สำเร็จ ลองอีกครั้ง หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ",
    needsCrossTeamConfirm: false,
    teamCodes: [],
    isBug: true,
  };
}

// ───────────────────────── ไฟล์แนบ ─────────────────────────

export function filesOfContract(files: readonly FileRow[], contractId: string): { pdf: FileRow | null; sitePlans: FileRow[] } {
  const mine = files.filter((f) => f.contractId === contractId);
  return {
    pdf: mine.find((f) => f.kind === "contract_pdf") ?? null,
    sitePlans: mine.filter((f) => f.kind === "site_plan").sort((a, b) => a.version - b.version),
  };
}

export function fmtSizeMb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

// ───────────────────────── ไทม์ไลน์ ─────────────────────────

const AUDIT_TABLE_LABEL: Record<string, string> = {
  customers: "ลูกค้า",
  customer_phones: "เบอร์โทรลูกค้า",
  contracts: "สัญญา",
  contract_teams: "ทีมของสัญญา",
  contract_files: "ไฟล์แนบ",
  stations: "สถานี",
  visits: "ผลบริการ",
  station_checks: "ผลบริการ",
  missed_service_resolutions: "ตกบริการ",
  missed_service_notes: "หมายเหตุตกบริการ",
};

const AUDIT_FIELD_LABEL: Record<string, string> = {
  name: "ชื่อ",
  address: "ที่อยู่",
  phone: "เบอร์โทร",
  label: "ชื่อ/หน้าที่ของเบอร์",
  contact_name: "ผู้ติดต่อ",
  note: "หมายเหตุ",
  customer_type: "ประเภทลูกค้า",
  start_date: "วันเริ่ม",
  end_date: "วันสิ้นสุด",
  term_months: "ระยะสัญญา",
  value_total: "มูลค่า",
  status: "สถานะ",
  sale_type: "New/Renew",
  visit_date: "วันที่เข้า",
  visit_type: "ประเภทการเข้า",
  bait_added_g: "ปริมาณเหยื่อ",
  termite_caste: "สัดส่วนปลวก",
  termite_group: "ชนิดปลวก",
  timber_replaced: "เปลี่ยนไม้",
  checked: "ตรวจแล้ว",
  kind: "ผลตัดสิน",
  reason: "เหตุผล",
};

export function auditTableLabel(table: string): string {
  return AUDIT_TABLE_LABEL[table] ?? table;
}

export function auditFieldLabel(field: string): string {
  return AUDIT_FIELD_LABEL[field] ?? field;
}

/** ชื่อช่องที่ต่างกัน (ไม่เก็บค่า) — ข้ามช่องที่ระบบตั้งเอง */
const AUDIT_IGNORED = new Set(["updated_at", "created_at", "contact_updated_at", "contact_updated_by", "contact_cross_team", "id"]);

export function changedFieldNames(oldData: Record<string, unknown> | null, newData: Record<string, unknown> | null): string[] {
  if (!oldData || !newData) return [];
  return Object.keys(newData).filter((k) => !AUDIT_IGNORED.has(k) && JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]));
}

export function describeAudit(e: { tableName: string; action: "insert" | "update" | "delete"; changedFields: readonly string[] }): string {
  const t = auditTableLabel(e.tableName);
  if (e.action === "insert") return `เพิ่ม${t}`;
  if (e.action === "delete") return `ลบ${t}`;
  const f = e.changedFields.map(auditFieldLabel);
  return f.length ? `แก้${t}: ${f.join(", ")}` : `แก้${t}`;
}

// ───────────────────────── จัดกลุ่ม/หน้า ─────────────────────────

export function paginate<T>(rows: readonly T[], page: number, size: number): { slice: T[]; pages: number; page: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { slice: rows.slice((p - 1) * size, p * size), pages, page: p };
}

/** ทีมที่เข้าล่าสุด (visit ล่าสุดที่มีทีม) */
export function latestVisit(visits: readonly VisitRow[]): VisitRow | null {
  return [...visits].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0] ?? null;
}

/** เบอร์โทรเรียงตาม sort_order */
export function sortPhones(phones: readonly PhoneRow[]): PhoneRow[] {
  return [...phones].sort((a, b) => a.sortOrder - b.sortOrder);
}
