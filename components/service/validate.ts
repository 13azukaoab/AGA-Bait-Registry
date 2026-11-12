/**
 * ตรวจฟอร์มก่อนบันทึก (ทำงานฝั่งหน้าจอ · ฐานข้อมูลตรวจซ้ำอีกชั้นเสมอ) — pure function
 *
 * Logic summary (SPEC v1.8 §8.1 "กันลืมกล่อง D10" + "ช่วยผู้ใช้"):
 *   * บังคับ: วันที่ · ทีมอย่างน้อย 1 · เวลาเข้า–ออก (24 ชม. ออกหลังเข้า) · (ลูกค้ายังไม่ตั้งสถานี) จำนวนสถานี
 *   * ไม่บังคับระบุผล IG/IC (เจ้าของตัดสิน 10 พ.ย. — บันทึกได้แม้ไม่พบอะไร) แต่แถวที่เพิ่มต้องครบถูกต้อง
 *   * เลขสถานีตรวจกับ "ชุดเลขที่ใช้งานอยู่" (DECISIONS 2.20 ไม่ใช่ 1..max · ฝังใหม่ใช้เลขเดิมของสถานีที่หาย/ถอนได้)
 *   * กล่อง AG ที่ใช้งานทุกจุด: กรอกผลครบ (เหยื่อ + สัดส่วนปลวก) หรือ "ไม่ได้ตรวจจุดนี้" หรือ "ข้ามทุกจุด"
 *   * กันชนกับกติกาฐานข้อมูล (ไม่งั้นได้ SV001/SV002 ตอนบันทึก):
 *       - ผลตรวจสถานีที่ฟอร์มเดียวกันสั่ง "หาย/ถอนออก" หรือ "ฝังใหม่" ไม่ได้ (สถานีฝังใหม่ตรวจรอบหน้า)
 *       - เลขซ้ำระหว่างแถวงานซ่อมชนิดเดียวกันไม่ได้
 *   * ผลคือ `missing` (รายการ "ยังขาด" กดเลื่อนไปที่ช่อง) + `issues` (ข้อความใต้ช่องรายแถว)
 */
import { parseStationNumbers } from "@/lib/service/stationNumbers";

import { BAIT_CUSTOM_HINT, resolveBait, resolvePowder } from "./bait";
import type { InitPlan } from "./setup";
import { baselineIndex, inUseIndex, type NumberIndex } from "./stationIndex";
import { isValidTime, workTime } from "./timeInput";
import type { FormState, MissingItem, StationRow, WorkRowDb } from "./types";

export interface ValidationContext {
  stations: readonly StationRow[];
  /** งานซ่อมของการเข้านี้ที่บันทึกไว้แล้ว (แก้การเข้าเดิม) */
  savedWorks: readonly WorkRowDb[];
  /** สัญญายังไม่ตั้งสถานี → ใช้ `plan` แทนสถานีที่โหลดมา */
  needsSetup: boolean;
  plan: InitPlan | null;
  /** เดือนที่เลือกในตัวกรอง 'YYYY-MM' */
  month: string;
}

export interface FindingIssue {
  no?: string;
  group?: string;
  bait?: string;
  powder?: string;
}
export interface WorkIssue {
  no?: string;
  detail?: string;
}
export interface AgIssue {
  bait?: string;
  caste?: string;
}

export interface FormIssues {
  missing: MissingItem[];
  findings: Record<string, FindingIssue>;
  timbers: Record<string, string>;
  works: Record<string, WorkIssue>;
  ag: Record<string, AgIssue>;
  /** คำเตือนที่ไม่บล็อกการบันทึก */
  warnings: string[];
  /** ช่องหัวฟอร์มที่ผิด (ไว้ใส่กรอบแดง) */
  header: { date: boolean; teams: boolean; timeIn: boolean; timeOut: boolean };
}

