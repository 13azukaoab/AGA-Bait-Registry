/**
 * งานลบไฟล์ใน Storage ตามคิว `storage_deletion_queue` (migration 20261112110100)
 *
 * Logic summary:
 *   * ฐานข้อมูลเป็นตัวตั้ง: ลบ/เปลี่ยนไฟล์สำเร็จ → trigger ลง path ในคิว · งานนี้ลบ object จริงภายหลัง
 *   * ต่อ 1 รายการ:
 *       1. ยังมีแถว `contract_files` ใช้ path นี้อยู่ไหม → มี = **ไม่ลบ** ปิดงานพร้อมหมายเหตุ
 *          (กันลบไฟล์ที่ยังใช้งาน · ตรวจไม่ได้ = ถือว่าล้ม ไม่เดา)
 *       2. สั่งลบ object
 *       3. **ตรวจซ้ำว่า object หายจริง** — Storage `remove()` ที่ถูกปฏิเสธจะคืนรายการว่างโดยไม่ error
 *       4. หายจริง = ปิดงาน · ยังอยู่/error = นับ attempts + เก็บข้อความ error
 *   * รายการที่ล้มครบ `MAX_ATTEMPTS` ครั้งจะไม่ถูกดึงมาอีก ค้างไว้ให้ host ตรวจ (host อ่านคิวได้ตาม RLS)
 *   * ลบเฉพาะ path ที่อยู่ในคิว — ไม่ไล่ลบ "ไฟล์ที่ไม่มีแถว" เอง (กันลบผิด)
 *   * ตรรกะแยกจาก Supabase ผ่าน `CleanupPorts` เพื่อเทสได้ (`cleanup.test.ts`) ·
 *     ตัวเชื่อมของจริงอยู่ที่ `supabasePorts.ts` (ใช้ service role ฝั่ง server เท่านั้น)
 */

export const MAX_ATTEMPTS = 5;
export const DEFAULT_BATCH_SIZE = 100;

export type QueueItem = {
  id: number;
  bucket: string;
  path: string;
  attempts: number;
};

export interface CleanupPorts {
  /** รายการที่ยังไม่เสร็จและลองไม่ถึง `MAX_ATTEMPTS` ครั้ง เรียงจากเก่าสุด */
  fetchPending(limit: number): Promise<QueueItem[]>;
  /** ยังมีแถว contract_files อ้างอิง path นี้อยู่ไหม (error ให้ throw) */
  isReferenced(path: string): Promise<boolean>;
  /** สั่งลบ object (error ให้ throw) */
  removeObject(bucket: string, path: string): Promise<void>;
  /** object ยังอยู่ใน bucket ไหม (error ให้ throw) */
  objectExists(bucket: string, path: string): Promise<boolean>;
  markDone(id: number, note: string | null): Promise<void>;
  markFailed(id: number, attempts: number, error: string): Promise<void>;
}

export type CleanupSummary = {
  processed: number;
  deleted: number;
  skipped: number;
  failed: number;
};

export const STILL_REFERENCED_NOTE = "skipped: path is still referenced by contract_files";
export const STILL_PRESENT_ERROR = "object still present after remove";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown error";
}

export async function runStorageCleanup(
  ports: CleanupPorts,
  limit: number = DEFAULT_BATCH_SIZE,
): Promise<CleanupSummary> {
  const summary: CleanupSummary = { processed: 0, deleted: 0, skipped: 0, failed: 0 };
  const items = await ports.fetchPending(limit);

  for (const item of items) {
    summary.processed += 1;
    try {
      if (await ports.isReferenced(item.path)) {
        await ports.markDone(item.id, STILL_REFERENCED_NOTE);
        summary.skipped += 1;
        continue;
      }

      await ports.removeObject(item.bucket, item.path);

      if (await ports.objectExists(item.bucket, item.path)) {
        await ports.markFailed(item.id, item.attempts + 1, STILL_PRESENT_ERROR);
        summary.failed += 1;
        continue;
      }

      await ports.markDone(item.id, null);
      summary.deleted += 1;
    } catch (error) {
      summary.failed += 1;
      // บันทึกความล้มเหลวไม่ได้ก็ปล่อย — รอบหน้าจะดึงรายการเดิมมาลองใหม่
      await ports.markFailed(item.id, item.attempts + 1, errorMessage(error)).catch(() => undefined);
    }
  }

  return summary;
}
