/**
 * master ประเภทลูกค้า 14 ค่า 4 หมวด (task.md 2026-11-02 รอบสุดท้าย)
 * ไม่ให้พิมพ์อิสระ — นำเข้าต้องแมปเข้าค่าใดค่าหนึ่งนี้เท่านั้น
 */
export const CUSTOMER_TYPES: readonly string[] = [
  // ที่พักอาศัย
  "บ้านเดี่ยว",
  "ทาวน์โฮม / ตึกแถว",
  "คอนโด / อพาร์ตเมนต์ / หอพัก",
  // ธุรกิจ / อุตสาหกรรม
  "ออฟฟิต",
  "ห้าง / ร้านค้า",
  "โรงแรม/รีสอร์ท",
  "โรงงาน",
  "โกดังสินค้า",
  // บริการ / สาธารณะ
  "โรงพยาบาล",
  "สถานศึกษา",
  "สถานที่ราชการ",
  "สถานที่ทางศาสนา",
  "สถานที่สำคัญ",
  // อื่นๆ
  "อื่นๆ (ระบุในหมายเหตุ)",
];

/**
 * ที่มาของกฎแปลง
 * - legacy   = ค่าเก่าของไฟล์เปิดงาน (task.md 2026-11-02)
 * - registry = รหัส/คำสะกดผิดในทะเบียนรายสาขา (DECISIONS 2.70 · TH = เหมือน T)
 *              รหัสอ่านจากหัวตารางทะเบียน "H = บ้าน /T = ทาวน์โฮม/R=ห้อง"
 * - proposed = ข้อเสนอที่เจ้าของยังไม่ยืนยัน → ปิดเป็นค่าเริ่มต้น เปิดด้วย `includeProposed`
 */
export type CustomerTypeMappingSource = "legacy" | "registry" | "proposed";

export interface CustomerTypeMapping {
  /** ค่าในไฟล์ต้นทาง (รหัสภาษาอังกฤษเทียบแบบไม่สนตัวพิมพ์) */
  from: string;
  /** ค่าใน master (CUSTOMER_TYPES) */
  to: string;
  source: CustomerTypeMappingSource;
}

/** ตารางแปลงทั้งหมด — export ไว้ทำตารางให้เจ้าของตรวจ (ห้ามพิมพ์ตารางในเอกสารเอง ให้สร้างจากค่านี้) */
export const CUSTOMER_TYPE_MAPPINGS: readonly CustomerTypeMapping[] = [
  { from: "บ้าน", to: "บ้านเดี่ยว", source: "legacy" },
  { from: "อาคาร", to: "ออฟฟิต", source: "legacy" },
  { from: "สำนักงาน", to: "ออฟฟิต", source: "legacy" },
  { from: "ออฟฟิศ", to: "ออฟฟิต", source: "legacy" },
  { from: "ทาวโฮม", to: "ทาวน์โฮม / ตึกแถว", source: "legacy" },
  { from: "ทาวน์โฮม", to: "ทาวน์โฮม / ตึกแถว", source: "legacy" },
  { from: "ตึกแถว", to: "ทาวน์โฮม / ตึกแถว", source: "legacy" },
  { from: "โรงเรียน", to: "สถานศึกษา", source: "legacy" },
  { from: "มหาลัย", to: "สถานศึกษา", source: "legacy" },
  { from: "มหาวิทยาลัย", to: "สถานศึกษา", source: "legacy" },
  { from: "วัง", to: "สถานที่สำคัญ", source: "legacy" },
  { from: "สวนลอยฟ้า", to: "สถานที่สำคัญ", source: "legacy" },
  { from: "ศาล", to: "สถานที่ราชการ", source: "legacy" },
  { from: "สำนักงานนายก", to: "สถานที่ราชการ", source: "legacy" },
  { from: "รีสอร์ท", to: "โรงแรม/รีสอร์ท", source: "legacy" },
  { from: "โรงแรม", to: "โรงแรม/รีสอร์ท", source: "legacy" },
  { from: "ห้าง", to: "ห้าง / ร้านค้า", source: "legacy" },
  { from: "โกดัง", to: "โกดังสินค้า", source: "legacy" },
  // ทะเบียนรายสาขา (2.70 ก1)
  { from: "H", to: "บ้านเดี่ยว", source: "registry" },
  { from: "T", to: "ทาวน์โฮม / ตึกแถว", source: "registry" },
  { from: "TH", to: "ทาวน์โฮม / ตึกแถว", source: "registry" },
  { from: "R", to: "คอนโด / อพาร์ตเมนต์ / หอพัก", source: "registry" },
  { from: "ออฟฟิิต", to: "ออฟฟิต", source: "registry" }, // สระอิซ้อน 2 ตัว
  { from: "โรงาน", to: "โรงงาน", source: "registry" },
  // ข้อเสนอ (เจ้าของยังไม่ยืนยันแยก)
  { from: "ศาลเจ้า", to: "สถานที่ทางศาสนา", source: "proposed" },
];

const CANONICAL = new Set(CUSTOMER_TYPES);

/** key ค้นตาราง: ตัดช่องว่างหัวท้าย + ตัวอักษรอังกฤษเป็นตัวใหญ่ (ภาษาไทยไม่มีผล) */
function mappingKey(s: string): string {
  return s.trim().toUpperCase();
}

const MAPPING_BY_KEY = new Map(CUSTOMER_TYPE_MAPPINGS.map((m) => [mappingKey(m.from), m]));

export interface CustomerTypeOptions {
  /** เปิดกฎที่เป็นข้อเสนอ (source = "proposed") · ค่าเริ่มต้นปิด */
  includeProposed?: boolean;
}

export interface CustomerTypeResult {
  value: string | null;
  fix?: string;
  error?: string;
}

/**
 * ล้าง+ตรวจประเภทลูกค้า
 * - เป็นค่า canonical อยู่แล้ว → ไม่มี fix
 * - อยู่ในตารางแปลง → แปลงให้ พร้อมบอกว่าแปลงอะไร (กฎข้อเสนอใช้เฉพาะเมื่อเปิด includeProposed)
 * - ไม่รู้จัก / ว่าง → error
 */
export function normalizeCustomerType(raw: string, opts: CustomerTypeOptions = {}): CustomerTypeResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { value: null, error: "ไม่มีประเภทลูกค้า" };

  if (CANONICAL.has(trimmed)) return { value: trimmed };

  const rule = MAPPING_BY_KEY.get(mappingKey(trimmed));
  if (rule && (rule.source !== "proposed" || opts.includeProposed)) {
    const tag = rule.source === "proposed" ? " (ข้อเสนอ รอเจ้าของยืนยัน)" : "";
    return { value: rule.to, fix: `ประเภท "${trimmed}" → ${rule.to}${tag}` };
  }

  return { value: null, error: `ไม่รู้จักประเภท "${trimmed}"` };
}
