/**
 * เทสรอบ 1.2 ของหน้า /customers/new — บันทึก/ลบผ่าน RPC ฝั่ง DB
 * ใช้ Supabase client ปลอม (ไม่แตะฐานข้อมูลจริง) · ของจริงทดสอบกับ DB local ตามรายงานของ sub session
 */
import { describe, expect, it } from "vitest";

import { parseDuplicateMatches } from "./duplicateCustomer";
import { describeDbError } from "./errors";
import { deleteContractFile } from "./files";
import { deleteContract, saveDraft } from "./save";
import { buildSaveParams, parseSaveRow } from "./savePayload";
import type { DraftRow } from "./types";

type RpcCall = { fn: string; args: Record<string, unknown> };
type RpcReply = { data?: unknown; error?: { code?: string; message?: string; details?: string | null } | null };

function fakeRpc(reply: (c: RpcCall) => RpcReply) {
  const calls: RpcCall[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      const call = { fn, args };
      calls.push(call);
      return { data: null, error: null, ...reply(call) };
    },
  };
  return { client: client as never, calls };
}

const branch = { id: "b1", name: "สาขา", zoneId: "z", zoneName: "เขต 1" };
const baseDraft = {
  key: "k",
  contractNo: "A-1",
  customerName: " ลูกค้า ก ",
  saleType: "new",
  sellerRole: "sale",
  saleName: " ขาย ",
  isUrgent: true,
  renewal: null,
  mailReceivedDate: "",
  firstServiceDate: "",
  firstServiceTime: "09:30",
  note: "  ",
  branchText: "สาขา",
  customerTypeCode: "B",
  teamIds: ["t1", "t2"],
  startDate: "2026-01-15",
  endDate: "",
  endTouched: false,
  value1y: "",
  value3y: "",
  pendingPdf: null,
  saveError: null,
} as unknown as DraftRow;
const check = { branch, termYears: 1, valueTotal: 50000, endDate: "2026-12-31" } as never;
const values = { branchId: "b1", termYears: 1, valueTotal: 50000, endDate: "2026-12-31" };

describe("buildSaveParams — แปลงแถวร่างเป็นพารามิเตอร์ RPC", () => {
  it("เปิดงานใหม่: ตัดช่องว่าง · ตำแหน่ง Sale → p_sale_name · ว่าง → null · ไม่ส่ง id", () => {
    const p = buildSaveParams(baseDraft, values);
    expect(p).toMatchObject({
      p_branch_id: "b1",
      p_customer_name: "ลูกค้า ก",
      p_customer_type: "B",
      p_contract_no: "A-1",
      p_start_date: "2026-01-15",
      p_end_date: "2026-12-31",
      p_term_years: 1,
      p_value_total: 50000,
      p_sale_type: "new",
      p_team_ids: ["t1", "t2"],
      p_sale_name: "ขาย",
      p_am_name: null,
      p_is_urgent: true,
      p_renewed_from_contract_id: null,
      p_mail_received_date: null,
      p_note: null,
      p_confirm_new_customer: false,
    });
    expect("p_contract_id" in p).toBe(false);
    expect("p_customer_id" in p).toBe(false);
  });
  it("เวลาบริการส่งเฉพาะเมื่อมีวันที่บริการ (constraint ของ DB)", () => {
    expect(buildSaveParams(baseDraft, values).p_first_service_time).toBeNull();
    const p = buildSaveParams({ ...baseDraft, firstServiceDate: "2026-02-01" }, values);
    expect(p).toMatchObject({ p_first_service_date: "2026-02-01", p_first_service_time: "09:30" });
  });
  it("ตำแหน่ง AM → ชื่อลง p_am_name", () => {
    const p = buildSaveParams({ ...baseDraft, sellerRole: "am" }, values);
    expect(p).toMatchObject({ p_sale_name: null, p_am_name: "ขาย" });
  });
  it("Renew ที่ผูกสัญญาเก่า → ส่ง customer_id + renewed_from ของสัญญาเก่า", () => {
    const renewal = { contractId: "old-c", contractNo: "O-1", customerId: "old-u", customerName: "ก", branchId: "b1" };
    const p = buildSaveParams({ ...baseDraft, saleType: "renew", renewal }, values);
    expect(p).toMatchObject({ p_customer_id: "old-u", p_renewed_from_contract_id: "old-c", p_sale_type: "renew" });
  });
  it("เลือก 'ใช้รายเดิม' ชนะ Renew · 'คนละราย' ส่ง confirm · แก้แถวส่ง p_contract_id", () => {
    const renewal = { contractId: "old-c", contractNo: "O-1", customerId: "old-u", customerName: "ก", branchId: "b1" };
    const d = { ...baseDraft, saleType: "renew", renewal } as DraftRow;
    expect(buildSaveParams(d, values, { customerId: "pick" }).p_customer_id).toBe("pick");
    expect(buildSaveParams(baseDraft, values, { confirmNewCustomer: true }).p_confirm_new_customer).toBe(true);
    expect(buildSaveParams(baseDraft, values, { contractId: "c9" }).p_contract_id).toBe("c9");
  });
});

