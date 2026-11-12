/**
 * สร้างค่าเริ่มต้นของฟอร์ม (การเข้าใหม่ / แก้การเข้าเดิม) — pure function
 *
 * Logic summary:
 *   * การเข้าใหม่: `visit_id` สร้างฝั่งหน้าจอตั้งแต่เปิดฟอร์ม (crypto.randomUUID) — กดบันทึกซ้ำ = แก้ครั้งเดิม ไม่เกิดรายการซ้ำ
 *     · ทีมเติมจากการเข้าครั้งล่าสุดของสัญญา (ไม่มี = ว่าง ต้องเลือกเอง) · วันที่ = วันนี้ถ้าอยู่ในเดือนที่เลือก ไม่งั้นวันที่ 1
 *   * แก้การเข้าเดิม: โหลดทีม/ผลตรวจ/งานซ่อมของการเข้านั้น — งานซ่อมคง id เดิม
 *       - จุดกล่อง AG = กล่องที่ยังใช้งาน + กล่องที่มีผลตรวจในการเข้านี้อยู่แล้ว (แม้ตอนนี้ถอดแล้ว) เพื่อไม่ให้บันทึกซ้ำ
 *         แล้วผลตรวจถูกลบ (ฐานข้อมูลลบผลตรวจที่ไม่ได้ส่งมา)
 *       - ผลตรวจ IG/IC → แถว "พบปลวก" (มีชนิดปลวก/เหยื่อ/เคมีผง) และ/หรือ "เปลี่ยนไม้"
 *   * เลข F ของ AG: บันทึกแล้ว = ค่าจากฐานข้อมูล · ยังไม่บันทึก = F ถัดไปโดยประมาณ (ระบบนับจริงตอนบันทึก)
 */
import { baitToSelect, eatenToSelect } from "./bait";
import { emptySetup } from "./setup";
import type {
  AgHistory,
  AgPointState,
  AgStatusChoice,
  ContractDetail,
  FindingRow,
  FormState,
  LoadedVisit,
  StationRow,
  TimberRow,
  WorkRow,
} from "./types";
import { isInUse } from "./types";
import { formatStationNumbers } from "@/lib/service/stationNumbers";

