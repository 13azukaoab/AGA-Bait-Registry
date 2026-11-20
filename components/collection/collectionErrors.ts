/**
 * แปล error ของ RPC เก็บ/ไม่เก็บ IG (`collect_ig_stations` / `skip_ig_collection`) เป็นภาษาไทย — pure function
 *
 * Logic summary:
 *   * รหัสที่ DB ยกได้: CL001–CL005 · AG004 (ไม่พบสัญญา) · TM004 (ทีมปิด) · 42501 (ไม่มีสิทธิ์) · SV011 (ของ M19b ชุดเดียวกัน)
 *   * ไม่โชว์ข้อความดิบของ DB เด็ดขาด · log ได้แค่ code (PDPA) — ผู้เรียกใช้ `logCode`
 *   * 22023 / 22P02 / 23514 / 21000 ฯลฯ = ข้อมูลที่หน้าจอส่งไม่ถูก (บั๊กหน้าจอ) → ข้อความทั่วไป + isBug
 *   * ไฟล์นี้แยกจาก components/service/errors.ts โดยตั้งใจ (คนละหน้า แก้แยกกันได้)
 */
import { describeTeamError } from "@/lib/service/teamErrors";

export interface CollectDbError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  statusCode?: string | number | null;
}

export interface CollectError {
  message: string;
  /** true = บั๊กหน้าจอ / ไม่ทราบสาเหตุ → ผู้เรียก log เฉพาะ `code` */
  isBug: boolean;
  /** รหัสสำหรับ log (ไม่มีข้อมูลลูกค้า) */
  logCode: string;
}

const KNOWN: Record<string, string> = {
  SV011: "เปลี่ยนไม้ได้เฉพาะสถานี IG / IC (กล่อง AG ไม่มีไม้ล่อ)",
  CL001: "สัญญานี้ยังไม่หมดอายุ — เก็บสถานีได้หลังหมดสัญญาเท่านั้น",
  CL002: "จำนวนสถานี IG ไม่ถูกต้อง หรือเกินจำนวนที่ยังค้างเก็บ — รีเฟรชหน้าแล้วตรวจอีกครั้ง",
  CL003: "ต้องเลือกทีมบริการหรือทีมติดตั้งที่เข้าไปเก็บ",
  CL004: "ต้องพิมพ์เหตุผลที่ไม่เก็บ (ไม่เกิน 300 ตัวอักษร)",
  CL005: "วันที่ไม่ถูกต้อง — ต้องไม่เกินวันนี้ และไม่ก่อนวันที่สัญญาสิ้นสุด",
  AG004: "ไม่พบสัญญานี้ (อาจถูกลบไปแล้ว) รีเฟรชหน้า",
  "22004": "ข้อมูลที่ส่งไปไม่ครบ รีเฟรชหน้าแล้วลองอีกครั้ง",
  // close_contract (M44)
  CL006: "สัญญายังไม่หมดอายุ ปิดไม่ได้ — ถ้าต้องการเลิกก่อนกำหนดให้ใช้ “ยกเลิกสัญญา”",
  CL007: "สัญญานี้ปิดไปแล้ว รีเฟรชหน้า",
  CL008: "สัญญานี้ถูกยกเลิกแล้ว ปิดสัญญาไม่ได้",
  CL009: "สัญญานี้พักอยู่ — ต้องกลับมาต่อสัญญาก่อนจึงปิดได้",
  CL010: "หมายเหตุยาวเกิน 500 ตัวอักษร",
  CL011: "ปิดสัญญาต้องกดจากหน้านี้เท่านั้น (แก้ตรงผ่านระบบอื่นไม่ได้)",
  CP010: "สัญญานี้พักอยู่ ยังเก็บสถานีไม่ได้ — ต้องยกเลิกการพักสัญญาก่อน",
  "42501": "ไม่มีสิทธิ์บันทึกการเก็บสถานีของสัญญานี้ (สัญญาอาจอยู่นอกขอบเขตของบัญชี หรือบัญชีนี้ไม่ใช่หัวหน้างาน/Host)",
};

const BUG_CODES = new Set(["22004", "22023", "22P02", "23514", "21000", "23502"]);

const BUG_MESSAGE = "บันทึกไม่สำเร็จเพราะข้อมูลที่ส่งไม่ถูกรูปแบบ (ข้อผิดพลาดของระบบ) กรุณาแจ้งผู้ดูแลระบบ";
const GENERIC_MESSAGE = "บันทึกไม่สำเร็จ ลองอีกครั้ง หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ";

export function describeCollectError(error: CollectDbError): CollectError {
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  const status = String(error.statusCode ?? "");

  const team = describeTeamError(code, error.details);
  if (team) return { message: team, isBug: false, logCode: code };

  const known = KNOWN[code];
  if (known) return { message: known, isBug: false, logCode: code };

  if (BUG_CODES.has(code)) return { message: BUG_MESSAGE, isBug: true, logCode: code };

  if (status === "403" || msg.includes("row-level security") || msg.includes("permission denied")) {
    return { message: KNOWN["42501"] as string, isBug: false, logCode: code || "403" };
  }
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed")) {
    return {
      message: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง",
      isBug: false,
      logCode: "network",
    };
  }
  return { message: GENERIC_MESSAGE, isBug: true, logCode: code || "unknown" };
}
