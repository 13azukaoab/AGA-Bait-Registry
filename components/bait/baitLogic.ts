/**
 * ตรรกะฟอร์ม "กล่อง AG นอกรอบประจำเดือน" (/bait) — pure function ทดสอบได้ (ดู baitLogic.test.ts)
 *
 * Logic summary (mockup #bait FINAL · DECISIONS 2.21, 2.34, 2.38):
 *   * ใช้ `FormState` ชุดเดียวกับ /service แต่มีเฉพาะส่วนกล่อง AG: จุดติดตามผล (F) + กล่องใหม่ (S) ที่อยู่ใน `works`
 *   * `visit_type` = `follow_up` เสมอ (2.38 ง — ไม่มีช่อง "ประเภทรอบ") · เลข F ฐานข้อมูลนับตาม "วันที่เข้าจริง" ไม่ให้กรอก (2.38 ข)
 *   * จุด F "แตะแล้ว" = กรอกเหยื่อ/สัดส่วนปลวก/การกิน หรือเปลี่ยนสถานะ — แตะแล้วต้องครบ (เหยื่อ + สัดส่วนปลวก)
 *   * จุดที่ไม่ได้แตะ = ไม่ได้ตรวจ: ส่ง `{station_id, checked:false}` (ไม่นับเป็นรอบ F) เพราะฐานข้อมูล "กันลืมกล่อง" (SV004)
 *     บังคับให้ทุกจุด AG ที่ใช้งานมีแถวผล
 *   * กล่องใหม่ (S): เหยื่อที่ใส่ต้องเลือก (mockup บังคับ) · ป้ายจุดไม่บังคับ · ไม่นับ F
 *   * วันที่เข้าอยู่ก่อนวันติดตั้ง (`stations.installed_at`) ของจุดที่กรอกผลติดตาม → บันทึกไม่ได้ (2.38 ก) กรอกการติดตั้งก่อน หรือแก้วันที่
 */
import { buildPayload, type BuildResult } from "@/components/service/buildPayload";
import { resolveBait } from "@/components/service/bait";
import { agPointFromStation } from "@/components/service/formState";
import { emptySetup } from "@/components/service/setup";
import type { AgPointState, ContractDetail, FormState, StationRow } from "@/components/service/types";
import { isInUse } from "@/components/service/types";
import { validateForm, type FormIssues } from "@/components/service/validate";

/** สถานะเริ่มต้นของจุด (ก่อนผู้ใช้แก้) — ไว้เทียบว่าเปลี่ยนสถานะหรือยัง */
export function initialStatusChoice(p: AgPointState): AgPointState["statusChoice"] {
  if (p.removedHere) return "removed";
  if (p.statusDb === "active") return "active";
  if (p.statusDb === "pending_removal") return "pending_removal";
  return "locked";
}

/** จุดติดตามผล (F) ที่ผู้ใช้แตะแล้ว */
export function isBaitPointTouched(p: AgPointState): boolean {
  return (
    p.baitSelect !== "" ||
    p.caste !== "" ||
    p.eaten !== "" ||
    (p.statusChoice !== "locked" && p.statusChoice !== initialStatusChoice(p))
  );
}

/** ฟอร์มว่างของการเข้านอกรอบ (วันที่ว่างได้ เมื่อ "บันทึกแล้วเพิ่มอีกวัน") */
export function newBaitForm(
  detail: ContractDetail,
  visitId: string,
  visitDate: string,
  teamIds: readonly string[],
): FormState {
  const ag = detail.stations
    .filter((s) => s.type === "AG" && isInUse(s.status))
    .map(agPointFromStation)
    .sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
  return {
    visitId,
    isExisting: false,
    teamIds: [...teamIds],
    visitDate,
    timeIn: "",
    timeOut: "",
    visitType: "follow_up",
    normal: false,
    findings: [],
    timbers: [],
    works: [],
    ag,
    skipAllAg: false,
    setup: emptySetup(),
  };
}

/** จุดที่ไม่ได้แตะ → ติ๊ก "ไม่ได้ตรวจ" (ส่ง checked:false) · จุดที่ถอดโดยไม่มีผลตรวจและยังเป็น "ถอดแล้ว" คงเดิม */
export function prepareBaitForm(form: FormState): FormState {
  return {
    ...form,
    visitType: "follow_up",
    normal: false,
    findings: [],
    timbers: [],
    skipAllAg: false,
    ag: form.ag.map((p) => (isBaitPointTouched(p) ? { ...p, skip: false } : { ...p, skip: true })),
  };
}

export function buildBaitPayload(form: FormState, contractId: string, stations: readonly StationRow[]): BuildResult {
  return buildPayload(prepareBaitForm(form), contractId, stations);
}

const fmtDmy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

export interface BaitIssues extends FormIssues {
  /** ข้อความเตือนลำดับวันที่ (ก่อนวันติดตั้ง) — แสดงสด และบล็อกการบันทึก */
  order: string[];
}

