/**
 * แผนเติม "วันที่รับ Mail / วันนัดบริการครั้งแรก / เวลา" ให้สัญญานำเข้าทะเบียนจากไฟล์เปิดงาน — pure function ไม่แตะฐานข้อมูล
 * (ดัชนีไฟล์เปิดงาน: jobOpeningServiceDates.ts · ชั้นอ่าน/เขียน DB: jobOpeningBackfillDb.ts · สคริปต์: scripts/backfill-job-opening-dates.ts)
 *
 * Logic summary:
 *   1. เป้าหมาย (BackfillTarget) = สัญญา 1 ฉบับ + ค่าปัจจุบันของ 3 ช่อง
 *      - โหมดไฟล์ (ไม่ต่อ DB): สร้างจากแผนนำเข้าทะเบียน (targetsFromPlan · ตัวนำเข้าไม่เคยเขียน 3 ช่องนี้ → ค่าปัจจุบัน = ว่าง)
 *      - โหมด DB: อ่านจาก contracts จริง (ค่าปัจจุบันจริง · import_batch / status จริง)
 *   2. จับคู่ด้วยเลขสัญญาที่ล้างแล้ว (normalizeContractNo ตัวเดียวกับตัวนำเข้า)
 *   3. เติมเฉพาะสัญญาที่ import_batch อยู่ใน fillBatches (ค่าเริ่ม registry-OCT26) · สัญญาที่เปิดในแอป (import_batch ว่าง)
 *      หรือ batch อื่น = ไม่แตะ (นับแยก) · สถานะใน skipStatuses (ค่าเริ่ม closed / cancelled) = ไม่แตะ (นับแยก)
 *   4. เติมเฉพาะช่องที่ "ว่าง" — มีค่าอยู่แล้ว (เท่ากัน/ต่างกัน) = ไม่ทับ (นับแยก ต่างกัน = รายงานเลขสัญญา)
 *      ค่าจากไฟล์ที่ conflict (หลายแถวค่าต่างกัน) หรืออ่านไม่ได้ = ไม่เติมช่องนั้น
 *   5. เวลา (มีเวลาต้องมีวันที่ · CHECK contracts_first_service_time_needs_date):
 *      เติมเวลาได้เมื่อวันที่บริการหลังเติม = วันที่บริการในไฟล์ (เติมพร้อมกัน หรือ DB มีวันเดียวกันอยู่แล้ว)
 *      DB มีวันที่อื่น → ไม่เติมเวลา (dateMismatch) · ไม่มีวันที่เลย → ไม่เติม (noDate)
 *   6. ค่าที่ดูแปลกแต่เป็นไปได้ (เตือน · เติมตามปกติ เว้นแต่ skipWarned): วันรับ Mail หลังวันบริการ ·
 *      วันบริการก่อนวันเริ่มสัญญา · วันบริการหลังวันสิ้นสุด · วันที่ที่จะเติมเลยวันนี้ (asOf) → รายงานเลขสัญญา
 *   7. ผลกระทบ Dashboard งานขาย (2.91 / 2.101): สัญญานำเข้าที่ไม่มีวันรับ Mail ถูกนับตามเดือนวันเริ่มสัญญา ·
 *      เติมวันรับ Mail แล้วย้ายไปนับตามเดือนวันรับ Mail + Renew ที่วันรับ Mail > 15 กลายเป็น "ต่อสัญญาล่าช้า" → นับไว้รายงาน
 *   ⚠ ผลลัพธ์มีแค่ id / เลขสัญญา / วันที่ / ตัวเลข — ไม่มีชื่อ/เบอร์/ที่อยู่ลูกค้า (PDPA)
 */
import { isLateRenewal } from "../rules/lateRenewal";
import { normalizeBranch } from "./branches";
import { normalizeContractNo } from "./fields";
import type { JobEntry, JobField, JobOpeningIndex } from "./jobOpeningServiceDates";
import type { RegistryImportPlan } from "./registryImportPlan";

export type DbField = "mail_received_date" | "first_service_date" | "first_service_time";

export const DB_FIELD: Record<JobField, DbField> = {
  mail: "mail_received_date",
  service: "first_service_date",
  time: "first_service_time",
};

