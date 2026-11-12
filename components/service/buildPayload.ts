/**
 * ฟอร์ม → ข้อมูลส่ง RPC `save_service_visit(p jsonb)` — pure function
 * (ฟิลด์ครบตามหัวไฟล์ migration 20261112150000_service_works_rpc.sql)
 *
 * Logic summary:
 *   * 1 สถานี = 1 แถวผลตรวจต่อการเข้า — "พบปลวก" กับ "เปลี่ยนไม้" ของสถานีเดียวกันรวมเป็นแถวเดียว
 *     (ส่ง 2 แถวสถานีเดียว = ON CONFLICT ซ้ำในคำสั่งเดียว → Postgres 21000)
 *   * เลขสถานีที่พิมพ์ → station id ผ่านสถานีที่ "ใช้งานอยู่" ที่โหลดมา (หาไม่เจอ = ข้อผิดพลาดของหน้าจอ ไม่ส่ง)
 *   * ปลวกสวน: `powder_points` ≥ 1 และ `bait_added_g` = null · ปลวกใต้ดิน: `powder_points` = null
 *   * "ไม่ได้ตรวจจุดนี้" = `{ station_id, checked: false }` ล้วน (ฐานข้อมูล CHECK ห้ามมีผลอื่น)
 *   * "ไม่พบปลวก" (AG) = `termite_caste: null`
 *   * งานซ่อม: แถวที่โหลดจากฐานข้อมูลส่ง id/kind/type/nos เดิมเป๊ะ (เปลี่ยนแม้นิดเดียว ฐานข้อมูลย้อนผลแล้วทำใหม่ →
 *     อาจได้ SV005) · แถวใหม่ id = uuid ที่ฟอร์มสร้างไว้ · เรียง "ไม่ใช่ฝังใหม่" ก่อน "ฝังใหม่" (กรณีหาย IG-5 แล้วฝัง IG-5 ใหม่)
 *   * สถานะจุด AG ส่งเฉพาะจุดที่เปลี่ยน (active / pending_removal / removed)
 *   * ป้ายจุดส่งเฉพาะจุดที่เปลี่ยน
 *   * เวลาส่ง HH:MM
 *   * `deferRemoval` (ตัวสำรอง): ถ้าฐานข้อมูลปฏิเสธผลตรวจของจุดที่ถอดในครั้งเดียวกัน (SV001) → ส่ง 2 ครั้ง
 *     ครั้งแรกยังไม่เปลี่ยนเป็น "ถอดแล้ว" ครั้งที่สองเปลี่ยนสถานะ (visit_id เดิม = แก้การเข้าเดิม)
 */
import { parseStationNumbers } from "@/lib/service/stationNumbers";

import { resolveBait, resolveEaten, resolvePowder } from "./bait";
import { parseSingleNumber } from "./validate";
import type { AgPointState, FormState, StationRow, StationType } from "./types";
import { isInUse } from "./types";

export interface CheckPayload {
  station_id: string;
  checked: boolean;
  termite_group: "subterranean" | "garden" | null;
  termite_caste: string | null;
  bait_added_g: number | null;
  bait_eaten_pct: number | null;
  powder_points: number | null;
  timber_replaced: boolean;
}

export interface SavePayload {
  visit_id: string;
  contract_id: string;
  visit_date: string;
  visit_type: string;
  start_time: string;
  end_time: string;
  team_ids: string[];
  works: { id: string; kind: string; station_type: StationType; station_nos: number[]; detail: string | null }[];
  checks: (CheckPayload | { station_id: string; checked: false })[];
  station_labels: { station_id: string; point_label: string }[];
  station_statuses: { station_id: string; status: "active" | "pending_removal" | "removed" }[];
  skip_all_ag: boolean;
}

export type BuildResult = { ok: true; payload: SavePayload } | { ok: false; error: string };

const AG_STATUS_MAP = { active: "active", pending_removal: "pending_removal", removed: "removed" } as const;