describe("parseSaveRow", () => {
  it("อ่านอาร์เรย์ 1 แถวจาก RETURNS TABLE", () => {
    expect(
      parseSaveRow([{ contract_id: "c", customer_id: "u", reused_customer: true, existing_customer_type: "A" }]),
    ).toEqual({ contractId: "c", customerId: "u", reusedCustomer: true, existingCustomerType: "A" });
    expect(parseSaveRow({ contract_id: "c", customer_id: "u", reused_customer: false, existing_customer_type: null }))
      .toMatchObject({ reusedCustomer: false, existingCustomerType: null });
  });
  it("รูปแบบไม่ตรง = null (ห้ามเดา)", () => {
    expect(parseSaveRow(null)).toBeNull();
    expect(parseSaveRow([])).toBeNull();
    expect(parseSaveRow([{ customer_id: "u" }])).toBeNull();
  });
});

describe("parseDuplicateMatches — details ของ AG001", () => {
  it("อ่านรายชื่อที่ซ้ำ", () => {
    const json = JSON.stringify([
      { customer_id: "u1", name: "ลูกค้า ก", customer_type: "A", latest_contract_no: "X-1" },
      { customer_id: "u2", name: "ลูกค้า  ก", customer_type: null, latest_contract_no: null },
    ]);
    expect(parseDuplicateMatches(json)).toEqual([
      { customerId: "u1", name: "ลูกค้า ก", customerType: "A", latestContractNo: "X-1" },
      { customerId: "u2", name: "ลูกค้า  ก", customerType: null, latestContractNo: null },
    ]);
  });
  it("ข้อมูลเพี้ยน/ไม่ใช่ JSON/ไม่มี id = ว่าง", () => {
    expect(parseDuplicateMatches(null)).toEqual([]);
    expect(parseDuplicateMatches("not json")).toEqual([]);
    expect(parseDuplicateMatches('{"a":1}')).toEqual([]);
    expect(parseDuplicateMatches('[{"name":"x"}, 5, null]')).toEqual([]);
  });
});

describe("describeDbError — AG001–AG006", () => {
  it("แปลทุกรหัสเป็นไทย ไม่ตกไปข้อความทั่วไป", () => {
    for (const code of ["AG001", "AG002", "AG003", "AG004", "AG005", "AG006"]) {
      const t = describeDbError({ code, message: "x" });
      expect(t).not.toMatch(/บันทึกไม่สำเร็จ ลองอีกครั้ง/);
    }
    expect(describeDbError({ code: "AG006" })).toMatch(/เปลี่ยนสาขาของสัญญาที่บันทึกแล้วไม่ได้/);
    expect(describeDbError({ code: "AG001" })).toMatch(/ชื่อนี้/);
    expect(describeDbError({ code: "AG003" }, "delete")).toMatch(/ผลบริการ/);
    expect(describeDbError({ code: "AG005" }, "delete")).toMatch(/ปิดแล้ว/);
  });
  it("42501 ตอนลบ ไม่พูดว่า 'บันทึก'", () => {
    expect(describeDbError({ code: "42501" }, "delete")).toMatch(/ลบ/);
    expect(describeDbError({ code: "42501" }, "delete")).not.toMatch(/บันทึก/);
  });
});

