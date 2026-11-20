import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  CANCEL_REASON_MAX,
  CANCEL_REASON_OPTIONS,
  canShowCancel,
  canShowReopen,
  cancelContract,
  describeCancelError,
  reopenContract,
  validateCancelForm,
  validateReasonText,
} from "./cancelContract";
import { CancelContractDialog, ReopenContractDialog } from "./ContractCancelDialogs";
import { toContractRow } from "./data";
import type { ContractRow } from "./types";

// ข้อมูลทดสอบสมมติทั้งหมด
type Mini = Pick<ContractRow, "id" | "status" | "renewedFromId">;
const k = (over: Partial<Mini>): Mini => ({ id: "c1", status: "active", renewedFromId: null, ...over });

describe("ปุ่ม 'ยกเลิกสัญญา' — แสดงเมื่อไหร่", () => {
  it("host / admin เห็น · recorder / viewer ไม่เห็น", () => {
    expect(canShowCancel("host", k({}), [])).toBe(true);
    expect(canShowCancel("admin", k({}), [])).toBe(true);
    expect(canShowCancel("recorder", k({}), [])).toBe(false);
    expect(canShowCancel("viewer", k({}), [])).toBe(false);
  });
  it("เฉพาะสัญญา active / paused (สถานะที่ใช้ตัดสินบนหน้าจอ = ยังไม่เลยวันสิ้นสุด)", () => {
    expect(canShowCancel("host", k({ status: "paused" }), [])).toBe(true);
    for (const status of ["expired_pending_collection", "closed", "cancelled"] as const) {
      expect(canShowCancel("host", k({ status }), [])).toBe(false);
    }
  });
  it("สัญญาเก่าที่ถูก Renew ต่อแล้ว (สัญญาใหม่ไม่ยกเลิก) ซ่อนปุ่ม · ถ้า Renew ถูกยกเลิกแล้ว กลับมายกเลิกได้", () => {
    const old = k({ id: "old" });
    expect(canShowCancel("host", old, [old, k({ id: "new", renewedFromId: "old" })])).toBe(false);
    expect(canShowCancel("host", old, [old, k({ id: "new", renewedFromId: "old", status: "cancelled" })])).toBe(true);
    // ตัว Renew เอง (ไม่มีสัญญาต่อจากมัน) ยกเลิกได้
    const renew = k({ id: "new", renewedFromId: "old" });
    expect(canShowCancel("host", renew, [k({ id: "old" }), renew])).toBe(true);
  });
});

describe("ปุ่ม 'เปิดสัญญากลับ'", () => {
  it("เฉพาะสัญญายกเลิก + host/admin", () => {
    expect(canShowReopen("host", { status: "cancelled" })).toBe(true);
    expect(canShowReopen("admin", { status: "cancelled" })).toBe(true);
    expect(canShowReopen("recorder", { status: "cancelled" })).toBe(false);
    expect(canShowReopen("viewer", { status: "cancelled" })).toBe(false);
    for (const status of ["active", "paused", "expired_pending_collection", "closed"] as const) {
      expect(canShowReopen("host", { status })).toBe(false);
    }
  });
});

describe("ตรวจฟอร์ม", () => {
  it("ต้องเลือกประเภทเหตุผล + พิมพ์เหตุผล ≤ 500", () => {
    expect(validateCancelForm({ code: "", reason: "xx" })).toMatch(/ประเภทเหตุผล/);
    expect(validateCancelForm({ code: "entry_error", reason: "   " })).toMatch(/เหตุผล/);
    expect(validateCancelForm({ code: "other", reason: "a".repeat(CANCEL_REASON_MAX + 1) })).toMatch(/ยาวเกิน/);
    expect(validateCancelForm({ code: "customer_cancelled", reason: "a".repeat(CANCEL_REASON_MAX) })).toBeNull();
    expect(validateReasonText("  ลูกค้าย้ายออก  ")).toBeNull();
  });
  it("ตัวเลือกครบ 3 แบบ ตรงรหัสของฐานข้อมูล", () => {
    expect(CANCEL_REASON_OPTIONS.map((o) => o.code)).toEqual(["entry_error", "customer_cancelled", "other"]);
  });
});

describe("error → ข้อความไทย", () => {
  it.each(["CC001", "CC002", "CC003", "CC004", "CC005", "CC006", "CC007", "CC008", "CC009", "AG004", "AG010", "AG012", "AG013", "42501", "22004"])(
    "%s → ข้อความไทย ไม่ใช่บั๊ก",
    (code) => {
      const e = describeCancelError({ code, message: "raw english message" });
      expect(e.isBug).toBe(false);
      expect(e.message).toMatch(/[ก-๙]/);
      expect(e.message).not.toContain("raw english");
    },
  );
  it("CC007 บอกชัดว่ามี IG เก็บแล้ว · CC008 บอกว่าสัญญาเก่ามี Renew ตัวอื่น · CC009 บอกให้ใช้ปุ่ม", () => {
    expect(describeCancelError({ code: "CC007" }).message).toContain("IG");
    expect(describeCancelError({ code: "CC008" }).message).toContain("Renew");
    expect(describeCancelError({ code: "CC009" }).message).toContain("ปุ่ม");
  });
  it("เครือข่ายล่ม = ข้อความเชื่อมต่อ · รหัสไม่รู้จัก = ทั่วไป + isBug", () => {
    expect(describeCancelError({ message: "Failed to fetch" })).toEqual({ message: expect.stringContaining("เชื่อมต่อ"), isBug: false });
    expect(describeCancelError({ code: "XX999", message: "boom" }).isBug).toBe(true);
  });
});