export const DEFAULT_SKIP_STATUSES: readonly string[] = ["closed", "cancelled"];

export interface BackfillTarget {
  /** contracts.id · null = เป้าหมายจากแผนในไฟล์ (โหมดไม่ต่อ DB) */
  id: string | null;
  contractNo: string;
  importBatch: string | null;
  status: string;
  startDate: string;
  endDate: string;
  saleType: string | null;
  /** ค่าปัจจุบัน ('YYYY-MM-DD' / 'HH:MM') · null = ว่าง */
  mail: string | null;
  serviceDate: string | null;
  serviceTime: string | null;
}

export interface BackfillOptions {
  /** import_batch ที่ยอมให้เติม (ค่าอื่น/ว่าง = ไม่แตะ) */
  fillBatches: readonly string[];
  /** สถานะที่ไม่แตะ (ค่าเริ่ม DEFAULT_SKIP_STATUSES) */
  skipStatuses?: readonly string[];
  /** true = สัญญาที่มีคำเตือน (ข้อ 6) ไม่เติมเลย */
  skipWarned?: boolean;
  /** วันที่ 'YYYY-MM-DD' ที่ถือเป็น "วันนี้" — วันที่ในไฟล์ที่เลยวันนี้ = เตือน futureDate · ไม่ส่ง = ไม่ตรวจ */
  asOf?: string;
}

export interface BackfillUpdate {
  id: string | null;
  contractNo: string;
  /** ช่องที่จะเติม → ค่า */
  set: Partial<Record<DbField, string>>;
  /** เติมเวลาอย่างเดียว: ต้องมี first_service_date เท่านี้อยู่แล้วตอนเขียน (กันวันที่ถูกแก้ระหว่างนั้น) */
  requireServiceDate?: string;
}

type PerField = Record<JobField, number>;
const zero = (): PerField => ({ mail: 0, service: 0, time: 0 });

export interface BackfillPlan {
  updates: BackfillUpdate[];
  counts: {
    /** เลขสัญญาในไฟล์เปิดงาน (ไม่ซ้ำ) */
    jobContracts: number;
    /** เป้าหมายทั้งหมดที่ส่งมา */
    targets: number;
    /** เลขสัญญาในไฟล์ที่เจอเป้าหมาย */
    matched: number;
    /** จับคู่ได้และอยู่ใน fillBatches + สถานะไม่ถูกข้าม */
    eligible: number;
    /** สัญญาที่จะถูกแก้อย่างน้อย 1 ช่อง */
    contractsToUpdate: number;
    fills: PerField;
    alreadySame: PerField;
    alreadyDifferent: PerField;
    /** ไฟล์มีหลายค่าที่ต่างกัน */
    conflict: PerField;
    /** ไฟล์มีแต่ค่าที่อ่านไม่ได้ (ปัญหา) */
    problemOnly: PerField;
    /** ไฟล์ว่าง */
    noValue: PerField;
    timeNoDate: number;
    timeDateMismatch: number;
    /** จับคู่ได้แต่ batch ไม่อยู่ใน fillBatches (key = batch · "" = เปิดในแอป) */
    otherBatch: Record<string, number>;
    /** จับคู่ได้แต่สถานะถูกข้าม (key = status) */
    skippedStatus: Record<string, number>;
    /** สัญญาที่ไม่เติมเพราะมีคำเตือน (skipWarned) */
    skippedWarned: number;
  };
  /** คำเตือน (ข้อ 6) — เลขสัญญา */
  warnings: {
    mailAfterService: string[];
    serviceBeforeStart: string[];
    serviceAfterEnd: string[];
    /** วันรับ Mail หรือวันบริการที่จะเติม เลยวันนี้ (asOf) — น่าจะพิมพ์ปีผิด */
    futureDate: string[];
  };
  /** มีค่าอยู่แล้วแต่ไม่ตรงไฟล์ — เลขสัญญาต่อช่อง */
  differentContractNos: Record<JobField, string[]>;
  /** ที่จะเติม แยกตามเดือนวันเริ่มสัญญา 'YYYY-MM' */
  fillsByStartMonth: Record<string, PerField>;
  /** เป้าหมายทั้งหมดใน fillBatches — แยกตามเดือนวันเริ่มสัญญา (ตัวหารของ fillsByStartMonth) */
  targetsByStartMonth: Record<string, number>;
  /** เป้าหมายใน fillBatches ที่ไม่มีแถวในไฟล์เปิดงาน — แยกตามเดือนวันเริ่มสัญญา */
  targetsWithoutJobByStartMonth: Record<string, number>;
  /** เลขสัญญาในไฟล์ที่ไม่เจอเป้าหมาย */
  jobsWithoutTarget: string[];
  /** ผลกระทบ Dashboard งานขาย (ข้อ 7) — เฉพาะสัญญาที่จะเติมวันรับ Mail */
  salesImpact: {
    /** Renew ที่จะกลายเป็น "ต่อสัญญาล่าช้า" */
    lateRenewals: number;
    /** เดือนวันรับ Mail ≠ เดือนวันเริ่มสัญญา (ยอดย้ายเดือน) */
    monthChanged: number;
    /** สัญญาที่มีประเภทขาย (New/Renew) ต่อเดือน: ออก (เดือนวันเริ่ม) / เข้า (เดือนวันรับ Mail) */
    byMonth: Record<string, { out: number; in: number }>;
  };
}

