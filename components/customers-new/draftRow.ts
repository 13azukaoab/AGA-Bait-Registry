/**
 * แถวที่กำลังกรอก: สร้างแถวเปล่า, ตรวจข้อมูล, สรุปสถานะ
 *
 * Logic summary:
 *   * ช่องจำเป็น (ขาด = บันทึกไม่ได้ · แถวแดง): เลขที่สัญญา (รูปแบบถูก ไม่ซ้ำ) · ชื่อลูกค้า ·
 *     สาขา (ต้องอยู่ใน master) · วันเริ่ม · มูลค่า (กรอกช่อง 1 ปี หรือ 3 ปี อย่างใดอย่างหนึ่ง) · ผู้ขาย
 *   * คำเตือน (ไม่บล็อก): วันสิ้นสุดไม่ตรงระยะสัญญา · ยังไม่แนบไฟล์
 *   * ระยะสัญญา (term) = มาจากช่องมูลค่าที่กรอก (ช่อง 1 ปี → 1, ช่อง 3 ปี → 3) ตาม mockup
 *   * ช่องที่ schema ยังไม่มี (เบิกด่วน/ลูกค้าเดิม/ตำแหน่งผู้ขาย/วันที่รับ Mail/วันที่-เวลาบริการ/หมายเหตุ)
 *     จะเพิ่มที่นี่เมื่อ migration เข้า main — ดู `PENDING_SCHEMA_FIELDS` ใน `columns.ts`
 */
import type { TermYears } from "@/lib/rules";

import { resolveBranch, type BranchOption } from "./branchMatch";
import { normalizeContractNo } from "./contractNo";
import { endDateWarning, isPlausibleDate, parseMoney } from "./rowCalc";
import type { DraftRow } from "./types";

export type DraftField =
  | "contractNo"
  | "customerName"
  | "saleName"
  | "branch"
  | "startDate"
  | "endDate"
  | "mailDate"
  | "serviceDate"
  | "value";

export interface DraftCheck {
  /** ช่องที่ผิด → ข้อความไทย (มีรายการ = บันทึกแถวนี้ไม่ได้) */
  errors: Partial<Record<DraftField, string>>;
  /** คำเตือนที่ไม่บล็อกการบันทึก */
  warnings: string[];
  /** ค่าที่แปลงแล้ว (เฉพาะส่วนที่ถูกต้อง) */
  branch: BranchOption | null;
  termYears: TermYears | null;
  valueTotal: number | null;
  /** วันสิ้นสุดที่ใช้บันทึกจริง (ว่าง = null) */
  endDate: string | null;
  /** ยังไม่นัดบริการ (ไม่มีวันที่บริการ) = "รอนัดบริการ" */
  pendingService: boolean;
}

/** เวลานัดบริการที่เลือกได้: 08:00–17:30 นาที 00/30 (ตาม mockup — time picker 24 ชม.) */
export const SERVICE_TIME_SLOTS: readonly string[] = Array.from({ length: 20 }, (_, i) => {
  const h = 8 + Math.floor(i / 2);
  return `${String(h).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}`;
});

let counter = 0;
/** key ชั่วคราวของแถว (ไม่ใช่ id ในฐานข้อมูล) */
export function newRowKey(): string {
  counter += 1;
  return `draft-${Date.now().toString(36)}-${counter}`;
}

export function createDraft(): DraftRow {
  return {
    key: newRowKey(),
    contractNo: "",
    customerName: "",
    saleType: "new",
    sellerRole: "sale",
    saleName: "",
    isUrgent: false,
    renewal: null,
    mailReceivedDate: "",
    firstServiceDate: "",
    firstServiceTime: "",
    note: "",
    branchText: "",
    customerTypeCode: "",
    teamIds: [],
    startDate: "",
    endDate: "",
    endTouched: false,
    value1y: "",
    value3y: "",
    pendingPdf: null,
    saveError: null,
  };
}

/** ระยะสัญญาจากช่องมูลค่าที่กรอก: มีทั้งสองช่อง/ไม่มีเลย = null */
export function termFromValues(value1y: string, value3y: string): TermYears | null {
  const has1 = value1y.trim() !== "";
  const has3 = value3y.trim() !== "";
  if (has1 === has3) return null;
  return has1 ? 1 : 3;
}

