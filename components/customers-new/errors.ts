/**
 * แปล error จาก Supabase/PostgREST/Storage เป็นข้อความภาษาไทยที่ผู้ใช้เข้าใจ
 *
 * Logic summary:
 *   * ปล่อยให้ RLS ตัดสินสิทธิ์ (admin บันทึกนอกขอบเขตไม่ได้) แล้วแปลผลที่ปฏิเสธเป็นไทย
 *   * 42501 / "row-level security" / "permission denied" → ไม่มีสิทธิ์
 *   * 23505 unique → เลขที่สัญญาซ้ำ (หรือไฟล์ซ้ำ) · 23503 FK → ลบไม่ได้เพราะมีผลบริการ
 *   * P0001 = กฎของ trigger (เช่น สัญญาปิดแล้วไฟล์ล็อก · ต้องแนบ PDF ก่อนเพิ่ม Site plan)
 *   * ไม่รู้จัก = ข้อความทั่วไป (ไม่โชว์ข้อความดิบของฐานข้อมูลให้ผู้ใช้)
 */

export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  statusCode?: string | number | null;
  details?: string | null;
}

export type ErrorContext = "save" | "file" | "delete";

export function describeDbError(error: DbErrorLike, context: ErrorContext = "save"): string {
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  const status = String(error.statusCode ?? "");

  if (
    code === "42501" ||
    status === "403" ||
    msg.includes("row-level security") ||
    msg.includes("permission denied") ||
    msg.includes("violates row-level") ||
    msg.includes("unauthorized")
  ) {
    return context === "file"
      ? "ไม่มีสิทธิ์จัดการไฟล์ของสัญญานี้ (สัญญาอาจอยู่นอกขอบเขตของบัญชี หรือสัญญาถูกปิดแล้ว)"
      : "ไม่มีสิทธิ์บันทึกข้อมูลนี้ — สาขานี้อยู่นอกขอบเขตของบัญชีคุณ";
  }
  if (code === "23505" || msg.includes("duplicate") || status === "409") {
    return context === "file"
      ? "มีไฟล์ชื่อนี้อยู่แล้ว ลองอีกครั้ง"
      : "เลขที่สัญญานี้มีอยู่ในระบบแล้ว";
  }
  if (code === "23503") {
    return "ลบไม่ได้ เพราะมีผลบริการหรือข้อมูลที่อ้างอิงอยู่แล้ว (ให้ใช้สถานะยกเลิกแทน)";
  }
  if (code === "23514") return "ข้อมูลไม่ผ่านเงื่อนไขของระบบ ตรวจค่าที่กรอกอีกครั้ง";
  if (code === "P0001") {
    if (msg.includes("closed")) return "สัญญานี้ปิดแล้ว ไฟล์ถูกล็อก เพิ่ม/แก้/ลบไม่ได้";
    if (msg.includes("attach the contract pdf")) {
      return "ต้องแนบ PDF สัญญาก่อน จึงจะอัปเดต Site plan ได้";
    }
    return "ระบบไม่อนุญาตการกระทำนี้";
  }
  if (msg.includes("failed to fetch") || msg.includes("network")) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง";
  }
  if (msg.includes("mime") || msg.includes("not supported")) {
    return "ชนิดไฟล์นี้ระบบไม่รับ";
  }
  if (msg.includes("exceeded") || msg.includes("too large") || status === "413") {
    return "ไฟล์ขนาดใหญ่เกินไป";
  }
  return "บันทึกไม่สำเร็จ ลองอีกครั้ง หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ";
}