const monthOf = (iso: string): string => iso.slice(0, 7);

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

/** แผนเติม (ดู Logic summary) */
export function planJobOpeningBackfill(
  index: JobOpeningIndex,
  targets: readonly BackfillTarget[],
  opts: BackfillOptions,
): BackfillPlan {
  const skipStatuses = new Set(opts.skipStatuses ?? DEFAULT_SKIP_STATUSES);
  const fillBatches = new Set(opts.fillBatches);
  const byNo = new Map<string, BackfillTarget>();
  for (const t of targets) {
    const key = normalizeContractNo(t.contractNo).value;
    if (byNo.has(key)) throw new Error(`แผนเติมวันที่: เลขสัญญา ${key} ซ้ำในเป้าหมาย — หยุด`);
    byNo.set(key, t);
  }

  const plan: BackfillPlan = {
    updates: [],
    counts: {
      jobContracts: index.entries.size,
      targets: targets.length,
      matched: 0,
      eligible: 0,
      contractsToUpdate: 0,
      fills: zero(),
      alreadySame: zero(),
      alreadyDifferent: zero(),
      conflict: zero(),
      problemOnly: zero(),
      noValue: zero(),
      timeNoDate: 0,
      timeDateMismatch: 0,
      otherBatch: {},
      skippedStatus: {},
      skippedWarned: 0,
    },
    warnings: { mailAfterService: [], serviceBeforeStart: [], serviceAfterEnd: [], futureDate: [] },
    targetsByStartMonth: {},
    differentContractNos: { mail: [], service: [], time: [] },
    fillsByStartMonth: {},
    targetsWithoutJobByStartMonth: {},
    jobsWithoutTarget: [],
    salesImpact: { lateRenewals: 0, monthChanged: 0, byMonth: {} },
  };
  const c = plan.counts;

  for (const job of index.entries.values()) {
    const t = byNo.get(job.contractNo);
    if (!t) {
      plan.jobsWithoutTarget.push(job.contractNo);
      continue;
    }
    c.matched += 1;
    if (!t.importBatch || !fillBatches.has(t.importBatch)) {
      bump(c.otherBatch, t.importBatch ?? "");
      continue;
    }
    if (skipStatuses.has(t.status)) {
      bump(c.skippedStatus, t.status);
      continue;
    }
    c.eligible += 1;
    planOne(plan, job, t, opts);
  }

  for (const t of targets) {
    if (!t.importBatch || !fillBatches.has(t.importBatch)) continue;
    bump(plan.targetsByStartMonth, monthOf(t.startDate));
    if (!index.entries.has(normalizeContractNo(t.contractNo).value)) bump(plan.targetsWithoutJobByStartMonth, monthOf(t.startDate));
  }
  plan.jobsWithoutTarget.sort();
  return plan;
}