describe("เรียก RPC ถูกตัว/ถูกพารามิเตอร์", () => {
  const fake = (error: { code?: string; message?: string } | null = null) => {
    const rpc = vi.fn().mockResolvedValue({ error });
    return { client: { rpc } as never, rpc };
  };
  it("cancel_contract ส่ง id + รหัสเหตุผล + เหตุผล (ตัดช่องว่าง)", async () => {
    const { client, rpc } = fake();
    expect(await cancelContract(client, { contractId: "c1", reasonCode: "entry_error", reason: "  ลงผิด  " })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("cancel_contract", { p_contract_id: "c1", p_reason_code: "entry_error", p_reason: "ลงผิด" });
  });
  it("reopen_contract ส่ง id + เหตุผล", async () => {
    const { client, rpc } = fake();
    expect(await reopenContract(client, { contractId: "c1", reason: " ยกเลิกผิดสัญญา " })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("reopen_contract", { p_contract_id: "c1", p_reason: "ยกเลิกผิดสัญญา" });
  });
  it("error → { ok:false, message ไทย }", async () => {
    const r = await cancelContract(fake({ code: "CC005" }).client, { contractId: "c1", reasonCode: "other", reason: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("Renew");
  });
  it("error ที่เป็นบั๊ก log เฉพาะรหัส (ไม่ log เหตุผลที่พิมพ์/ข้อความดิบ)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await reopenContract(fake({ code: "XX999", message: "ชื่อลูกค้า secret" }).client, { contractId: "c1", reason: "เหตุผลลับ" });
    expect(spy).toHaveBeenCalledWith("[customer-detail] cancel/reopen RPC error code", "XX999");
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/secret|เหตุผลลับ/);
    spy.mockRestore();
  });
});

describe("แสดงเหตุผล/ผู้ยกเลิกบนสัญญา (toContractRow)", () => {
  it("อ่านช่องยกเลิกจากแถวสัญญา · สัญญาไม่ยกเลิก/ยกเลิกก่อน M44 = null", () => {
    const base = {
      id: "c1",
      contract_no: "TS-1",
      customer_id: "u1",
      start_date: "2026-06-01",
      end_date: null,
      term_months: 12,
      value_total: 60000,
      sale_type: "new",
      status: "cancelled",
      closed_at: null,
      cancelled_at: "2026-11-20T03:00:00Z",
      renewed_from_contract_id: null,
      stations_initialized_at: null,
      contract_teams: [],
    };
    const rules = [{ tier: "S", minAnnual: 0 }] as never;
    const r = toContractRow({ ...base, cancel_reason_code: "entry_error", cancel_reason: "ลงผิดลูกค้า", cancelled_by: "user-1" } as never, rules, "2026-11-20");
    expect(r).toMatchObject({ status: "cancelled", cancelReasonCode: "entry_error", cancelReason: "ลงผิดลูกค้า", cancelledByName: "user-1" });
    const legacy = toContractRow(base as never, rules, "2026-11-20");
    expect(legacy).toMatchObject({ cancelReasonCode: null, cancelReason: null, cancelledByName: null });
  });
});

describe("กล่องยืนยัน (render ฝั่ง server)", () => {
  const noop = async () => null;
  it("ยกเลิก: มีตัวเลือกเหตุผลครบ · ช่องเหตุผล · ปุ่มปลอดภัย 'ไม่ยกเลิก' และปุ่มแดงยืนยัน · บอกผลที่ตามมา", () => {
    const out = renderToStaticMarkup(<CancelContractDialog contractNo="TS-0001" onClose={() => {}} onSubmit={noop} />);
    for (const label of ["ลงข้อมูลผิด", "ลูกค้ายกเลิกจริง", "อื่นๆ"]) expect(out).toContain(label);
    expect(out).toContain("ยกเลิกสัญญา TS-0001");
    expect(out).toContain("ไม่ยกเลิก");
    expect(out).toContain("ยืนยันยกเลิกสัญญา");
    expect(out).toContain("รอเก็บสถานี");
    expect(out).toContain("ไม่นับในยอดขาย");
    expect(out).toContain("<textarea");
  });
  it("เปิดกลับ: มีช่องเหตุผล + ปุ่มปลอดภัย 'ไม่เปิดกลับ' + บอกเรื่องตกบริการ", () => {
    const out = renderToStaticMarkup(<ReopenContractDialog contractNo="TS-0001" onClose={() => {}} onSubmit={noop} />);
    expect(out).toContain("เปิดสัญญา TS-0001 กลับ");
    expect(out).toContain("ไม่เปิดกลับ");
    expect(out).toContain("ยืนยันเปิดสัญญากลับ");
    expect(out).toContain("ตกบริการ");
    expect(out).toContain("<textarea");
  });
});
