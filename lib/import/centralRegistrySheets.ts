/**
 * ตาราง "ไฟล์ทะเบียน → ชีท → สาขา" ของทะเบียนส่วนกลาง OCT.26 (24 สาขา · 8 ไฟล์) — ระบุเองทุกชีท ห้ามเดา
 *
 * Logic summary:
 *   - ทะเบียนส่วนกลาง 1 ไฟล์ = 1 เขต · 1 ชีท = 1 สาขา · ชื่อชีทสะกดไม่ตรง master (เช่น "พระราม4")
 *     → จับคู่ด้วยตารางนี้ (ไม่ใช้การเดาจากช่องว่าง/สะกดคล้าย)
 *   - ชื่อสาขาปลายทางต้องตรง `lib/dashboard/branches.ts` ทุกตัวอักษร (มีเทสบังคับ)
 *   - ชีทที่ไม่อยู่ในตาราง = throw (หยุดทันที) · ชีทที่ตั้งใจข้าม (ลพบุรี = ต่างจังหวัด กรอกตัวเลขมือ SPEC §6.5) = skip พร้อมเหตุผล
 *   - เพิ่มไฟล์/ชีทใหม่ (เช่นเดือนถัดไปเปลี่ยนชื่อไฟล์) → แก้ตารางนี้ที่เดียว
 *   - ไม่มีข้อมูลลูกค้า (มีแค่ชื่อไฟล์/ชื่อชีท/ชื่อสาขา)
 */

/**
 * ตัวเลือกนำเข้าทะเบียนส่วนกลาง (ทั้ง 24 สาขา รวมเขต 1) ตามผลตัดสินเจ้าของ 18 พ.ย. 2026
 * - readDateRangeText (ก1): ช่องวันที่ว่าง → อ่านช่วงวันที่ "วว/ดด/ปปปป-วว/ดด/ปปปป" จากคอลัมน์ข้างซ้าย · รูปอื่น = กรอกมือ
 * - blankCustomerTypeAsOther (ข3): ประเภทลูกค้าว่าง → "อื่นๆ (ระบุในหมายเหตุ)"
 * - flagMalformedContractWithValue (ค1): เลขสัญญาผิดรูป/ว่างแต่มีมูลค่า+วันที่ → ต้องแก้ (ไม่ข้ามเงียบ)
 * - ง1 (เลขสัญญาซ้ำข้ามสาขา → ไม่นำเข้า) ทำผ่าน holdRows จาก findCrossBranchDuplicates (crossBranchDuplicates.ts)
 * ใช้ค่านี้ทั้ง dry-run และขั้นนำเข้าจริง — อย่าเขียนตัวเลือกซ้ำที่อื่น
 */
export const REGISTRY_IMPORT_OPTIONS = {
  readDateRangeText: true,
  blankCustomerTypeAsOther: true,
  flagMalformedContractWithValue: true,
} as const;

/**
 * ค่า contracts.import_batch ของสัญญาที่นำเข้าจากทะเบียน OCT.26 (DECISIONS 2.86 · migration M41 ของ BE)
 * ใช้แยกสัญญานำเข้าออกจากสัญญาที่เปิดในแอป (เช่น ไม่ขึ้นรายการ Renew ไม่ผูกสัญญาเก่า · M28b)
 */
export const REGISTRY_IMPORT_BATCH_OCT26 = "registry-OCT26";

/** ชีทที่ตั้งใจข้าม */
export interface SkipSheet {
  skip: string;
}

export interface RegistryFileSpec {
  /** ชื่อไฟล์ทะเบียน (ไม่ใช่ path) */
  file: string;
  zone: string;
  /** ชื่อชีทตรงตามไฟล์ → ชื่อสาขาใน master หรือ { skip: เหตุผล } */
  sheets: Record<string, string | SkipSheet>;
}

export const SKIP_PROVINCE: SkipSheet = { skip: "ข้ามตาม SPEC §6.5 (สาขาต่างจังหวัด = ตัวเลขกรอกมือ)" };

