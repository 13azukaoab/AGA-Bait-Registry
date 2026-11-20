/**
 * onboarding.ts — **ไฟล์เดียว** ในโฟลเดอร์บทเรียนที่ได้คุยกับฐานข้อมูล
 *
 * ทำ 3 อย่างเท่านั้น (เทสในไฟล์ onboarding.test.ts ยืนยันว่าไม่มีไฟล์อื่นในโฟลเดอร์นี้แตะเครือข่าย):
 *   1) อ่านสถานะของตัวเอง (ตำแหน่ง + onboarding_completed_at / onboarding_skipped_at) — อ่านก่อนเริ่มบทเรียน ไม่ใช่ตอนฝึก
 *   2) `complete_onboarding()` ตอนดูจบ
 *   3) `skip_onboarding()` ตอนกดข้าม
 * ทั้งสอง RPC ไม่รับ parameter (SECURITY DEFINER อ้าง auth.uid() ของผู้เรียก — ดู migration 20261111090400)
 *
 * ระหว่างฝึก (หน้าจำลอง/ปุ่มบันทึกหลอก) ไม่มีการเรียกอะไรออกไปเลย
 */
import { createClient } from "@/lib/supabase/client";

import type { OnboardingState } from "./tour-logic";

/** ส่วนของ Supabase client ที่ไฟล์นี้ใช้ (ทำให้เทสด้วยของจำลองได้) */
export type OnboardingClient = {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null } }> };
  from(table: "profiles"): {
    select(columns: string): {
      eq(
        column: "user_id",
        value: string,
      ): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
  rpc(fn: "complete_onboarding" | "skip_onboarding"): PromiseLike<{ error: unknown }>;
};

/** client ของ browser (อ่านค่า env ตาม lib/supabase/client) — ประกอบตอนเรียกใช้เท่านั้น */
export function browserOnboardingClient(): OnboardingClient {
  return createClient() as unknown as OnboardingClient;
}

export type TutorialProfile = OnboardingState & {
  positionCode: string | null;
};

type Row = {
  position_code: string | null;
  onboarding_completed_at: string | null;
  onboarding_skipped_at: string | null;
};

/** อ่านสถานะของผู้ใช้ที่ล็อกอิน (RLS profiles_select_own: เห็นแถวตัวเองเท่านั้น) · null = อ่านไม่ได้ → ไม่เปิดอัตโนมัติ */
export async function loadTutorialProfile(client: OnboardingClient): Promise<TutorialProfile | null> {
  try {
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return null;
    const { data, error } = await client
      .from("profiles")
      .select("position_code, onboarding_completed_at, onboarding_skipped_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Row;
    return {
      positionCode: row.position_code,
      completedAt: row.onboarding_completed_at,
      skippedAt: row.onboarding_skipped_at,
    };
  } catch {
    return null;
  }
}

/** บันทึก “ดูจบ” · คืน true เมื่อสำเร็จ (ล้มเหลว = เงียบ ผู้ใช้เปิดบทเรียนอัตโนมัติอีกครั้งในครั้งหน้า) */
export async function recordCompleted(client: OnboardingClient): Promise<boolean> {
  try {
    const { error } = await client.rpc("complete_onboarding");
    return !error;
  } catch {
    return false;
  }
}

/** บันทึก “กดข้าม” */
export async function recordSkipped(client: OnboardingClient): Promise<boolean> {
  try {
    const { error } = await client.rpc("skip_onboarding");
    return !error;
  } catch {
    return false;
  }
}
