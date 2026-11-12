/**
 * อัปโหลด PDF สัญญาที่เลือกไว้ในแถวร่าง หลังบันทึกแถวสำเร็จ
 * (แยกไฟล์เพื่อให้ NewContractsClient เรียกสั้นๆ และเทสง่าย — ตรรกะอัปโหลดจริงอยู่ที่ files.ts)
 *
 * แนบไม่สำเร็จ ไม่ย้อนการบันทึกสัญญา (SPEC §6.6: แนบทีหลังได้ ไม่บล็อกการบันทึกแถว)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { putContractPdf, type OpResult } from "./files";
import type { PendingFile } from "./types";

export function uploadAfterSave(
  supabase: SupabaseClient,
  contractId: string,
  pending: PendingFile,
): Promise<OpResult> {
  return putContractPdf(supabase, contractId, pending, null);
}