function stationKey(type: StationType, no: number): string {
  return `${type}-${no}`;
}

export function buildPayload(
  form: FormState,
  contractId: string,
  stations: readonly StationRow[],
  options: { includeRemoval?: boolean } = {},
): BuildResult {
  const includeRemoval = options.includeRemoval ?? true;

  const idByKey = new Map<string, string>();
  for (const s of stations) {
    if (s.no !== null && isInUse(s.status)) idByKey.set(stationKey(s.type, s.no), s.id);
  }
  const lookup = (type: StationType, no: number): string | null => idByKey.get(stationKey(type, no)) ?? null;

  const merged = new Map<string, CheckPayload>();
  const ensure = (id: string): CheckPayload => {
    let c = merged.get(id);
    if (!c) {
      c = {
        station_id: id,
        checked: true,
        termite_group: null,
        termite_caste: null,
        bait_added_g: null,
        bait_eaten_pct: null,
        powder_points: null,
        timber_replaced: false,
      };
      merged.set(id, c);
    }
    return c;
  };

  // ---------- พบปลวก ----------
  for (const f of form.findings) {
    const no = parseSingleNumber(f.noText);
    if (no === null) return { ok: false, error: `เลขสถานี "${f.noText}" ไม่ถูกต้อง` };
    const id = lookup(f.type, no);
    if (!id) return { ok: false, error: `ไม่พบสถานี ${f.type}-${no} ที่ใช้งานอยู่` };
    if (f.group === "") return { ok: false, error: `สถานี ${f.type}-${no} ยังไม่ได้เลือกชนิดปลวก` };
    const c = ensure(id);
    c.termite_group = f.group;
    if (f.group === "subterranean") {
      const bait = resolveBait(f.baitSelect, f.baitCustom);
      if (bait.status !== "ok") return { ok: false, error: `สถานี ${f.type}-${no} ยังไม่ได้ระบุปริมาณเหยื่อ` };
      c.bait_added_g = bait.grams;
      c.bait_eaten_pct = resolveEaten(f.eaten);
      c.powder_points = null;
    } else {
      const powder = resolvePowder(f.powderText);
      if (powder.status !== "ok") return { ok: false, error: `สถานี ${f.type}-${no} ยังไม่ได้ระบุจำนวนจุดเคมีผง` };
      c.powder_points = powder.points;
      c.bait_added_g = null;
      c.bait_eaten_pct = null;
    }
  }

  // ---------- เปลี่ยนไม้ (รวมเข้าแถวเดียวกับสถานีเดียวกัน) ----------
  for (const t of form.timbers) {
    const parsed = parseStationNumbers(t.noText);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    for (const no of parsed.numbers) {
      const id = lookup(t.type, no);
      if (!id) return { ok: false, error: `ไม่พบสถานี ${t.type}-${no} ที่ใช้งานอยู่` };
      ensure(id).timber_replaced = true;
    }
  }

  // ---------- กล่อง AG ----------
  const checks: SavePayload["checks"] = [...merged.values()];
  const labels: SavePayload["station_labels"] = [];
  const statuses: SavePayload["station_statuses"] = [];

  for (const p of form.ag) {
    const trimmed = p.label.trim();
    if (trimmed !== p.labelDb.trim()) labels.push({ station_id: p.stationId, point_label: trimmed });

    const status = agStatusToSend(p, includeRemoval);
    if (status) statuses.push({ station_id: p.stationId, status });

    if (form.skipAllAg) continue; // ฐานข้อมูลใส่แถว "ไม่ได้ตรวจ" ให้ทุกจุดเอง
    if (p.skip) {
      checks.push({ station_id: p.stationId, checked: false });
      continue;
    }
    const bait = resolveBait(p.baitSelect, p.baitCustom);
    if (bait.status !== "ok") return { ok: false, error: `กล่อง AG จุดที่ ${p.no ?? "?"} ยังไม่ได้ระบุปริมาณเหยื่อ` };
    if (p.caste === "") return { ok: false, error: `กล่อง AG จุดที่ ${p.no ?? "?"} ยังไม่ได้เลือกสัดส่วนปลวก` };
    checks.push({
      station_id: p.stationId,
      checked: true,
      termite_group: null,
      termite_caste: p.caste === "none" ? null : p.caste,
      bait_added_g: bait.grams,
      bait_eaten_pct: resolveEaten(p.eaten),
      powder_points: null,
      timber_replaced: false,
    });
  }

  // ---------- งานซ่อม / ฝังเพิ่ม ----------
  const works: SavePayload["works"] = [];
  for (const w of form.works) {
    const parsed = parseStationNumbers(w.noText);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (parsed.numbers.length === 0) return { ok: false, error: "งานซ่อมมีแถวที่ยังไม่ได้พิมพ์เลขสถานี" };
    const detail = w.detail.trim();
    works.push({
      id: w.id,
      kind: w.kind,
      station_type: w.type,
      station_nos: parsed.numbers,
      detail: detail === "" ? null : detail,
    });
  }
  // ไม่ใช่ฝังใหม่ ก่อน ฝังใหม่ (sort เสถียร — คงลำดับเดิมในกลุ่ม)
  works.sort((a, b) => Number(a.kind === "added") - Number(b.kind === "added"));

  return {
    ok: true,
    payload: {
      visit_id: form.visitId,
      contract_id: contractId,
      visit_date: form.visitDate,
      visit_type: form.visitType,
      start_time: form.timeIn,
      end_time: form.timeOut,
      team_ids: [...new Set(form.teamIds)],
      works,
      checks,
      station_labels: labels,
      station_statuses: statuses,
      skip_all_ag: form.skipAllAg,
    },
  };
}

