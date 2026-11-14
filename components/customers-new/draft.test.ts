import { describe, expect, it } from "vitest";

import type { BranchOption } from "./branchMatch";
import {
  SERVICE_TIME_SLOTS,
  canSave,
  checkDraft,
  createDraft,
  missingLabel,
  termFromValues,
} from "./draftRow";
import { sanitizeSearch } from "./renewal";
import { describeDbError } from "./errors";
import { currentBangkokMonth, monthChoices, monthLabel, monthRange, resolveMonth } from "@/lib/service/months";
import { sortTeams } from "./data";

const branches: BranchOption[] = [
  { id: "b1", name: "นครปฐม", zoneId: "z1", zoneName: "เขต 1" },
];

function filled() {
  return {
    ...createDraft(),
    contractNo: "CT26-0000001",
    customerName: "บจก. ตัวอย่าง",
    saleName: "พนักงานขาย",
    branchText: "นครปฐม",
    startDate: "2026-10-01",
    endDate: "2027-09-30",
    value1y: "99,510.00",
  };
}

describe("checkDraft", () => {
  it("แถวเปล่า: ขาดช่องจำเป็นครบ", () => {
    const c = checkDraft(createDraft(), branches, undefined);
    expect(canSave(c)).toBe(false);
    expect(Object.keys(c.errors).sort()).toEqual(
      ["branch", "contractNo", "customerName", "saleName", "startDate", "value"].sort(),
    );
    expect(missingLabel(c)).toMatch(/^ขาด /);
  });
  it("แถวครบ: บันทึกได้ + ระยะ/มูลค่า/สาขาถูกแปลง", () => {
    const c = checkDraft(filled(), branches, undefined);
    expect(canSave(c)).toBe(true);
    expect(c.termYears).toBe(1);
    expect(c.valueTotal).toBe(99510);
    expect(c.branch?.id).toBe("b1");
    expect(c.warnings).toContain("ยังไม่แนบไฟล์สัญญา + Site plan"); // เตือน ไม่บล็อก
  });
  it("สาขาที่ไม่อยู่ใน master = ผิด", () => {
    const c = checkDraft({ ...filled(), branchText: "นนทบรี" }, branches, undefined);
    expect(c.errors.branch).toMatch(/ไม่พบสาขา/);
    expect(canSave(c)).toBe(false);
  });
  it("กรอกมูลค่าทั้ง 2 ช่อง = ผิด", () => {
    const c = checkDraft({ ...filled(), value3y: "100,000" }, branches, undefined);
    expect(c.errors.value).toMatch(/ช่องเดียว/);
  });
  it("มูลค่าไม่ใช่ตัวเลข = ผิด · เลขที่สัญญาซ้ำ = ผิด", () => {
    expect(checkDraft({ ...filled(), value1y: "abc" }, branches, undefined).errors.value).toBeTruthy();
    expect(checkDraft(filled(), branches, "เลขที่สัญญาซ้ำกับแถวอื่น").errors.contractNo).toMatch(/ซ้ำ/);
  });
  it("วันสิ้นสุดไม่ตรงระยะ = เตือน ไม่บล็อก", () => {
    const c = checkDraft({ ...filled(), endDate: "2027-10-31" }, branches, undefined);
    expect(canSave(c)).toBe(true);
    expect(c.warnings).toContain("ระยะ 396 วัน");
  });
  it("วันสิ้นสุดเป็นปีผิด (8202) = ผิด", () => {
    const c = checkDraft({ ...filled(), endDate: "8202-10-15" }, branches, undefined);
    expect(c.errors.endDate).toBeTruthy();
  });
  it("ระยะสัญญามาจากช่องมูลค่าที่กรอก", () => {
    expect(termFromValues("1", "")).toBe(1);
    expect(termFromValues("", "1")).toBe(3);
    expect(termFromValues("", "")).toBeNull();
    expect(termFromValues("1", "1")).toBeNull();
  });
});