export const CENTRAL_REGISTRY_FILES_OCT26: readonly RegistryFileSpec[] = [
  {
    file: "OCT.26_เขต 1 ปี 2026 (พุทธมณฑล, นครปฐม, หัวหิน).xlsx",
    zone: "เขต 1",
    sheets: { พุทธมณฑล: "พุทธมณฑล", นครปฐม: "นครปฐม", หัวหิน: "หัวหิน" },
  },
  {
    file: "OCT.26_เขต 2 ปี 2026 (สาทร, ปทุมวัน, พระราม4, นนทบุรี).xlsx",
    zone: "เขต 2",
    sheets: { สาทร: "สาทร", พระราม4: "พระราม 4", ปทุมวัน: "ปทุมวัน", นนทบุรี: "นนทบุรี" },
  },
  {
    file: "OCT.26_เขต 3 ปี 2026 (ปทุมธานี, รามอินทรา, อยุธยา).xlsx",
    zone: "เขต 3",
    sheets: { ปทุมธานี: "ปทุมธานี", รามอินทรา: "รามอินทรา", อยุธยา: "อยุธยา" },
  },
  {
    file: "OCT.26_เขต 4 ปี 2026 (ลาดพร้าว, พัฒนาการ, สุวินทวงศ์, ประชาชื่น).xlsx",
    zone: "เขต 4",
    sheets: { ลาดพร้าว: "ลาดพร้าว", สุวินทวงศ์: "สุวินทวงศ์", พัฒนาการ: "พัฒนาการ", ประชาชื่น: "ประชาชื่น" },
  },
  {
    file: "OCT.26_เขต 5 ปี 2026 (สมุทรปราการ, พัทยา, ระยอง).xlsx",
    zone: "เขต 5",
    sheets: { สมุทรปราการ: "สมุทรปราการ", พัทยา: "พัทยา", ระยอง: "ระยอง" },
  },
  {
    file: "OCT.26_เขต 6 ปี 2026 (สุขุมวิท, ปากน้ำ, ชลบุรี).xlsx",
    zone: "เขต 6",
    sheets: { สุขุมวิท: "สุขุมวิท", ชลบุรี: "ชลบุรี", ปากน้ำ: "ปากน้ำ" },
  },
  {
    file: "OCT.26_เขต 9 (ปากช่อง, สระบุรี, ลพบุรี).xlsx",
    zone: "เขต 9",
    sheets: { ปากช่อง: "ปากช่อง", สระบุรี: "สระบุรี", ลพบุรี: SKIP_PROVINCE },
  },
  {
    file: "OCT.26_เขต 13 (พระราม2, ปราจีน).xlsx",
    zone: "เขต 13",
    sheets: { "พระราม 2": "พระราม 2", ปราจีนบุรี: "ปราจีนบุรี" },
  },
];

export type SheetTarget = { kind: "branch"; branch: string } | { kind: "skip"; reason: string };

/** ชีท → สาขา ตามตาราง · ไม่อยู่ในตาราง = throw (ห้ามเดา) */
export function resolveRegistrySheet(spec: RegistryFileSpec, sheetName: string): SheetTarget {
  if (!Object.prototype.hasOwnProperty.call(spec.sheets, sheetName)) {
    throw new Error(`ชีท "${sheetName}" ในไฟล์ "${spec.file}" ไม่อยู่ในตารางชีท → สาขา (centralRegistrySheets.ts) — เพิ่มในตารางก่อน ห้ามเดา`);
  }
  const t = spec.sheets[sheetName]!;
  return typeof t === "string" ? { kind: "branch", branch: t } : { kind: "skip", reason: t.skip };
}

/** สาขาปลายทางทั้งหมดในตาราง (ไม่รวมชีทที่ข้าม) */
export function registryTargetBranches(files: readonly RegistryFileSpec[] = CENTRAL_REGISTRY_FILES_OCT26): string[] {
  return files.flatMap((f) => Object.values(f.sheets).filter((t): t is string => typeof t === "string"));
}
