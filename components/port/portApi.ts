/**
 * บันทึกแถว Port ต่างจังหวัด (ฝั่ง browser)
 *
 * Logic summary:
 *   * เขียน `monthly_branch_snapshots` ด้วย Supabase client ของผู้ใช้ (JWT) เท่านั้น — **ห้ามใช้ service role**
 *     เพราะด่านตัวเลข/สิทธิ์ของ M40 (trigger `snapshots_manual_guard`) ตรวจเฉพาะคำขอจาก authenticated
 *   * upsert ที่ (month_key, branch_id) · server คำนวณ cust/vS/vM/vL/vXL/value และใส่ confirmed_at/by เองจริง
 *   * error: log เฉพาะ code (ไม่ log ข้อความดิบ) แล้วคืน code ให้หน้าแปลงเป็นข้อความไทยด้วย `portErrorMessage`
 */
import type { UpsertPayload } from "./portLogic";

/** ส่วนของ Supabase client ที่ใช้ — แยกไว้ให้เทสสลับตัวปลอมได้ */
export interface PortWriter {
  from(table: "monthly_branch_snapshots"): {
    upsert(
      row: UpsertPayload,
      opts: { onConflict: string },
    ): PromiseLike<{ error: { code?: string | null } | null }>;
  };
}

export type SaveOutcome = { ok: true } | { ok: false; code: string | null };

export async function savePortRow(client: PortWriter, payload: UpsertPayload): Promise<SaveOutcome> {
  try {
    const { error } = await client
      .from("monthly_branch_snapshots")
      .upsert(payload, { onConflict: "month_key,branch_id" });
    if (!error) return { ok: true };
    const code = error.code ?? null;
    console.warn("port save failed", code);
    return { ok: false, code };
  } catch {
    // เครือข่ายหลุด ฯลฯ — ไม่มี code
    console.warn("port save failed", "network");
    return { ok: false, code: null };
  }
}
