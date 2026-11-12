/**
 * ตัวเชื่อม `CleanupPorts` กับ Supabase จริง (ใช้ client แบบ service role ฝั่ง server เท่านั้น)
 *
 * ทุก error จาก Supabase ให้ throw — `runStorageCleanup` จะนับเป็นล้มและลองใหม่รอบหน้า
 * ไม่มีการ "เดา" ว่าลบได้เมื่อถามฐานข้อมูลไม่สำเร็จ
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { MAX_ATTEMPTS, type CleanupPorts, type QueueItem } from "./cleanup";

/** แยก path เป็นโฟลเดอร์ + ชื่อไฟล์ (Storage list ค้นได้ทีละโฟลเดอร์) */
export function splitObjectPath(path: string): { folder: string; name: string } {
  const slash = path.lastIndexOf("/");
  if (slash < 0) return { folder: "", name: path };
  return { folder: path.slice(0, slash), name: path.slice(slash + 1) };
}

export function supabaseCleanupPorts(admin: SupabaseClient): CleanupPorts {
  return {
    async fetchPending(limit) {
      const { data, error } = await admin
        .from("storage_deletion_queue")
        .select("id, bucket, path, attempts")
        .is("done_at", null)
        .lt("attempts", MAX_ATTEMPTS)
        .order("enqueued_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`read queue: ${error.message}`);
      return (data ?? []) as QueueItem[];
    },

    async isReferenced(path) {
      const { count, error } = await admin
        .from("contract_files")
        .select("id", { count: "exact", head: true })
        .eq("storage_path", path);
      if (error) throw new Error(`check contract_files: ${error.message}`);
      return (count ?? 0) > 0;
    },

    async removeObject(bucket, path) {
      const { error } = await admin.storage.from(bucket).remove([path]);
      if (error) throw new Error(`remove: ${error.message}`);
    },

    async objectExists(bucket, path) {
      const { folder, name } = splitObjectPath(path);
      const { data, error } = await admin.storage
        .from(bucket)
        .list(folder, { search: name, limit: 100 });
      if (error) throw new Error(`verify: ${error.message}`);
      return (data ?? []).some((object) => object.name === name);
    },

    async markDone(id, note) {
      const { error } = await admin
        .from("storage_deletion_queue")
        .update({ done_at: new Date().toISOString(), last_error: note })
        .eq("id", id);
      if (error) throw new Error(`mark done: ${error.message}`);
    },

    async markFailed(id, attempts, message) {
      const { error } = await admin
        .from("storage_deletion_queue")
        .update({ attempts, last_error: message })
        .eq("id", id);
      if (error) throw new Error(`mark failed: ${error.message}`);
    },
  };
}