export function validateBait(
  form: FormState,
  ctx: {
    stations: readonly StationRow[];
    savedWorks: Parameters<typeof validateForm>[1]["savedWorks"];
    savedCheckKeys: ReadonlySet<string>;
  },
): BaitIssues {
  const prepared = prepareBaitForm(form);
  // เดือนอ้างอิงของ validateForm ใช้เฉพาะเตือน "วันที่ไม่อยู่ในเดือนที่เลือก" — หน้านอกรอบไม่มีเดือน จึงใช้เดือนของวันที่เอง
  const base = validateForm(prepared, {
    stations: ctx.stations,
    savedWorks: ctx.savedWorks,
    needsSetup: false,
    plan: null,
    month: form.visitDate.slice(0, 7),
    savedCheckKeys: ctx.savedCheckKeys,
  });
  // ข้อความกล่อง AG ของ validateForm พูดถึง "ไม่ได้ตรวจจุดนี้" ซึ่งหน้านี้ไม่มี → ใช้ข้อความของหน้านี้แทน
  const missing = base.missing.filter((m) => m.field !== "ag");
  const touched = prepared.ag.filter((p) => !p.skip);

  const incomplete = touched.filter((p) => base.ag[p.stationId]);
  if (incomplete.length > 0) {
    missing.push({
      message: `กล่อง AG จุดที่ ${incomplete.map((p) => p.no ?? "?").join(", ")} ยังไม่ครบ (ต้องมีปริมาณเหยื่อ + สัดส่วนปลวก)`,
      field: "ag",
    });
  }

  // กล่องใหม่ (S): ต้องเลือกเหยื่อที่ใส่ (mockup #bait FINAL — ข้อมูลติดตั้ง)
  const newBoxes = form.works.filter((w) => w.type === "AG" && w.kind === "added");
  let newBoxBad = 0;
  const savedWorkIds = new Set(ctx.savedWorks.map((sw) => sw.id));
  for (const w of newBoxes) {
    // แถวที่บันทึกไว้แล้ว (แก้การเข้าเดิม) ไม่บังคับเหยื่อซ้ำ — ค่าเดิมอาจว่าง (ติดจาก /service) หรือกล่องถูกถอดไปแล้ว
    if (savedWorkIds.has(w.id)) continue;
    const bait = resolveBait(w.baitSelect ?? "", w.baitCustom ?? "");
    if (bait.status === "ok") continue;
    newBoxBad += 1;
    base.works[w.id] = {
      ...base.works[w.id],
      bait: bait.status === "invalid" ? bait.message : "เลือกปริมาณเหยื่อที่ใส่",
    };
  }
  if (newBoxBad > 0) missing.push({ message: `กล่องใหม่ (S): ${newBoxBad} จุดยังไม่ได้เลือกเหยื่อที่ใส่`, field: "ag" });

  const nothingFilled = touched.length === 0 && newBoxes.length === 0;
  if (nothingFilled) missing.push({ message: "กล่อง AG ยังไม่ได้กรอกเลย — กรอกผลติดตามสักจุด หรือติดกล่องใหม่ (S)", field: "ag" });

  // ลำดับวันที่: วันที่เข้าอยู่ก่อนวันติดตั้งของจุดที่กรอกผลติดตาม (F)
  const order: string[] = [];
  if (form.visitDate) {
    for (const p of touched) {
      const station = ctx.stations.find((s) => s.id === p.stationId);
      const installed = station?.installedAt ?? null;
      if (installed && form.visitDate < installed) {
        order.push(
          `จุดที่ ${p.no ?? "?"} ติดตั้งเมื่อ ${fmtDmy(installed)} — วันที่เข้านี้อยู่ก่อนหน้านั้น กรอกการติดตั้งก่อน หรือแก้วันที่`,
        );
      }
    }
  }
  for (const msg of order) missing.push({ message: msg, field: "date" });

  return { ...base, missing, order, warnings: base.warnings.filter((w) => !w.includes("ไม่อยู่ในเดือนที่เลือก")) };
}

/** ข้อความสรุปของการเข้านอกรอบ 1 ครั้ง (ไว้โชว์ในรายการที่กรอกแล้ว) */
export function summarizeBaitVisit(parts: { installedNos: readonly number[]; followUps: readonly { no: number; f: number | null }[] }): string {
  const t: string[] = [];
  if (parts.installedNos.length > 0) t.push(`ติดกล่องใหม่ (S) จุดที่ ${[...parts.installedNos].sort((a, b) => a - b).join(", ")}`);
  const fs = parts.followUps
    .filter((x) => x.f !== null)
    .sort((a, b) => a.no - b.no)
    .map((x) => `F${x.f} จุดที่ ${x.no}`);
  if (fs.length > 0) t.push(`ติดตามผล ${fs.join(", ")}`);
  return t.join(" · ") || "ไม่ได้ตรวจกล่องใด";
}