export function checkDraft(
  draft: DraftRow,
  branches: readonly BranchOption[],
  /** ข้อความ error ของเลขที่สัญญาจาก `checkContractNos` (ซ้ำ/รูปแบบ) ถ้ามี */
  contractNoError: string | undefined,
): DraftCheck {
  const errors: Partial<Record<DraftField, string>> = {};
  const warnings: string[] = [];

  const no = normalizeContractNo(draft.contractNo);
  if (!no) errors.contractNo = "ใส่เลขที่สัญญา";
  else if (contractNoError) errors.contractNo = contractNoError;

  if (!draft.customerName.trim()) errors.customerName = "ใส่ชื่อลูกค้า";
  if (!draft.saleName.trim()) errors.saleName = "ใส่ชื่อผู้ขาย";

  const branch = resolveBranch(draft.branchText, branches);
  if (!draft.branchText.trim()) errors.branch = "เลือกสาขา";
  else if (!branch) errors.branch = "ไม่พบสาขานี้ในรายการ — เลือกจากที่ระบบเดาให้";

  if (!draft.startDate) errors.startDate = "ใส่วันเริ่มสัญญา";
  else if (!isPlausibleDate(draft.startDate)) errors.startDate = "วันเริ่มสัญญาไม่ถูกต้อง";

  const termYears = termFromValues(draft.value1y, draft.value3y);
  const raw = termYears === 1 ? draft.value1y : termYears === 3 ? draft.value3y : "";
  const valueTotal = termYears ? parseMoney(raw) : null;
  if (termYears === null) {
    errors.value =
      draft.value1y.trim() !== "" && draft.value3y.trim() !== ""
        ? "กรอกมูลค่าได้ช่องเดียว (1 ปี หรือ 3 ปี)"
        : "ใส่มูลค่าสัญญา";
  } else if (valueTotal === null) {
    errors.value = "มูลค่าต้องเป็นตัวเลขมากกว่า 0";
  }

  let endDate: string | null = null;
  if (draft.endDate) {
    endDate = draft.endDate;
    if (termYears) {
      const w = endDateWarning(draft.startDate, draft.endDate, termYears);
      if (w) warnings.push(w);
    }
  }
  if (draft.endDate && !isPlausibleDate(draft.endDate)) {
    errors.endDate = "วันสิ้นสุดไม่ถูกต้อง";
  }
  if (draft.mailReceivedDate && !isPlausibleDate(draft.mailReceivedDate)) {
    errors.mailDate = "วันที่รับ Mail ไม่ถูกต้อง";
  }
  if (draft.firstServiceDate && !isPlausibleDate(draft.firstServiceDate)) {
    errors.serviceDate = "วันที่บริการไม่ถูกต้อง";
  } else if (draft.firstServiceTime && !draft.firstServiceDate) {
    // ตรงกับ constraint ของ DB: มีเวลาต้องมีวันที่
    errors.serviceDate = "เลือกวันที่บริการก่อนใส่เวลา";
  }
  if (draft.saleType === "renew" && !draft.renewal) {
    warnings.push("Renew ยังไม่ผูกลูกค้าเดิม");
  }
  if (!draft.pendingPdf) warnings.push("ยังไม่แนบไฟล์สัญญา + Site plan");

  return {
    errors,
    warnings,
    branch,
    termYears,
    valueTotal,
    endDate,
    pendingService: !draft.firstServiceDate,
  };
}

/** แถวนี้บันทึกได้ไหม (ไม่มี error) */
export function canSave(check: DraftCheck): boolean {
  return Object.keys(check.errors).length === 0;
}

/** ข้อความ "ขาด …" ของแถวที่ข้อมูลไม่ครบ (ไว้แสดงในช่องสถานะ) */
export function missingLabel(check: DraftCheck): string {
  const names: Record<DraftField, string> = {
    contractNo: "เลขที่สัญญา",
    customerName: "ชื่อลูกค้า",
    saleName: "ผู้ขาย",
    branch: "สาขา",
    startDate: "วันเริ่ม",
    endDate: "วันสิ้นสุด",
    mailDate: "วันที่รับ Mail",
    serviceDate: "วันที่บริการ",
    value: "มูลค่า",
  };
  const missing = (Object.keys(check.errors) as DraftField[]).map((f) => names[f]);
  return missing.length ? `ขาด ${missing.join(" · ")}` : "";
}
