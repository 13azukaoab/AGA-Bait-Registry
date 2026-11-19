import { describe, expect, it } from "vitest";

import { buildCsv, csvCell, EXPORT_HEADERS, exportFileName, type ExportCtx } from "./historyExport";
import { groupVisits } from "./historyGroups";
import type { AuditRow, HistoryEntry } from "./historyTypes";

const ctx: ExportCtx = {
  branchName: (id) => (id === "b1" ? "ลาดพร้าว" : null),
  personName: (id) => (id === "u1" ? "สมชาย" : null),
  positionLabel: (c) => (c === "supervisor" ? "หัวหน้างาน" : ""),
  contract: (id) => (id === "c1" ? { id: "c1", contractNo: "CT26-1", customerName: '=HYPERLINK("x")' } : null),
  isPostClose: (r) => r.id === "a1",
};

const row: AuditRow = {
  id: "a1",
  tableName: "contracts",
  rowId: null,
  action: "update",
  oldData: { value_total: 50000 },
  newData: { value_total: 55000 },
  changedBy: "u1",
  changedAt: "2026-11-05T07:20:00+00:00",
  branchId: "b1",
  contractId: "c1",
  monthKey: "2026-10",
  actorPositionCode: "supervisor",
};

describe("csvCell", () => {
  it("ครอบคำพูดและ escape เครื่องหมายคำพูด", () => {
    expect(csvCell('a"b')).toBe('"a""b"');
  });
  it("กัน formula injection", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell("+x")).toBe(`"'+x"`);
    expect(csvCell("-x")).toBe(`"'-x"`);
    expect(csvCell("@x")).toBe(`"'@x"`);
  });
  it("null/undefined = ว่าง", () => {
    expect(csvCell(null)).toBe('""');
  });
});

describe("buildCsv", () => {
  const groups = groupVisits([
    { id: "v1", createdBy: "u1", createdAt: "2026-11-05T02:00:00+00:00", branchId: "b1" },
    { id: "v2", createdBy: "u1", createdAt: "2026-11-05T09:00:00+00:00", branchId: "b1" },
  ]);
  const entries: HistoryEntry[] = [{ type: "audit", key: "a:a1", at: row.changedAt, row }, ...groups];
  const csv = buildCsv(entries, ctx, () => "หัวหน้างาน");
  const lines = csv.split("\r\n");

  it("ขึ้นต้นด้วย BOM + หัวตารางครบ", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0].slice(1)).toBe(EXPORT_HEADERS.map((h) => `"${h}"`).join(","));
  });
  it("แถว audit: เวลาไทย · ตำแหน่งตอนแก้ · แก้หลังปิด · ชื่อลูกค้าที่เป็นสูตรถูกกัน", () => {
    expect(lines[1]).toContain(`"2026-11-05","14:20","สมชาย","หัวหน้างาน","ลาดพร้าว","CT26-1","'=HYPERLINK(""x"")"`);
    expect(lines[1]).toContain('"มูลค่า 50,000 → 55,000"');
    expect(lines[1]).toContain('"ใช่","2026-10"');
  });
  it("กลุ่มกรอกปกติ = 1 แถว มีจำนวน", () => {
    expect(lines[2]).toContain('"กรอกผลบริการประจำเดือน 2 รายการ","2"');
    expect(lines[2]).toContain('"09:00–16:00"');
  });
  it("ชื่อไฟล์", () => {
    expect(exportFileName("2026-11-01", "2026-11-07")).toBe("AGA-ประวัติการแก้ไข-2026-11-01_2026-11-07.csv");
  });
});
