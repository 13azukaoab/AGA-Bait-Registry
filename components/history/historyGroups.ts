/**
 * รวม "การกรอกผลบริการปกติ" เป็นกลุ่ม + ผสมกับเหตุการณ์จาก audit_log + จัดกลุ่มรายวันสำหรับไทม์ไลน์ (pure)
 *
 * Logic summary:
 *   * กลุ่ม = visits ที่ผู้กรอกคนเดียวกัน (created_by) ในวันไทยเดียวกัน (created_at) → 1 แถว มีจำนวน + ช่วงเวลา
 *     (visits ไม่ลง audit_log ตอน INSERT — DECISIONS 4.3 จึงอ่านจากตาราง visits เอง)
 *   * ผสมรายการ: แสดงเรียงเวลาใหม่→เก่า · ขณะ audit_log ยังมีหน้าถัดไป ให้ซ่อนกลุ่มที่เก่ากว่าแถว audit
 *     ล่าสุดที่โหลดมา — ไม่งั้นกลุ่มเก่าจะโผล่ก่อนเหตุการณ์ audit ที่ยังไม่ได้โหลด แล้วลำดับเวลาผิด
 *   * เทียบเวลาเป็นไมโครวินาที (ค่าดิบ) ไม่ผ่าน Date
 */
import { bangkokDay } from "./historyDiff";
import { tsToMicros } from "./historyClosure";
import type { AuditRow, HistoryEntry, VisitGroupEntry } from "./historyTypes";

export interface VisitStamp {
  id: string;
  createdBy: string | null;
  /** created_at ดิบ */
  createdAt: string;
  branchId: string | null;
}

export function groupVisits(rows: readonly VisitStamp[]): VisitGroupEntry[] {
  const map = new Map<string, VisitGroupEntry>();
  for (const r of rows) {
    const day = bangkokDay(r.createdAt);
    const key = `${r.createdBy ?? "-"}|${day}`;
    const g = map.get(key);
    if (!g) {
      map.set(key, {
        type: "group",
        key: `g:${key}`,
        at: r.createdAt,
        firstAt: r.createdAt,
        userId: r.createdBy,
        day,
        branchIds: r.branchId ? [r.branchId] : [],
        count: 1,
        visitIds: [r.id],
      });
      continue;
    }
    g.count += 1;
    g.visitIds.push(r.id);
    if (tsToMicros(r.createdAt) > tsToMicros(g.at)) g.at = r.createdAt;
    if (tsToMicros(r.createdAt) < tsToMicros(g.firstAt)) g.firstAt = r.createdAt;
    if (r.branchId && !g.branchIds.includes(r.branchId)) g.branchIds.push(r.branchId);
  }
  return [...map.values()].sort((a, b) => tsToMicros(b.at) - tsToMicros(a.at));
}

/**
 * รวมรายการ audit + กลุ่ม เรียงใหม่→เก่า
 * @param hasMoreAudit true = audit_log ยังมีหน้าถัดไป (ใช้ตัดกลุ่มที่เก่ากว่าแถว audit ล่าสุดที่โหลด)
 */
export function mergeEntries(
  audit: readonly AuditRow[],
  groups: readonly VisitGroupEntry[],
  hasMoreAudit: boolean,
): HistoryEntry[] {
  const auditEntries: HistoryEntry[] = audit.map((row) => ({ type: "audit", key: `a:${row.id}`, at: row.changedAt, row }));
  let visibleGroups: readonly VisitGroupEntry[] = groups;
  if (hasMoreAudit && audit.length > 0) {
    const oldest = tsToMicros((audit[audit.length - 1]?.changedAt ?? ""));
    visibleGroups = groups.filter((g) => tsToMicros(g.at) >= oldest);
  }
  return [...auditEntries, ...visibleGroups].sort((a, b) => {
    const d = tsToMicros(b.at) - tsToMicros(a.at);
    if (d !== 0) return d;
    return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
  });
}

export interface DayBucket {
  /** YYYY-MM-DD (เวลาไทย) */
  day: string;
  entries: HistoryEntry[];
}

/** จัดกลุ่มรายวัน (ไทม์ไลน์) — คงลำดับใหม่→เก่าของ entries */
export function bucketByDay(entries: readonly HistoryEntry[]): DayBucket[] {
  const out: DayBucket[] = [];
  for (const e of entries) {
    const day = bangkokDay(e.at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.entries.push(e);
    else out.push({ day, entries: [e] });
  }
  return out;
}
