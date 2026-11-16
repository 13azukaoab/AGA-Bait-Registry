/**
 * M26/M33 — หน้าเปิดงาน: งานเก่าที่มีทีมปิด / ทีม Sup อยู่แล้ว
 *   * ตัวเลือกยังโชว์ชื่อทีมเดิม · บันทึกส่งชุดทีมเดิมกลับครบ (ไม่ทิ้งเงียบๆ) · ทีมแบบนี้เพิ่มใหม่ไม่ได้
 */
import { describe, expect, it } from "vitest";

import type { BranchOption } from "./branchMatch";
import { draftFromSaved } from "./editRow";
import { buildSaveParams } from "./savePayload";
import type { SavedContract } from "./types";
import { isTeamAssignableToContract, teamsForPicker } from "@/lib/service/teamKind";

const branches: BranchOption[] = [{ id: "b1", name: "นครปฐม", zoneId: "z1", zoneName: "เขต 1" }];
const master = { branches };

const A = { id: "tA", code: "A", kind: "service" as const, isActive: true };
const OLD = { id: "tO", code: "O", kind: "service" as const, isActive: false };
const SUP = { id: "tS", code: "Sup", kind: "supervisor" as const, isActive: true };
const TEAMS = [A, OLD, SUP];

const saved: SavedContract = {
  contractId: "c1",
  customerId: "u1",
  contractNo: "CT26-0000001",
  customerName: "บจก. ตัวอย่าง",
  customerTypeCode: "B",
  branchId: "b1",
  saleType: "new",
  status: "active",
  sellerName: "พนักงานขาย",
  sellerRole: "sale",
  isUrgent: false,
  renewedFrom: null,
  renewUnlinkedReason: null,
  mailReceivedDate: "2026-10-01",
  firstServiceDate: "2026-10-10",
  firstServiceTime: "09:30",
  note: "",
  startDate: "2026-10-01",
  endDate: "2027-09-30",
  termYears: 1,
  valueTotal: 99510,
  teamIds: [A.id, OLD.id, SUP.id],
  files: [],
  auditCount: 1,
  updatedAt: "2026-11-12T10:00:00.123456+00:00",
  auditCountFailed: false,
};

const values = { branchId: "b1", termYears: 1, valueTotal: 99510, endDate: "2027-09-30" };

describe("หน้าเปิดงาน — งานเก่าที่มีทีมปิด/Sup", () => {
  it("แถวใหม่: ตัวเลือกไม่มีทีมปิดและ Sup", () => {
    expect(teamsForPicker(TEAMS, [], isTeamAssignableToContract).map((t) => t.code)).toEqual(["A"]);
  });

  it("แถวที่โหลดมาแก้: ตัวเลือกยังโชว์ชื่อทีมเดิมครบ", () => {
    const d = draftFromSaved(saved, master);
    expect(teamsForPicker(TEAMS, d.teamIds, isTeamAssignableToContract).map((t) => t.code)).toEqual(["A", "O", "Sup"]);
  });

  it("บันทึกโดยไม่แตะทีม: ส่งชุดทีมเดิมกลับครบ (DB ไม่นับเป็นทีมเพิ่มใหม่ → ผ่าน)", () => {
    const d = draftFromSaved(saved, master);
    const p = buildSaveParams(d, values, { contractId: "c1", expectedUpdatedAt: saved.updatedAt });
    expect(p.p_team_ids).toEqual([A.id, OLD.id, SUP.id]);
  });

  it("ติ๊กทีมปิดออกแล้วบันทึก: ส่งชุดที่เหลือ (ผู้ใช้เอาออกเอง ไม่ใช่ทิ้งเงียบ) · ทีมนั้นกลับมาเลือกไม่ได้", () => {
    const d = draftFromSaved(saved, master);
    const after = d.teamIds.filter((id) => id !== OLD.id);
    const p = buildSaveParams({ ...d, teamIds: after }, values, { contractId: "c1", expectedUpdatedAt: saved.updatedAt });
    expect(p.p_team_ids).toEqual([A.id, SUP.id]);
    expect(teamsForPicker(TEAMS, after, isTeamAssignableToContract).map((t) => t.code)).toEqual(["A", "Sup"]);
  });
});
