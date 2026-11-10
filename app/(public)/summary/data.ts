/**
 * อ่านข้อมูลหน้า /summary จาก Supabase — ด้วยสิทธิ์ผู้ไม่ล็อกอิน (anon) เท่านั้น
 *
 * - ใช้ supabase-js + anon key โดยตรง (ไม่ผูก cookie, ไม่เก็บ session) เพื่อรับประกันว่าเป็น role `anon`
 *   แม้ผู้เปิดหน้าจะล็อกอินอยู่ · ห้ามใช้ service role key (CLAUDE.md ข้อ 8)
 * - อ่านจาก view `v_branch_summary` เท่านั้น (ไม่มี PII — SPEC §5)
 * - เลือกเฉพาะคอลัมน์ที่ Dashboard ใช้ · **ห้าม `select('*')`** และห้ามดึง
 *   report_cust / report_value / confirmed_at / confirmed_by (เจ้าของตัดสินให้ซ่อนจากคนทั่วไป —
 *   view นี้ไม่มีคอลัมน์เหล่านี้อยู่แล้ว แต่ระบุคอลัมน์ชัดเจนเพื่อกันหลุดถ้า view ถูกขยายภายหลัง)
 * - PostgREST จำกัด 1,000 แถวต่อคำขอ (43 สาขา × ~23 เดือน เกินได้) จึงดึงเป็นหน้าๆ
 */
import { createClient } from "@supabase/supabase-js";

import { parseMonthKey, type Division, type SummaryRow } from "@/components/summary/calc";

const COLUMNS =
  "month_key,zone_name,branch_name,division,s1,s3,m1,m3,l1,l3,xl1,xl3,cust,vS,vM,vL,vXL,value";

const PAGE_SIZE = 1000;
/** กัน loop ไม่รู้จบถ้าเซิร์ฟเวอร์ตอบผิดปกติ (50 หน้า = 50,000 แถว มากกว่าข้อมูลจริงหลายเท่า) */
const MAX_PAGES = 50;

type RawRow = {
  month_key: string;
  zone_name: string;
  branch_name: string;
  division: string;
  s1: number | null;
  s3: number | null;
  m1: number | null;
  m3: number | null;
  l1: number | null;
  l3: number | null;
  xl1: number | null;
  xl3: number | null;
  cust: number | null;
  vS: number | string | null;
  vM: number | string | null;
  vL: number | string | null;
  vXL: number | string | null;
  value: number | string | null;
};

export type SummaryLoadResult =
  | { ok: true; rows: SummaryRow[] }
  | { ok: false; reason: "config" | "query" };

const num = (v: number | string | null): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function toRow(raw: RawRow): SummaryRow | null {
  const month = parseMonthKey(raw.month_key);
  if (!month) return null;
  if (raw.division !== "central" && raw.division !== "province") return null;
  return {
    ym: month.ym,
    zone: raw.zone_name,
    branch: raw.branch_name,
    division: raw.division as Division,
    s1: num(raw.s1),
    s3: num(raw.s3),
    m1: num(raw.m1),
    m3: num(raw.m3),
    l1: num(raw.l1),
    l3: num(raw.l3),
    xl1: num(raw.xl1),
    xl3: num(raw.xl3),
    cust: num(raw.cust),
    vS: num(raw.vS),
    vM: num(raw.vM),
    vL: num(raw.vL),
    vXL: num(raw.vXL),
    value: num(raw.value),
  };
}

export async function loadSummaryRows(): Promise<SummaryLoadResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { ok: false, reason: "config" };

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const rows: SummaryRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from("v_branch_summary")
      .select(COLUMNS)
      // เรียงให้คงที่ระหว่างหน้า (กันแถวซ้ำ/หายตอนแบ่งหน้า)
      .order("month_key", { ascending: true })
      .order("branch_name", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
      .returns<RawRow[]>();

    if (error) {
      // ไม่โยนรายละเอียด error ออกหน้าเว็บ public — บันทึกฝั่ง server เท่านั้น
      console.error("[summary] load v_branch_summary failed:", error.message);
      return { ok: false, reason: "query" };
    }
    for (const raw of data ?? []) {
      const row = toRow(raw);
      if (row) rows.push(row);
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { ok: true, rows };
}
