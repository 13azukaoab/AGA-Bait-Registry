/**
 * สร้างข้อมูลสำหรับแสดงหน้า /material จากข้อมูลดิบที่ `materialData.ts` โหลดมา (pure function · ทดสอบได้)
 *
 * Logic summary:
 *   * ตัวกรองสาขา: `branchId` = null → ทุกสาขาที่สิทธิ์เห็น · กรองทั้งเดือนนี้และเดือนก่อน (เทียบกันบนฐานเดียวกัน)
 *   * ตารางแยกสาขา: ทุกสาขาที่มีการเข้าในเดือนนี้หรือเดือนก่อน · % เทียบเดือนก่อนคิดจากเหยื่อรวม (นอก+ใน)
 *   * ก./กล่อง AG = เหยื่อใน AG ÷ กล่อง AG ที่ตรวจจริงในเดือนนั้น (M25) · เดือนก่อนใช้ `checkedPrev`
 *   * ภาระงานรายทีม: เวลาทำงานรวม (นาที) ของทุกการเข้าที่ทีมนั้นร่วม — เข้าพร้อมหลายทีมนับเวลาเต็มให้ทุกทีม (SPEC · เจ้าของตัดสิน 12 พ.ย.)
 *     เกณฑ์ผ่าน `thresholdForTeam` (จุดเดียว) · แสดงทีมที่มีงานในเดือน หรือตั้งจำนวนคนแล้ว (ทีมปิดและไม่มีงานไม่แสดง)
 */
import type { AgBoxRow, BranchInfo, MaterialPageData, TeamInfo } from "./materialData";
import {
  baitTotalG,
  breakdownByCustomer,
  countInternalInspection,
  inspectionByKey,
  type InspectionCount,
  breakdownByWork,
  gramsPerAgBox,
  pctChange,
  sumByBranch,
  sumMaterials,
  type CustomerBreakdown,
  type MaterialVisit,
  type Materials,
  type WorkBreakdown,
} from "./logic";
import { evaluateWorkload, thresholdForTeam, type WorkloadResult } from "./workload";

export interface BranchRow {
  branch: BranchInfo;
  now: Materials;
  baitPctVsPrev: number | null;
  agChecked: number;
  gPerAgBox: number | null;
  gPerAgBoxPrev: number | null;
}

export interface TeamRow {
  team: TeamInfo;
  visits: number;
  minutes: number;
  workload: WorkloadResult;
}

export interface InspectionBranchRow {
  branch: BranchInfo;
  count: InspectionCount;
}

export interface InspectionTeamRow {
  team: TeamInfo;
  count: InspectionCount;
}

export interface MaterialView {
  inspection: InspectionCount;
  inspectionPrev: InspectionCount;
  inspectionByBranch: InspectionBranchRow[];
  inspectionByTeam: InspectionTeamRow[];
  work: WorkBreakdown;
  workPrev: WorkBreakdown;
  customer: CustomerBreakdown;
  customerPrev: CustomerBreakdown;
  all: Materials;
  allPrev: Materials;
  branches: BranchRow[];
  teams: TeamRow[];
  truncated: boolean;
}

function inBranch(v: MaterialVisit, branchId: string | null): boolean {
  return branchId === null || v.branchId === branchId;
}

export function buildMaterialView(data: MaterialPageData, branchId: string | null): MaterialView {
  const cur = data.current.visits.filter((v) => inBranch(v, branchId));
  const prev = data.previous.visits.filter((v) => inBranch(v, branchId));

  const curByBranch = sumByBranch(cur);
  const prevByBranch = sumByBranch(prev);
  const agByBranch = new Map<string, AgBoxRow>(data.agBoxes.map((a) => [a.branchId, a]));

  const branches: BranchRow[] = data.branches
    .filter((b) => curByBranch.has(b.id) || prevByBranch.has(b.id))
    .map((branch) => {
      const now = curByBranch.get(branch.id) ?? sumMaterials([]);
      const before = prevByBranch.get(branch.id);
      const ag = agByBranch.get(branch.id);
      return {
        branch,
        now,
        baitPctVsPrev: pctChange(baitTotalG(now), before ? baitTotalG(before) : null),
        agChecked: ag?.checked ?? 0,
        gPerAgBox: gramsPerAgBox(now.insideG, ag?.checked ?? 0),
        gPerAgBoxPrev: before && ag ? gramsPerAgBox(before.insideG, ag.checkedPrev) : null,
      };
    });

  const teams: TeamRow[] = data.teams
    .map((team) => {
      const mine = cur.filter((v) => v.teamIds.includes(team.id));
      const minutes = mine.reduce((s, v) => s + (v.durationMin ?? 0), 0);
      return {
        team,
        visits: mine.length,
        minutes,
        workload: evaluateWorkload(minutes, team.headcount, thresholdForTeam(team.id, data.thresholds)),
      };
    })
    .filter((r) => r.visits > 0 || (r.team.isActive && r.team.headcount > 0));

  const insBranch = inspectionByKey(cur, (v) => [v.branchId]);
  const insTeam = inspectionByKey(cur, (v) => v.teamIds);

  return {
    inspection: countInternalInspection(cur),
    inspectionPrev: countInternalInspection(prev),
    inspectionByBranch: data.branches.flatMap((branch) => {
      const count = insBranch.get(branch.id);
      return count ? [{ branch, count }] : [];
    }),
    inspectionByTeam: data.teams.flatMap((team) => {
      const count = insTeam.get(team.id);
      return count ? [{ team, count }] : [];
    }),
    work: breakdownByWork(cur),
    workPrev: breakdownByWork(prev),
    customer: breakdownByCustomer(cur),
    customerPrev: breakdownByCustomer(prev),
    all: sumMaterials(cur),
    allPrev: sumMaterials(prev),
    branches,
    teams,
    truncated: data.current.truncated || data.previous.truncated,
  };
}
