/**
 * กฎ/ข้อความของการลบสัญญาและการลบไฟล์ที่เพิ่งอัปโหลด (pure function — เทสได้ ไม่แตะ DB)
 * (ตรวจจริงว่าลบสัญญาได้ไหมทำที่ RPC `delete_job_opening` — ที่นี่เหลือเฉพาะใช้ปิดปุ่ม/ข้อความยืนยัน)
 *
 * Logic summary:
 *   * สัญญา `closed` / `cancelled` ลบไม่ได้จากหน้านี้ — ปิดแล้ว = ไฟล์ถูกล็อกด้วย trigger,
 *     ยกเลิกแล้ว = เก็บไว้เป็นประวัติ (DECISIONS 1.5: มีผลบริการให้ใช้สถานะยกเลิกแทนการลบ)
 *   * ลบสัญญาเก่าที่มีสัญญา Renew ผูกอยู่ → DB ตั้ง renewed_from_contract_id เป็น NULL (ON DELETE SET NULL)
 *     การผูกจึงหาย — ต้องเตือนให้ผู้ใช้ยืนยันก่อน
 *   * Storage `remove()` ที่ถูก RLS ปฏิเสธจะ **ไม่ error** แต่คืนรายการว่าง/ไม่ครบ →
 *     เทียบจำนวนที่ลบได้กับจำนวนที่ขอ (`removalShortfall`)
 */
import type { ContractStatus } from "./types";

/** เหตุผลที่ลบสัญญานี้ไม่ได้จากสถานะ (null = ลบได้ตามสถานะ) */
export function contractDeleteBlockReason(status: ContractStatus): string | null {
  if (status === "closed") return "ลบไม่ได้ — สัญญาปิดแล้ว (ไฟล์แนบถูกล็อก)";
  if (status === "cancelled") return "ลบไม่ได้ — สัญญายกเลิกแล้ว เก็บไว้เป็นประวัติ";
  return null;
}

const MAX_LISTED_RENEWALS = 5;

/** ข้อความยืนยันก่อนลบสัญญา · ถ้ามีสัญญา Renew ผูกอยู่ ให้เตือนว่าการผูกจะหาย */
export function buildDeleteConfirmText(
  contractNo: string,
  customerName: string,
  renewalContractNos: string[],
): string {
  const lines = [
    `ลบสัญญา ${contractNo} (${customerName}) ?`,
    "ลบได้เฉพาะสัญญาที่ยังไม่มีผลบริการ · ไฟล์แนบจะถูกลบด้วย · เอากลับคืนไม่ได้",
  ];
  if (renewalContractNos.length > 0) {
    const listed = renewalContractNos.slice(0, MAX_LISTED_RENEWALS).join(", ");
    const more = renewalContractNos.length - MAX_LISTED_RENEWALS;
    lines.push(
      "",
      `⚠ มีสัญญา Renew ผูกกับสัญญานี้อยู่ ${renewalContractNos.length} ใบ: ${listed}${more > 0 ? ` และอีก ${more} ใบ` : ""}`,
      "ลบแล้วการผูกจะหาย (สัญญา Renew เหล่านั้นจะกลายเป็น \"ยังไม่ผูก\") ต้องผูกใหม่เอง",
    );
  }
  return lines.join("\n");
}

/** จำนวนไฟล์ที่ขอลบแต่ Storage ไม่ได้ลบให้ (0 = ครบ) — `removed` null = ไม่มีข้อมูลตอบกลับ นับเป็น 0 */
export function removalShortfall(requested: number, removed: number | null | undefined): number {
  return Math.max(0, requested - (removed ?? 0));
}

/** ข้อความเมื่อลบไฟล์ใน Storage ไม่ครบ (ใช้กับไฟล์ที่เพิ่งอัปโหลดแล้วต้องย้อน) */
export function describeShortfall(requested: number, removed: number): string {
  return `ลบไฟล์แนบได้ ${removed} จาก ${requested} ไฟล์ (ที่เหลือถูกปฏิเสธสิทธิ์หรือลบไม่สำเร็จ) — แจ้งผู้ดูแลระบบ`;
}
