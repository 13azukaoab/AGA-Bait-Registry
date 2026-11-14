/**
 * ชั้นอ่านข้อมูลหน้า "กล่อง AG นอกรอบประจำเดือน" (/bait)
 *
 * Logic summary:
 *   * รายชื่อลูกค้า/รายละเอียดสัญญา/โหลดการเข้ามาแก้ ใช้ชุดเดียวกับ /service (`components/service/data.ts`)
 *   * ที่เพิ่มของหน้านี้ = รายการ "การเข้านอกรอบที่บันทึกแล้ว" ของสัญญา (visit_type = follow_up) ไว้แสดง/แก้/ลบ
 *     พร้อมสรุปว่าติดกล่องใหม่ (S) จุดไหน ติดตามผล (F) จุดไหน — F อ่านจากผลตรวจที่ฐานข้อมูลนับให้
 *   * Supabase client ของผู้ใช้จริง (RLS) · ระบุคอลัมน์ทุก select · ไม่ใช้ service role
 *   * `hasOther` = การเข้านี้มีผลตรวจ IG/IC หรืองานซ่อม/ฝังเพิ่มอื่นด้วย → หน้านี้แก้ไม่ได้ (เซฟแล้วฐานข้อมูลลบส่วนนั้น) ให้แก้ที่ /service
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { trimDbTime } from "@/components/service/timeInput";
import type { StationType } from "@/components/service/types";

import { summarizeBaitVisit } from "./baitLogic";

export interface BaitVisitLogItem {
  id: string;
  visitDate: string;
  startTime: string;
  endTime: string;
  summary: string;
  /** มีข้อมูลที่ไม่ใช่กล่อง AG (IG/IC หรืองานซ่อม/ฝังเพิ่ม IG/IC) */
  hasOther: boolean;
}

const LOG_LIMIT = 30;

type LogRow = {
  id: string;
  visit_date: string;
  start_time: string;
  end_time: string;
  station_checks: {
    checked: boolean;
    follow_up_no: number | null;
    stations: { station_no: number | null; type: StationType } | null;
  }[];
  station_works: { kind: string; station_type: StationType; station_nos: number[] }[];
};

/** การเข้า follow_up ของสัญญา (ใหม่→เก่า) พร้อมสรุป */
export async function loadBaitVisits(
  supabase: SupabaseClient,
  contractId: string,
): Promise<{ items: BaitVisitLogItem[]; error: string | null }> {
  const { data, error } = await supabase
    .from("visits")
    .select(
      `id, visit_date, start_time, end_time,
       station_checks ( checked, follow_up_no, stations ( station_no, type ) ),
       station_works ( kind, station_type, station_nos )`,
    )
    .eq("contract_id", contractId)
    .eq("visit_type", "follow_up")
    .order("visit_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LOG_LIMIT);
  if (error) return { items: [], error: error.message };

  const items = ((data ?? []) as unknown as LogRow[]).map((v): BaitVisitLogItem => {
    const followUps: { no: number; f: number | null }[] = [];
    let hasOther = false;
    for (const c of v.station_checks) {
      const s = c.stations;
      if (!s) continue;
      if (s.type !== "AG") {
        if (c.checked) hasOther = true;
        continue;
      }
      if (c.checked && s.station_no !== null) followUps.push({ no: s.station_no, f: c.follow_up_no });
    }
    const installedNos: number[] = [];
    for (const w of v.station_works) {
      if (w.kind === "added" && w.station_type === "AG") installedNos.push(...w.station_nos);
      else hasOther = true;
    }
    return {
      id: v.id,
      visitDate: v.visit_date,
      startTime: trimDbTime(v.start_time),
      endTime: trimDbTime(v.end_time),
      summary: summarizeBaitVisit({ installedNos, followUps }),
      hasOther,
    };
  });
  return { items, error: null };
}
