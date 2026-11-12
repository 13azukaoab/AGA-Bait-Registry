/**
 * แปล error จาก Supabase/PostgREST/Storage เป็นข้อความภาษาไทยที่ผู้ใช้เข้าใจ
 *
 * Logic summary:
 *   * ปล่อยให้ RLS ตัดสินสิทธิ์ (admin บันทึกนอกขอบเขตไม่ได้) แล้วแปลผลที่ปฏิเสธเป็นไทย
 *   * 42501 / "row-level security" / "permission denied" → ไม่มีสิทธิ์
 *   * 23505 unique → เลขที่สัญญาซ้ำ (หรือไฟล์ซ้ำ) · 23503 FK → ลบไม่ได้เพราะมีผลบริการ
 *   * P0001 = กฎของ trigger (เช่น สัญญาปิดแล้วไฟล์ล็อก · ต้องแนบ PDF ก่อนเพิ่ม Site plan)
 *   * AG001–AG006 = error ของ RPC บันทึก/ลบสัญญา (ชื่อลูกค้าซ้ำ · ลูกค้าไม่อยู่สาขา · ลบไม่ได้ · ไม่พบ ·
 *     สัญญาปิด · เปลี่ยนสาขาไม่ได้) — AG001 หน้าจอส่วนใหญ่จับก่อนแล้วขึ้นกล่องถาม ข้อความนี้เป็นตัวสำรอง
 *   * ไม่รู้จัก = ข้อความทั่วไป (ไม่โชว์ข้อความดิบของฐานข้อมูลให้ผู้ใช้)
 */

export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  statusCode?: string | number | null;
  details?: string | null;
}

export type ErrorContext = "save" | "file" | "delete";

/** error code ของ RPC `save_job_opening` / `delete_job_opening` (ดูหัว migration 20261112110000) */
const RPC_ERRORS: Record<string, string> = {
  AG001: "มีลูกค้าชื่อนี้ในสาขานี้อยู่แล้ว — เลือกว่าใช้ลูกค้ารายเดิม หรือเป็นคนละราย",
  AG002: "ลูกค้าที่เลือกไม่อยู่ในสาขานี้ (หรือไม่พบแล้ว) เลือกลูกค้าใหม่",
  AG003: "ลบไม่ได้ เพราะสัญญานี้มีผลบริการหรือผลตรวจสถานีแล้ว (ให้ใช้สถานะยกเลิกแทน)",
  AG004: "ไม่พบสัญญานี้ (อาจถูกลบไปแล้ว หรือไม่มีสิทธิ์ดู) รีเฟรชหน้า",
  AG005: "ลบไม่ได้ — สัญญาปิดแล้วหรือยกเลิกแล้ว เก็บไว้เป็นประวัติ",
  AG006: "เปลี่ยนสาขาของสัญญาที่บันทึกแล้วไม่ได้",
};

export function describeDbError(error: DbErrorLike, context: ErrorContext = "save"): string {
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  const status = String(error.statusCode ?? "");

  // รหัสของ RPC บันทึก/ลบสัญญา (AG001–AG006) — ตรวจก่อน เพราะ PostgREST ตอบ HTTP 400
  const rpcMessage = RPC_ERRORS[code];
  if (rpcMessage) return rpcMessage;

  if (
    code === "42501" ||
    status === "403" ||
    msg.includes("row-level security") ||
    msg.includes("permission denied") ||
    msg.includes("violates row-level") ||
    msg.includes("unauthorized")
  ) {
    if (context === "file") {
      return "ไม่มีสิทธิ์จัดการไฟล์ของสัญญานี้ (สัญญาอาจอยู่นอกขอบเขตของบัญชี หรือสัญญาถูกปิดแล้ว)";
    }
    return context === "delete"
      ? "ไม่มีสิทธิ์ลบสัญญานี้ — สาขานี้อยู่นอกขอบเขตของบัญชีคุณ"
      : "ไม่มีสิทธิ์บันทึกข้อมูลนี้ — สาขานี้อยู่นอกขอบเขตของบัญชีคุณ";
  }
  if (code === "23505" || msg.includes("duplicate") || status === "409") {
    return context === "file"
      ? "มีไฟล์ชื่อนี้อยู่แล้ว ลองอีกครั้ง"
      : "เลขที่สัญญานี้มีอยู่ในระบบแล้ว";
  }
  if (code === "23503") {
    if (context === "save" && msg.includes("renewed_from")) {
      return "ไม่พบสัญญาเก่าที่ผูกไว้ (อาจถูกลบไปแล้ว) เลือกสัญญาเก่าใหม่";
    }
    return "ลบไม่ได้ เพราะมีผลบริการหรือข้อมูลที่อ้างอิงอยู่แล้ว (ให้ใช้สถานะยกเลิกแทน)";
  }
  if (code === "23514") {
    if (msg.includes("first_service_time")) return "ใส่เวลาบริการได้เมื่อมีวันที่บริการ เลือกวันที่ก่อน";
    if (msg.includes("renewed_from_itself")) return "สัญญาผูกกับตัวเองไม่ได้ เลือกสัญญาเก่าอีกใบ";
    return "ข้อมูลไม่ผ่านเงื่อนไขของระบบ ตรวจค่าที่กรอกอีกครั้ง";
  }
  if (code === "P0001") {
    if (msg.includes("same customer")) {
      return "Renew ต้องผูกกับสัญญาเก่าของลูกค้าคนเดียวกัน เลือกสัญญาเก่าใหม่";
    }
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