let counter = 0;
/** key ของแถวใน React (ไม่ใช่ข้อมูลที่บันทึก) */
export function rowKey(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function defaultVisitDate(month: string, today: string): string {
  return today.slice(0, 7) === month ? today : `${month}-01`;
}

/** F ถัดไปโดยประมาณของกล่อง AG = 1 + จำนวนผลตรวจที่ตรวจจริงก่อนวันที่เข้า (ตามกติกา F ของฐานข้อมูล) */
export function nextFollowUp(history: AgHistory | undefined, visitDate: string): number {
  if (!history || !visitDate) return 1;
  return 1 + history.checks.filter((c) => c.visitDate < visitDate).length;
}

function statusChoiceOf(station: StationRow): AgPointState["statusChoice"] {
  if (station.status === "active") return "active";
  if (station.status === "pending_removal") return "pending_removal";
  return "locked";
}

export function agPointFromStation(station: StationRow): AgPointState {
  return {
    stationId: station.id,
    no: station.no,
    statusDb: station.status,
    statusChoice: statusChoiceOf(station),
    label: station.pointLabel,
    labelDb: station.pointLabel,
    skip: false,
    baitSelect: "",
    baitCustom: "",
    eaten: "",
    caste: "",
    savedFollowUpNo: null,
  };
}

function byNo(a: { no: number | null }, b: { no: number | null }): number {
  return (a.no ?? 0) - (b.no ?? 0);
}

export function newVisitForm(
  detail: ContractDetail,
  month: string,
  today: string,
): FormState {
  // Renew ที่ยังไม่ตั้งสถานี: กล่อง AG ของสัญญาเก่าที่จะย้ายมา ต้องกรอกผลในครั้งนี้ด้วย (กันลืมกล่อง D10)
  const ag = [...detail.stations, ...detail.oldStations]
    .filter((s) => s.type === "AG" && isInUse(s.status))
    .map(agPointFromStation)
    .sort(byNo);
  return {
    visitId: newId(),
    isExisting: false,
    teamIds: [...detail.lastTeamIds],
    visitDate: defaultVisitDate(month, today),
    timeIn: "",
    timeOut: "",
    visitType: "routine",
    normal: false,
    findings: [],
    timbers: [],
    works: [],
    ag,
    skipAllAg: false,
    setup: emptySetup(),
  };
}

export function formFromVisit(detail: ContractDetail, visit: LoadedVisit): FormState {
  const stationById = new Map(detail.stations.map((s) => [s.id, s]));
  const checkByStation = new Map(visit.checks.map((c) => [c.stationId, c]));

  // ---------- IG / IC ----------
  const findings: FindingRow[] = [];
  const timberNos: Record<"IG" | "IC", number[]> = { IG: [], IC: [] };
  for (const c of visit.checks) {
    const s = stationById.get(c.stationId);
    if (!s || s.type === "AG" || s.no === null || !c.checked) continue;
    if (c.termiteGroup || c.baitAddedG !== null || c.powderPoints !== null) {
      const bait = baitToSelect(c.baitAddedG);
      findings.push({
        key: rowKey("f"),
        type: s.type,
        noText: String(s.no),
        group: c.termiteGroup ?? "",
        baitSelect: bait.select,
        baitCustom: bait.custom,
        eaten: eatenToSelect(c.baitEatenPct),
        powderText: c.powderPoints === null ? "" : String(c.powderPoints),
      });
    }
    if (c.timberReplaced) timberNos[s.type].push(s.no);
  }
  findings.sort((a, b) => a.type.localeCompare(b.type) || Number(a.noText) - Number(b.noText));
  const timbers: TimberRow[] = (["IG", "IC"] as const)
    .filter((t) => timberNos[t].length > 0)
    .map((t) => ({ key: rowKey("t"), type: t, noText: formatStationNumbers(timberNos[t]) }));

  // ---------- AG: ที่ยังใช้งาน + ที่มีผลตรวจในการเข้านี้แล้ว ----------
  const ag: AgPointState[] = detail.stations
    .filter((s) => s.type === "AG" && (isInUse(s.status) || checkByStation.has(s.id)))
    .map((s) => {
      const point = agPointFromStation(s);
      const c = checkByStation.get(s.id);
      if (c) {
        if (!c.checked) point.skip = true;
        else {
          const bait = baitToSelect(c.baitAddedG);
          point.baitSelect = bait.select;
          point.baitCustom = bait.custom;
          point.eaten = eatenToSelect(c.baitEatenPct);
          point.caste = c.termiteCaste ?? "none";
          point.savedFollowUpNo = c.followUpNo;
        }
      }
      return point;
    })
    .sort(byNo);

  const works: WorkRow[] = visit.works.map((w) => ({
    id: w.id,
    kind: w.kind,
    type: w.stationType,
    noText: formatStationNumbers(w.stationNos),
    detail: w.detail,
  }));

  return {
    visitId: visit.id,
    isExisting: true,
    teamIds: [...visit.teamIds],
    visitDate: visit.visitDate,
    timeIn: visit.startTime,
    timeOut: visit.endTime,
    visitType: visit.visitType,
    normal: false,
    findings,
    timbers,
    works,
    ag,
    skipAllAg: false,
    setup: emptySetup(),
  };
}

/** ป้ายสถานะที่ผู้ใช้เลือกบนจุด AG แปลงจากสถานะในฐานข้อมูล (ใช้แสดงชิป) */
export function statusLabel(choice: AgPointState["statusChoice"], db: AgPointState["statusDb"]): string {
  if (choice === "locked") {
    if (db === "removed") return "ถอดแล้ว";
    if (db === "eliminated") return "กำจัดแล้ว";
    return "ไม่ใช้งาน";
  }
  const map: Record<AgStatusChoice, string> = {
    active: "กำลังติดตาม",
    pending_removal: "รอถอด",
    removed: "ถอดแล้ว",
  };
  return map[choice];
}