describe("saveDraft — เรียก RPC", () => {
  it("สำเร็จ: เรียก save_job_opening ครั้งเดียว · ใช้รายเดิมประเภทต่างกัน → customerTypeMismatch", async () => {
    const f = fakeRpc(() => ({
      data: [{ contract_id: "c1", customer_id: "u1", reused_customer: true, existing_customer_type: "A" }],
    }));
    const r = await saveDraft(f.client, baseDraft, check);
    expect(r).toMatchObject({
      ok: true,
      contractId: "c1",
      reusedCustomer: true,
      customerTypeMismatch: { existing: "A", chosen: "B" },
    });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.fn).toBe("save_job_opening");
  });
  it("สร้างลูกค้าใหม่ → ไม่มี mismatch · ประเภทตรงกัน → ไม่มี mismatch", async () => {
    const created = fakeRpc(() => ({
      data: [{ contract_id: "c1", customer_id: "u1", reused_customer: false, existing_customer_type: null }],
    }));
    expect(await saveDraft(created.client, baseDraft, check)).toMatchObject({ ok: true, customerTypeMismatch: null });
    const same = fakeRpc(() => ({
      data: [{ contract_id: "c1", customer_id: "u1", reused_customer: true, existing_customer_type: "B" }],
    }));
    expect(await saveDraft(same.client, baseDraft, check)).toMatchObject({ ok: true, customerTypeMismatch: null });
  });
  it("AG001 → คืนรายชื่อที่ซ้ำ (ไม่ใช่ error ปกติ) ให้หน้าจอถาม", async () => {
    const details = JSON.stringify([{ customer_id: "u1", name: "ลูกค้า ก", customer_type: "A", latest_contract_no: "X-1" }]);
    const f = fakeRpc(() => ({ error: { code: "AG001", message: "dup", details } }));
    const r = await saveDraft(f.client, baseDraft, check);
    expect(r).toMatchObject({ ok: false, duplicates: [{ customerId: "u1", latestContractNo: "X-1" }] });
  });
  it("AG001 แต่ details อ่านไม่ได้ → error ธรรมดา ไม่มีกล่องถาม", async () => {
    const f = fakeRpc(() => ({ error: { code: "AG001", message: "dup", details: "???" } }));
    const r = await saveDraft(f.client, baseDraft, check);
    expect(r.ok).toBe(false);
    expect((r as { duplicates?: unknown }).duplicates).toBeUndefined();
  });
  it("ส่งซ้ำด้วยตัวเลือกจากกล่อง: รายเดิม → p_customer_id · คนละราย → p_confirm_new_customer", async () => {
    const ok = { data: [{ contract_id: "c1", customer_id: "u1", reused_customer: true, existing_customer_type: "B" }] };
    const a = fakeRpc(() => ok);
    await saveDraft(a.client, baseDraft, check, { customerId: "u1" });
    expect(a.calls[0]!.args.p_customer_id).toBe("u1");
    const b = fakeRpc(() => ok);
    await saveDraft(b.client, baseDraft, check, { confirmNewCustomer: true });
    expect(b.calls[0]!.args.p_confirm_new_customer).toBe(true);
  });
  it("ถูกปฏิเสธ (42501 / AG006) → ข้อความไทย · ผลที่อ่านไม่ได้ → ล้ม ไม่เดาว่าสำเร็จ", async () => {
    const denied = fakeRpc(() => ({ error: { code: "42501", message: "branch is outside your division" } }));
    expect(await saveDraft(denied.client, baseDraft, check)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/ไม่มีสิทธิ์/),
    });
    const moved = fakeRpc(() => ({ error: { code: "AG006", message: "x" } }));
    expect(await saveDraft(moved.client, baseDraft, check, { contractId: "c1" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/เปลี่ยนสาขา/),
    });
    const garbled = fakeRpc(() => ({ data: [] }));
    expect((await saveDraft(garbled.client, baseDraft, check)).ok).toBe(false);
  });
  it("ข้อมูลแถวไม่ครบ (ไม่มีสาขา) → ไม่เรียก RPC", async () => {
    const f = fakeRpc(() => ({}));
    const r = await saveDraft(f.client, baseDraft, { ...(check as object), branch: null } as never);
    expect(r.ok).toBe(false);
    expect(f.calls).toHaveLength(0);
  });
});

describe("deleteContract — เรียก RPC delete_job_opening อย่างเดียว ไม่แตะ Storage", () => {
  it("สำเร็จ → เรียก rpc ด้วย p_contract_id", async () => {
    const f = fakeRpc(() => ({}));
    expect(await deleteContract(f.client, "c1")).toEqual({ ok: true });
    expect(f.calls).toEqual([{ fn: "delete_job_opening", args: { p_contract_id: "c1" } }]);
  });
  it("AG003 / AG005 / 42501 → ข้อความไทยของแต่ละกรณี", async () => {
    for (const [code, re] of [
      ["AG003", /ผลบริการ/],
      ["AG005", /ปิดแล้ว/],
      ["AG004", /ไม่พบสัญญา/],
      ["42501", /ไม่มีสิทธิ์ลบ/],
    ] as const) {
      const f = fakeRpc(() => ({ error: { code, message: "x" } }));
      expect(await deleteContract(f.client, "c1")).toMatchObject({ ok: false, error: expect.stringMatching(re) });
    }
  });
});

describe("deleteContractFile — ลบแค่แถว (object DB ลงคิวเอง)", () => {
  function fakeFiles(result: { data?: unknown; error?: { message: string } | null }) {
    const calls: string[] = [];
    let storageTouched = false;
    const builder: Record<string, unknown> = {
      delete: () => builder,
      eq: (col: string, v: unknown) => (calls.push(`${col}=${String(v)}`), builder),
      select: () => builder,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...result }).then(resolve),
    };
    const client = {
      from: () => builder,
      storage: { from: () => (storageTouched = true) },
    };
    return { client: client as never, calls, touched: () => storageTouched };
  }
  it("ลบได้ → ok และไม่แตะ Storage", async () => {
    const f = fakeFiles({ data: [{ id: "f1" }] });
    expect(await deleteContractFile(f.client, { id: "f1" })).toEqual({ ok: true });
    expect(f.calls).toEqual(["id=f1"]);
    expect(f.touched()).toBe(false);
  });
  it("RLS/trigger ปฏิเสธแบบ 0 แถว → ล้ม ไม่บอกว่าลบแล้ว · error → ล้ม", async () => {
    expect((await deleteContractFile(fakeFiles({ data: [] }).client, { id: "f1" })).ok).toBe(false);
    expect((await deleteContractFile(fakeFiles({ error: { message: "x" } }).client, { id: "f1" })).ok).toBe(false);
  });
});