describe("ช่องเปิดงานใหม่ (M9)", () => {
  it("ยังไม่มีวันที่บริการ = รอนัดบริการ (บันทึกได้)", () => {
    const c = checkDraft(filled(), branches, undefined);
    expect(c.pendingService).toBe(true);
    expect(canSave(c)).toBe(true);
    const d2 = checkDraft({ ...filled(), firstServiceDate: "2026-11-20" }, branches, undefined);
    expect(d2.pendingService).toBe(false);
  });
  it("มีเวลาแต่ไม่มีวันที่บริการ = ผิด (ตรงกฎ DB)", () => {
    const c = checkDraft({ ...filled(), firstServiceTime: "09:30" }, branches, undefined);
    expect(c.errors.serviceDate).toMatch(/เลือกวันที่บริการก่อน/);
    expect(canSave(c)).toBe(false);
  });
  it("วันที่รับ Mail / วันที่บริการที่ไม่ใช่วันจริง = ผิด", () => {
    expect(checkDraft({ ...filled(), mailReceivedDate: "2026-02-31" }, branches, undefined).errors.mailDate).toBeTruthy();
    expect(checkDraft({ ...filled(), firstServiceDate: "8202-01-01" }, branches, undefined).errors.serviceDate).toBeTruthy();
  });
  it("Renew ที่ยังไม่ผูกลูกค้าเดิม = เตือน ไม่บล็อก", () => {
    const c = checkDraft({ ...filled(), saleType: "renew" }, branches, undefined);
    expect(c.warnings).toContain("Renew ยังไม่ผูกลูกค้าเดิม");
    expect(canSave(c)).toBe(true);
  });
  it("ตัวเลือกเวลานัด 08:00–17:30 ทุก 30 นาที", () => {
    expect(SERVICE_TIME_SLOTS[0]).toBe("08:00");
    expect(SERVICE_TIME_SLOTS[1]).toBe("08:30");
    expect(SERVICE_TIME_SLOTS.at(-1)).toBe("17:30");
    expect(SERVICE_TIME_SLOTS).toHaveLength(20);
  });
  it("คำค้นสัญญาเก่าตัดอักขระที่ทำให้ตัวกรองเพี้ยน", () => {
    expect(sanitizeSearch(" ab%c,(d)*  e_f ")).toBe("ab c d e f");
    expect(sanitizeSearch("   ")).toBe("");
  });
  it("แปล error ใหม่เป็นไทย", () => {
    expect(describeDbError({ code: "23514", message: 'violates check constraint "contracts_first_service_time_needs_date"' })).toMatch(/วันที่บริการ/);
    expect(describeDbError({ code: "23514", message: 'violates check constraint "contracts_not_renewed_from_itself"' })).toMatch(/ผูกกับตัวเอง/);
    expect(describeDbError({ code: "P0001", message: "a renewal must link to a contract of the same customer" })).toMatch(/ลูกค้าคนเดียวกัน/);
    expect(describeDbError({ code: "23503", message: 'violates foreign key constraint "contracts_renewed_from_contract_id_fkey"' })).toMatch(/ไม่พบสัญญาเก่า/);
  });
});

describe("months", () => {
  it("ป้ายเดือนไทย", () => {
    expect(monthLabel("2026-10")).toBe("ตุลาคม 2026");
  });
  it("เดือนปัจจุบันตามเขตเวลาไทย (ข้ามเที่ยงคืน UTC)", () => {
    expect(currentBangkokMonth(new Date("2026-10-31T18:00:00Z"))).toBe("2026-11");
    expect(currentBangkokMonth(new Date("2026-10-31T16:59:00Z"))).toBe("2026-10");
  });
  it("ตัวเลือกเดือนและการตรวจค่าจาก URL", () => {
    const list = monthChoices("2026-11");
    expect(list[0]).toBe("2026-12");
    expect(list[1]).toBe("2026-11");
    expect(list).toHaveLength(26);
    expect(resolveMonth("2026-09", "2026-11")).toBe("2026-09");
    expect(resolveMonth("1999-01", "2026-11")).toBe("2026-11");
    expect(resolveMonth("abc", "2026-11")).toBe("2026-11");
    expect(resolveMonth(undefined, "2026-11")).toBe("2026-11");
  });
  it("ช่วงวันของเดือน (ข้ามปี)", () => {
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", toExclusive: "2027-01-01" });
  });
});

describe("describeDbError", () => {
  it("RLS ปฏิเสธ → ข้อความไทยเรื่องสิทธิ์", () => {
    expect(describeDbError({ code: "42501", message: "new row violates row-level security policy" })).toMatch(
      /ไม่มีสิทธิ์/,
    );
    expect(describeDbError({ message: "new row violates row-level security policy", statusCode: "403" }, "file")).toMatch(
      /ไม่มีสิทธิ์/,
    );
  });
  it("เลขที่สัญญาซ้ำ / ลบไม่ได้ / สัญญาปิดแล้ว", () => {
    expect(describeDbError({ code: "23505", message: "duplicate key" })).toMatch(/เลขที่สัญญา/);
    expect(describeDbError({ code: "23503" }, "delete")).toMatch(/ลบไม่ได้/);
    expect(describeDbError({ code: "P0001", message: "contract is closed: its files are locked" }, "file")).toMatch(/ปิดแล้ว/);
  });
  it("ไม่รู้จัก = ข้อความทั่วไป ไม่หลุดข้อความดิบของฐานข้อมูล", () => {
    const t = describeDbError({ message: "relation foo does not exist" });
    expect(t).not.toMatch(/relation/);
  });
});

describe("sortTeams", () => {
  it("A–O ก่อน แล้ว Z แล้ว Sup", () => {
    expect(sortTeams([{ code: "Sup" }, { code: "Z" }, { code: "B" }, { code: "A" }]).map((t) => t.code)).toEqual([
      "A",
      "B",
      "Z",
      "Sup",
    ]);
  });
});