/** ค่าจากไฟล์ที่ใช้ได้ของช่องหนึ่ง + นับเหตุที่ใช้ไม่ได้ */
function usable(plan: BackfillPlan, job: JobEntry, field: JobField): string | null {
  const v = job[field];
  if (v.value !== null) return v.value;
  if (v.conflict) plan.counts.conflict[field] += 1;
  else if (v.hadProblem) plan.counts.problemOnly[field] += 1;
  else plan.counts.noValue[field] += 1;
  return null;
}

function planOne(plan: BackfillPlan, job: JobEntry, t: BackfillTarget, opts: BackfillOptions): void {
  const skipWarned = opts.skipWarned === true;
  const c = plan.counts;
  const set: Partial<Record<DbField, string>> = {};
  const filled: JobField[] = [];

  /** ช่องวันที่: ว่าง = เติม · มีค่า = เทียบ */
  const consider = (field: "mail" | "service", current: string | null): string | null => {
    const value = usable(plan, job, field);
    if (value === null) return null;
    if (current === null) {
      set[DB_FIELD[field]] = value;
      filled.push(field);
    } else if (current === value) c.alreadySame[field] += 1;
    else {
      c.alreadyDifferent[field] += 1;
      plan.differentContractNos[field].push(t.contractNo);
    }
    return value;
  };
  const mail = consider("mail", t.mail);
  const service = consider("service", t.serviceDate);

  // เวลา (ข้อ 5)
  let requireServiceDate: string | undefined;
  const time = usable(plan, job, "time");
  if (time !== null) {
    const dateAfter = t.serviceDate ?? set.first_service_date ?? null;
    if (dateAfter === null) c.timeNoDate += 1;
    else if (dateAfter !== job.service.value) c.timeDateMismatch += 1;
    else if (t.serviceTime === null) {
      set.first_service_time = time;
      filled.push("time");
      if (!set.first_service_date) requireServiceDate = dateAfter;
    } else if (t.serviceTime === time) c.alreadySame.time += 1;
    else {
      c.alreadyDifferent.time += 1;
      plan.differentContractNos.time.push(t.contractNo);
    }
  }

  // คำเตือน (ข้อ 6) — ดูค่าหลังเติม
  const mailAfter = t.mail ?? mail;
  const serviceAfter = t.serviceDate ?? service;
  let warned = false;
  if (filled.length > 0) {
    if (mailAfter && serviceAfter && mailAfter > serviceAfter) {
      plan.warnings.mailAfterService.push(t.contractNo);
      warned = true;
    }
    if (serviceAfter && serviceAfter < t.startDate) {
      plan.warnings.serviceBeforeStart.push(t.contractNo);
      warned = true;
    }
    if (serviceAfter && serviceAfter > t.endDate) {
      plan.warnings.serviceAfterEnd.push(t.contractNo);
      warned = true;
    }
    const asOf = opts.asOf;
    if (asOf && [set.mail_received_date, set.first_service_date].some((d) => d !== undefined && d > asOf)) {
      plan.warnings.futureDate.push(t.contractNo);
      warned = true;
    }
  }
  if (filled.length === 0) return;
  if (warned && skipWarned) {
    c.skippedWarned += 1;
    return;
  }

  c.contractsToUpdate += 1;
  const startMonth = monthOf(t.startDate);
  const perMonth = (plan.fillsByStartMonth[startMonth] ??= zero());
  for (const f of filled) {
    c.fills[f] += 1;
    perMonth[f] += 1;
  }
  if (set.mail_received_date) {
    const mailMonth = monthOf(set.mail_received_date);
    if (isLateRenewal(t.saleType, set.mail_received_date)) plan.salesImpact.lateRenewals += 1;
    if (mailMonth !== startMonth) {
      plan.salesImpact.monthChanged += 1;
      if (t.saleType) {
        (plan.salesImpact.byMonth[startMonth] ??= { out: 0, in: 0 }).out += 1;
        (plan.salesImpact.byMonth[mailMonth] ??= { out: 0, in: 0 }).in += 1;
      }
    }
  }
  plan.updates.push({ id: t.id, contractNo: t.contractNo, set, ...(requireServiceDate ? { requireServiceDate } : {}) });
}

// ---------------------------------------------------------------------
// เป้าหมายจากแผนนำเข้าทะเบียน (โหมดไม่ต่อ DB)
// ---------------------------------------------------------------------