/** เลขสถานีเดี่ยว (พบปลวก) — จำนวนเต็มบวก */
export function parseSingleNumber(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/** ชุดเลขของงานซ่อมแต่ละแถวที่ผ่านการอ่าน (แถวอ่านไม่ได้ = ไม่นับ) */
function workNumbers(noText: string): number[] | null {
  const r = parseStationNumbers(noText);
  return r.ok && r.numbers.length > 0 ? r.numbers : null;
}

export function validateForm(form: FormState, ctx: ValidationContext): FormIssues {
  const out: FormIssues = {
    missing: [],
    findings: {},
    timbers: {},
    works: {},
    ag: {},
    warnings: [],
    header: { date: false, teams: false, timeIn: false, timeOut: false },
  };
  const add = (message: string, field: string) => out.missing.push({ message, field });

  // ---------- หัวฟอร์ม ----------
  if (!form.visitDate) {
    out.header.date = true;
    add("วันที่เข้า", "date");
  } else if (form.visitDate.slice(0, 7) !== ctx.month) {
    out.warnings.push(
      "วันที่เข้าไม่อยู่ในเดือนที่เลือกทางซ้าย — บันทึกได้ แต่รายนี้จะยังขึ้น “ยังไม่กรอก” ของเดือนที่เลือก",
    );
  }
  if (form.teamIds.length === 0) {
    out.header.teams = true;
    add("ทีมที่เข้า (เลือกอย่างน้อย 1 ทีม)", "teams");
  }
  if (!form.timeIn) {
    out.header.timeIn = true;
    add("เวลาเข้า", "timeIn");
  }
  if (!form.timeOut) {
    out.header.timeOut = true;
    add("เวลาออก", "timeOut");
  }
  if (form.timeIn && form.timeOut) {
    const wt = workTime(form.timeIn, form.timeOut);
    if (wt.status === "badFormat") {
      if (!isValidTime(form.timeIn)) out.header.timeIn = true;
      if (!isValidTime(form.timeOut)) out.header.timeOut = true;
      add("เวลาเข้า/ออกต้องเป็นรูปแบบ 24 ชม. เช่น 09:30", "timeIn");
    } else if (wt.status === "notAfter") {
      out.header.timeOut = true;
      add("เวลาออกต้องหลังเวลาเข้า", "timeOut");
    }
  } else {
    if (form.timeIn && !isValidTime(form.timeIn)) out.header.timeIn = true;
    if (form.timeOut && !isValidTime(form.timeOut)) out.header.timeOut = true;
  }

  // ---------- ตั้งสถานีครั้งแรก ----------
  if (ctx.needsSetup) {
    for (const e of ctx.plan?.errors ?? ["ยังไม่ได้ระบุจำนวนสถานี"]) add(e, "setup");
  }

  const index: NumberIndex = ctx.needsSetup && ctx.plan ? ctx.plan.index : inUseIndex(ctx.stations);
  const baseline: NumberIndex =
    ctx.needsSetup && ctx.plan ? ctx.plan.index : baselineIndex(ctx.stations, ctx.savedWorks);

  // ---------- งานซ่อม / ฝังเพิ่ม (ตรวจก่อน เพราะผลตรวจต้องรู้ว่าเลขไหนหาย/ฝังใหม่) ----------
  const removedNos: Record<"IG" | "IC" | "AG", Set<number>> = { IG: new Set(), IC: new Set(), AG: new Set() };
  const addedNos: Record<"IG" | "IC" | "AG", Set<number>> = { IG: new Set(), IC: new Set(), AG: new Set() };
  for (const w of form.works) {
    const nums = workNumbers(w.noText);
    if (!nums) continue;
    const bucket = w.kind === "lost" || w.kind === "withdrawn" ? removedNos : w.kind === "added" ? addedNos : null;
    if (bucket) for (const n of nums) bucket[w.type].add(n);
  }

  let worksBad = 0;
  const seen: Record<string, Set<number>> = {};
  for (const w of form.works) {
    const issue: WorkIssue = {};
    const parsed = parseStationNumbers(w.noText);
    if (w.noText.trim() === "") issue.no = "พิมพ์เลขสถานี";
    else if (!parsed.ok) issue.no = parsed.error;
    else if (parsed.numbers.length === 0) issue.no = "พิมพ์เลขสถานี";
    else {
      const isAdd = w.kind === "added";
      const clash: number[] = [];
      const missingNos: number[] = [];
      for (const n of parsed.numbers) {
        if (isAdd) {
          // ฝังใหม่ใช้เลขเดิมของสถานีที่หาย/ถอนได้ (2.20) แต่ห้ามชนสถานีที่ยังใช้งาน
          const stillUsed = baseline[w.type].has(n) && !removedNos[w.type].has(n);
          if (stillUsed) clash.push(n);
        } else if (!baseline[w.type].has(n)) {
          missingNos.push(n);
        }
      }
      if (clash.length) issue.no = `ซ้ำกับสถานีที่ใช้งานอยู่: ${clash.slice(0, 8).join(", ")}`;
      if (missingNos.length) {
        issue.no = `ไม่พบสถานี ${w.type} เลขนี้ที่ใช้งานอยู่: ${missingNos.slice(0, 8).join(", ")}`;
      }
      // เลขซ้ำระหว่างแถวชนิดเดียวกัน (เช่น หายซ้ำ 2 แถว / ฝังใหม่เลขเดียวกัน 2 แถว)
      const bucketKey = `${w.type}:${w.kind === "added" ? "add" : w.kind === "lost" || w.kind === "withdrawn" ? "rm" : w.kind}`;
      const set = (seen[bucketKey] ??= new Set());
      const dup = parsed.numbers.filter((n) => set.has(n));
      if (dup.length && !issue.no) issue.no = `เลขซ้ำกับแถวอื่น: ${dup.slice(0, 8).join(", ")}`;
      parsed.numbers.forEach((n) => set.add(n));
    }
    if ((w.kind === "lost" || w.kind === "other") && w.detail.trim() === "") {
      issue.detail = w.kind === "lost" ? "ระบุรายละเอียด เช่น อุปกรณ์ไม่พอซ่อมรอบนี้" : "ระบุว่าเกิดอะไรขึ้น";
    }
    if (issue.no || issue.detail) {
      out.works[w.id] = issue;
      worksBad += 1;
    }
  }
  if (worksBad) add(`งานซ่อม/ฝังเพิ่ม: ${worksBad} แถวยังไม่ครบ/ไม่ถูกต้อง`, "works");

  // ---------- พบปลวก ----------
  const blocked = (type: "IG" | "IC", n: number): string | null => {
    if (removedNos[type].has(n)) return "สถานีนี้ถูกบันทึกว่าหาย/ถอนออกในฟอร์มเดียวกัน — ลงผลตรวจไม่ได้";
    if (addedNos[type].has(n)) return "สถานีที่ฝังใหม่ในการเข้านี้ตรวจรอบหน้า (ลงผลตรวจเลยไม่ได้)";
    if (!index[type].has(n)) return `ไม่พบสถานี ${type}-${n} ที่ใช้งานอยู่`;
    return null;
  };

  let findingsBad = 0;
  const seenFinding = new Set<string>();
  for (const f of form.findings) {
    const issue: FindingIssue = {};
    const n = parseSingleNumber(f.noText);
    if (n === null) issue.no = "พิมพ์เลขสถานี (ตัวเลขเดียว)";
    else {
      const b = blocked(f.type, n);
      if (b) issue.no = b;
      else if (seenFinding.has(`${f.type}-${n}`)) issue.no = "สถานีนี้อยู่ในรายการแล้ว";
      seenFinding.add(`${f.type}-${n}`);
    }
    if (f.group === "") issue.group = "เลือกชนิดปลวก";
    else if (f.group === "subterranean") {
      const bait = resolveBait(f.baitSelect, f.baitCustom);
      if (bait.status === "unset") issue.bait = "เลือกปริมาณเหยื่อ";
      else if (bait.status === "invalid") issue.bait = bait.message;
    } else {
      const powder = resolvePowder(f.powderText);
      if (powder.status !== "ok") issue.powder = "ใส่จำนวนจุดเคมีผง (อย่างน้อย 1 จุด)";
    }
    if (Object.keys(issue).length) {
      out.findings[f.key] = issue;
      findingsBad += 1;
    }
  }
  if (findingsBad) add(`พบปลวก: ${findingsBad} แถวยังไม่ครบ/ไม่ถูกต้อง`, "findings");

  // ---------- เปลี่ยนไม้ ----------
  let timbersBad = 0;
  for (const t of form.timbers) {
    const parsed = parseStationNumbers(t.noText);
    let msg: string | undefined;
    if (t.noText.trim() === "" || (parsed.ok && parsed.numbers.length === 0)) msg = "พิมพ์เลขสถานี";
    else if (!parsed.ok) msg = parsed.error;
    else {
      for (const n of parsed.numbers) {
        const b = blocked(t.type, n);
        if (b) {
          msg = `${t.type}-${n}: ${b}`;
          break;
        }
      }
    }
    if (msg) {
      out.timbers[t.key] = msg;
      timbersBad += 1;
    }
  }
  if (timbersBad) add(`เปลี่ยนไม้: ${timbersBad} แถวยังไม่ครบ/ไม่ถูกต้อง`, "timbers");

  // ---------- กล่อง AG (กันลืมกล่อง D10) ----------
  const agMissingNos: number[] = [];
  for (const p of form.ag) {
    if (form.skipAllAg || p.skip) continue;
    const issue: AgIssue = {};
    const bait = resolveBait(p.baitSelect, p.baitCustom);
    if (bait.status === "unset") issue.bait = "เลือกปริมาณเหยื่อ";
    else if (bait.status === "invalid") issue.bait = bait.message || BAIT_CUSTOM_HINT;
    if (p.caste === "") issue.caste = "เลือกสัดส่วนปลวก";
    if (issue.bait || issue.caste) {
      out.ag[p.stationId] = issue;
      agMissingNos.push(p.no ?? 0);
    }
  }
  if (agMissingNos.length) {
    add(
      `กล่อง AG จุดที่ ${agMissingNos.join(", ")} ยังไม่กรอก (หรือติ๊ก “ไม่ได้ตรวจจุดนี้”)`,
      "ag",
    );
  }

  return out;
}
