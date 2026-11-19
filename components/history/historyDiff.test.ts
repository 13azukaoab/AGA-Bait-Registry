import { describe, expect, it } from "vitest";

import { bangkokDay, describeAudit, diffRecord, formatThaiDateTime, formatValue, type FormatCtx } from "./historyDiff";
import type { AuditRow } from "./historyTypes";

const BR = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ctx: FormatCtx = {
  branchName: (id) => (id === BR ? "ลาดพร้าว" : null),
  personName: (id) => (id === USER ? "สมชาย" : null),
};

function row(p: Partial<AuditRow>): AuditRow {
  return {
    id: "a1",
    tableName: "contracts",
    rowId: null,
    action: "update",
    oldData: null,
    newData: null,
    changedBy: null,
    changedAt: "2026-11-05T07:20:00.000000+00:00",
    branchId: null,
    contractId: null,
    monthKey: null,
    actorPositionCode: null,
    ...p,
  };
}

describe("เวลาไทย", () => {
  it("แปลง UTC เป็นเวลาไทย (+7) และข้ามวันได้", () => {
    expect(formatThaiDateTime("2026-11-05T07:20:00+00:00")).toBe("5 พ.ย. 14:20");
    expect(bangkokDay("2026-11-05T18:30:00+00:00")).toBe("2026-11-06");
  });
});

describe("formatValue", () => {
  it("ตัวเลขใส่จุลภาค boolean เป็นใช่/ไม่ใช่ ว่างเป็น 'ว่าง'", () => {
    expect(formatValue("value_total", 55000, ctx).text).toBe("55,000");
    expect(formatValue("is_urgent", true, ctx).text).toBe("ใช่");
    expect(formatValue("note", null, ctx).text).toBe("ว่าง");
  });
  it("วันที่/เดือน/enum", () => {
    expect(formatValue("start_date", "2026-01-15", ctx).text).toBe("15 ม.ค. 2026");
    expect(formatValue("month_key", "2026-10", ctx).text).toBe("ต.ค. 2026");
    expect(formatValue("sale_type", "renew", ctx).text).toBe("ต่อสัญญา");
  });
  it("uuid: รู้จักแสดงชื่อ ไม่รู้จักเป็น opaque (ไม่โชว์รหัส)", () => {
    expect(formatValue("branch_id", BR, ctx)).toEqual({ text: "ลาดพร้าว", opaque: false });
    const r = formatValue("team_id", "33333333-3333-4333-8333-333333333333", ctx);
    expect(r.opaque).toBe(true);
    expect(r.text).toBe("");
  });
  it("ข้อความยาวถูกตัด", () => {
    expect(formatValue("note", "ก".repeat(200), ctx).text.length).toBe(81);
  });
});

describe("diffRecord", () => {
  it("แสดงเฉพาะช่องที่เปลี่ยน และตัด updated_at / id", () => {
    const d = diffRecord(
      { id: "x", value_total: 50000, status: "active", updated_at: "2026-11-01T00:00:00Z" },
      { id: "x", value_total: 55000, status: "active", updated_at: "2026-11-05T00:00:00Z" },
      ctx,
    );
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ key: "value_total", label: "มูลค่า", before: "50,000", after: "55,000" });
  });
  it("ช่องที่ไม่รู้จักใช้ชื่อคอลัมน์ ไม่พัง", () => {
    const d = diffRecord({ zzz_new: 1 }, { zzz_new: 2 }, ctx);
    expect(d[0]?.label).toBe("zzz_new");
  });
  it("jsonb ซ้อนที่เหมือนกันไม่นับว่าเปลี่ยน", () => {
    expect(diffRecord({ a: [1, 2] }, { a: [1, 2] }, ctx)).toEqual([]);
  });
});

describe("describeAudit", () => {
  it("update: ประโยคภาษาคน", () => {
    const d = describeAudit(
      row({ oldData: { contract_no: "CT26-1", value_total: 50000 }, newData: { contract_no: "CT26-1", value_total: 55000 } }),
      ctx,
    );
    expect(d.headline).toBe("มูลค่า 50,000 → 55,000");
    expect(d.entity).toBe("CT26-1");
  });
  it("update หลายช่อง: แสดง 3 ช่องแรก + 'และอีก n ช่อง'", () => {
    const o = { a1: 1, a2: 1, a3: 1, a4: 1, a5: 1 };
    const n = { a1: 2, a2: 2, a3: 2, a4: 2, a5: 2 };
    expect(describeAudit(row({ oldData: o, newData: n }), ctx).headline).toMatch(/และอีก 2 ช่อง$/);
  });
  it("update ที่มีแต่ช่องที่ระบบประทับ = บอกว่าไม่มีช่องที่ผู้ใช้เห็น", () => {
    const d = describeAudit(row({ oldData: { updated_at: "a" }, newData: { updated_at: "b" } }), ctx);
    expect(d.headline).toContain("ไม่มีช่องที่ผู้ใช้เห็นเปลี่ยน");
  });
  it("insert / delete ใช้ชื่อแถว", () => {
    expect(describeAudit(row({ tableName: "customers", action: "insert", newData: { name: "บจก. ทดสอบ" } }), ctx).headline).toBe(
      "เพิ่มลูกค้า บจก. ทดสอบ",
    );
    const del = describeAudit(row({ tableName: "stations", action: "delete", oldData: { type: "IG", station_no: 12 } }), ctx);
    expect(del.headline).toBe("ลบสถานี IG-12");
    expect(del.changes.length).toBeGreaterThan(0);
  });
  it("เปลี่ยนรหัสอ้างอิงที่ไม่รู้ชื่อ → 'เปลี่ยนทีม'", () => {
    const d = describeAudit(
      row({ oldData: { team_id: "33333333-3333-4333-8333-333333333333" }, newData: { team_id: "44444444-4444-4444-8444-444444444444" } }),
      ctx,
    );
    expect(d.headline).toBe("เปลี่ยนทีม");
  });
});