/** แผนนำเข้าทะเบียน → เป้าหมาย (3 ช่องว่างทั้งหมด · ตัวนำเข้าไม่เคยเขียน) */
export function targetsFromPlan(plan: RegistryImportPlan): BackfillTarget[] {
  return plan.branches.flatMap((b) =>
    b.contracts.map(
      (c): BackfillTarget => ({
        id: null,
        contractNo: c.contractNo,
        importBatch: plan.importBatch,
        status: c.status,
        startDate: c.startDate,
        endDate: c.endDate,
        saleType: c.saleType,
        mail: null,
        serviceDate: null,
        serviceTime: null,
      }),
    ),
  );
}

// ---------------------------------------------------------------------
// สาเหตุที่เลขสัญญาในไฟล์เปิดงานไม่เจอในทะเบียน
// ---------------------------------------------------------------------

export type NotFoundReason =
  | "registryManualEntry" // อยู่ในทะเบียนแต่เป็นแถวกรอกมือ (121 แถว · 2.104)
  | "registryHeld" // อยู่ในทะเบียนแต่ถูกกัน (เลขซ้ำข้ามสาขา ง1)
  | "registryExcluded" // อยู่ในทะเบียนแต่อยู่ในรายการตัดสัญญา (2.103)
  | "provincialBranch" // สาขาต่างจังหวัด (ไม่นำเข้าทะเบียน · SPEC §6.5)
  | "groupBranch" // งานกรุ๊ป / ฝ่ายกรุ๊ป
  | "notCentralBranch" // สาขาส่วนกลางที่ไม่อยู่ใน 24 สาขาของทะเบียน
  | "unknownBranch" // อ่านชื่อสาขาไม่ออก / ว่าง
  | "absentFromRegistry"; // สาขาอยู่ใน 24 สาขา แต่ไม่มีเลขนี้ในไฟล์ทะเบียน (เช่น เปิดงานหลังทะเบียน OCT.26)

export interface NotFoundContext {
  /** ชื่อสาขาทั้ง 24 ของทะเบียนส่วนกลาง */
  centralBranches: ReadonlySet<string>;
  /** เลขสัญญาที่อยู่ในไฟล์ทะเบียนแต่ไม่ได้นำเข้า → สาเหตุ */
  registryNotImported: ReadonlyMap<string, "registryManualEntry" | "registryHeld" | "registryExcluded">;
}

export function classifyNotFound(entry: JobEntry, ctx: NotFoundContext): NotFoundReason {
  const reg = ctx.registryNotImported.get(entry.contractNo);
  if (reg) return reg;
  const br = normalizeBranch(entry.branchText);
  if (br.isGroup || /กรุ๊ป/.test(entry.branchText)) return "groupBranch";
  if (!br.branch || br.error) return "unknownBranch";
  if (br.division === "province") return "provincialBranch";
  if (!ctx.centralBranches.has(br.branch)) return "notCentralBranch";
  return "absentFromRegistry";
}

// ---------------------------------------------------------------------
// สรุปสำหรับรายงาน (ตัวเลข + เลขสัญญา/เลขแถวเท่านั้น)
// ---------------------------------------------------------------------

export interface BackfillSummary {
  sheets: JobOpeningIndex["sheets"];
  sheetsSkipped: string[];
  /** ปัญหาค่าในไฟล์ แยกช่อง → ชนิด → จำนวนแถว */
  problems: Record<JobField, Record<string, number>>;
  duplicates: { contracts: number; withConflict: number; conflictByField: PerField };
  /** เลขสัญญาในไฟล์ที่ไม่เจอเป้าหมาย แยกสาเหตุ · และแยกตามชีทที่เจอครั้งแรก */
  notFound: { total: number; byReason: Partial<Record<NotFoundReason, number>>; bySheet: Record<string, Partial<Record<NotFoundReason, number>>> };
  /** แถวที่มีวันที่แต่ช่องเลขสัญญาว่าง/ผิดรูป */
  malformedContractRows: number;
  plan: BackfillPlan["counts"];
  warnings: { mailAfterService: number; serviceBeforeStart: number; serviceAfterEnd: number; futureDate: number };
  targetsByStartMonth: BackfillPlan["targetsByStartMonth"];
  fillsByStartMonth: BackfillPlan["fillsByStartMonth"];
  targetsWithoutJobByStartMonth: BackfillPlan["targetsWithoutJobByStartMonth"];
  salesImpact: BackfillPlan["salesImpact"];
}