/**
 * ข้อมูลกล่อง AG ใหม่ (S) ที่ผู้ใช้กรอก (เหยื่อที่ใส่ + ป้ายจุด) เตรียมไว้พร้อมส่ง — ยังไม่ต่อเข้า payload
 * จนกว่า BE (M13) กำหนดชื่อ field และเปิด `SEND_NEW_AG_DETAILS` ใน featureFlags.ts
 * อ้างด้วยเลขสถานี (ฐานข้อมูลสร้าง station id ฝั่งเซิร์ฟเวอร์) · ไม่มี % กิน (เพิ่งใส่เหยื่อ)
 */
export function newAgDetails(form: FormState): { station_no: number; bait_added_g: number | null; point_label: string | null }[] {
  const out: { station_no: number; bait_added_g: number | null; point_label: string | null }[] = [];
  for (const w of form.works) {
    if (w.type !== "AG" || w.kind !== "added") continue;
    const nums = parseStationNumbers(w.noText);
    if (!nums.ok) continue;
    const bait = resolveBait(w.baitSelect ?? "", w.baitCustom ?? "");
    const label = (w.label ?? "").trim();
    for (const n of nums.numbers) {
      out.push({ station_no: n, bait_added_g: bait.status === "ok" ? bait.grams : null, point_label: label === "" ? null : label });
    }
  }
  return out;
}

/** สถานะที่ต้องส่ง (null = ไม่เปลี่ยน/ไม่ส่ง) */
function agStatusToSend(
  p: AgPointState,
  includeRemoval: boolean,
): "active" | "pending_removal" | "removed" | null {
  if (p.statusChoice === "locked") return null;
  const next = AG_STATUS_MAP[p.statusChoice];
  if (next === p.statusDb) return null;
  if (next === "removed" && !includeRemoval) return null;
  return next;
}

/** สถานะ "ถอดแล้ว" ที่ผู้ใช้เลือกไว้ในครั้งนี้ (ใช้ตัดสินว่าต้องทำ 2 ขั้นตอนสำรองไหม) */
export function hasPendingRemoval(form: FormState): boolean {
  return form.ag.some((p) => agStatusToSend(p, true) === "removed");
}
