/**
 * รายการเดือนใน dropdown ของ Topbar (AppShell) — pure function + ตัวอ่าน go_live_month (M25)
 *
 * Logic summary:
 *   * เดือนแรก = `go_live_month()` (app_settings · แก้ได้เฉพาะผู้ดูแลฐานข้อมูล) — ห้าม hardcode
 *   * รายการ ใหม่→เก่า: เดือนปัจจุบัน (เวลาไทย) ย้อนลงไปถึงเดือนแรก · จำกัดไม่เกิน 36 เดือน
 *   * ถ้ายังไม่ถึงเดือนแรก (เดือนปัจจุบัน < go-live) แสดงเดือนแรกเดือนเดียว
 *   * อ่านค่าไม่ได้ / ค่าผิดรูปแบบ = ค่าสำรองปลอดภัย: แสดงเฉพาะเดือนปัจจุบัน (หน้าไม่ล้ม)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MonthOption } from "@/components/shell";

import { currentBangkokMonth, isMonthKey, monthLabel, shiftMonth } from "./months";

export const SHELL_MONTH_LIMIT = 36;

/** รับ go_live_month จาก RPC (`'2026-10-01'`) → `'2026-10'` · ผิดรูปแบบ = null */
export function goLiveToMonthKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.slice(0, 7);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) && isMonthKey(key) ? key : null;
}

export function buildShellMonths(goLiveMonth: string | null, current: string): MonthOption[] {
  const out: MonthOption[] = [];
  const first = goLiveMonth && isMonthKey(goLiveMonth) ? goLiveMonth : current;
  if (first > current) return [{ value: first, label: monthLabel(first) }];
  for (let m = current, n = 0; m >= first && n < SHELL_MONTH_LIMIT; m = shiftMonth(m, -1), n++) {
    out.push({ value: m, label: monthLabel(m) });
  }
  return out;
}

/** อ่าน go_live_month() ด้วย session ของผู้ใช้ (ไม่ใช้ service role) — พลาด = null */
export async function loadShellMonths(supabase: SupabaseClient, now: Date = new Date()): Promise<MonthOption[]> {
  const current = currentBangkokMonth(now);
  try {
    const { data, error } = await supabase.rpc("go_live_month");
    return buildShellMonths(error ? null : goLiveToMonthKey(data), current);
  } catch {
    return buildShellMonths(null, current);
  }
}