export function summarizeBackfill(index: JobOpeningIndex, plan: BackfillPlan, ctx: NotFoundContext): BackfillSummary {
  const problems: BackfillSummary["problems"] = { mail: {}, service: {}, time: {} };
  for (const p of index.problems) bump(problems[p.field], p.kind);
  const conflictByField = zero();
  let withConflict = 0;
  for (const d of index.duplicates) {
    if (d.conflictFields.length > 0) withConflict += 1;
    for (const f of d.conflictFields) conflictByField[f] += 1;
  }
  const byReason: Partial<Record<NotFoundReason, number>> = {};
  const bySheet: Record<string, Partial<Record<NotFoundReason, number>>> = {};
  for (const no of plan.jobsWithoutTarget) {
    const entry = index.entries.get(no)!;
    const reason = classifyNotFound(entry, ctx);
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    const first = entry.occurrences[0]!;
    const sheetKey = `${first.source}:${first.sheet}`;
    const s = (bySheet[sheetKey] ??= {});
    s[reason] = (s[reason] ?? 0) + 1;
  }
  return {
    sheets: index.sheets,
    sheetsSkipped: index.sheetsSkipped.map((s) => `${s.source}:${s.sheet}`),
    problems,
    duplicates: { contracts: index.duplicates.length, withConflict, conflictByField },
    notFound: { total: plan.jobsWithoutTarget.length, byReason, bySheet },
    malformedContractRows: index.sheets.reduce((n, s) => n + s.malformedContractRows.length, 0),
    plan: plan.counts,
    warnings: {
      mailAfterService: plan.warnings.mailAfterService.length,
      serviceBeforeStart: plan.warnings.serviceBeforeStart.length,
      serviceAfterEnd: plan.warnings.serviceAfterEnd.length,
      futureDate: plan.warnings.futureDate.length,
    },
    targetsByStartMonth: plan.targetsByStartMonth,
    fillsByStartMonth: plan.fillsByStartMonth,
    targetsWithoutJobByStartMonth: plan.targetsWithoutJobByStartMonth,
    salesImpact: plan.salesImpact,
  };
}

/** แถวทะเบียน 1 แถว (เลขแถว Excel + ค่าดิบช่องเลขสัญญา) — ไม่มีข้อมูลลูกค้า */
export interface RegistryContractCell {
  excelRow: number;
  rawContractNo: string;
}

/**
 * เลขสัญญาที่อยู่ในไฟล์ทะเบียนแต่ไม่ได้เข้าแผน (กรอกมือ / กันไว้ / ตัดออก) — อ่านเลขจากแถว Excel ของแผน
 * sheets = แถวทั้งหมดของแต่ละสาขา (จาก parseRegistrySheet ของ grid ที่แก้เลขแล้ว)
 */
export function registryNotImportedFromPlan(
  plan: RegistryImportPlan,
  sheets: ReadonlyMap<string, readonly RegistryContractCell[]>,
): Map<string, "registryManualEntry" | "registryHeld" | "registryExcluded"> {
  const out = new Map<string, "registryManualEntry" | "registryHeld" | "registryExcluded">();
  for (const b of plan.branches) {
    const rows = sheets.get(b.branch) ?? [];
    const noAt = (excelRow: number) => {
      const cell = rows.find((r) => r.excelRow === excelRow);
      const ct = cell ? normalizeContractNo(cell.rawContractNo) : null;
      return ct?.isContractNo ? ct.value : null;
    };
    const add = (excelRow: number, reason: "registryManualEntry" | "registryHeld" | "registryExcluded") => {
      const no = noAt(excelRow);
      if (no && !out.has(no)) out.set(no, reason);
    };
    b.mustFixRows.forEach((r) => add(r, "registryManualEntry"));
    b.heldRows.forEach((h) => add(h.excelRow, "registryHeld"));
    b.excludedRows.forEach((x) => add(x.excelRow, "registryExcluded"));
  }
  return out;
}
