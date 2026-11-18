/**
 * เทส server action ของ M38: preview_tier_rule_change + ประเภทลูกค้า (is_active / hint)
 * ด่าน host · ชื่อ RPC/argument ตรง migration 20261115260000 (mock Supabase — ข้อมูลสมมติ)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  isHost: true,
  rpcData: 30 as unknown,
  rpcError: null as { code: string } | null,
  types: [{ code: "a", label: "วัด", group_label: "ศาสนา", sort_order: 1, is_active: true, hint: null }],
};
const rpcCalls: { name: string; args: unknown }[] = [];
const writes: { table: string; op: string; values?: unknown }[] = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  fetchProfileByUserId: async () => ({ role: state.isHost ? "host" : "admin", isActive: true }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    rpc: async (name: string, args: unknown) => {
      if (name === "is_host") return { data: state.isHost, error: null };
      rpcCalls.push({ name, args });
      return state.rpcError ? { data: null, error: state.rpcError } : { data: state.rpcData, error: null };
    },
    from: (table: string) => ({
      select: () => ({ order: async () => ({ data: table === "customer_types" ? state.types : [], error: null }) }),
      insert: async (values: unknown) => {
        writes.push({ table, op: "insert", values });
        return { error: null };
      },
      update: (values: unknown) => ({
        eq: () => ({
          select: async () => {
            writes.push({ table, op: "update", values });
            return { data: [{ code: "a" }], error: null };
          },
        }),
      }),
    }),
  }),
}));

import {
  createCustomerTypeAction,
  previewTierRuleChangeAction,
  setCustomerTypeActiveAction,
  updateCustomerTypeAction,
} from "./settingsActions";

const IN = { effectiveMonth: "2026-12", m: 30000, l: 50000, xl: 100000 };

beforeEach(() => {
  state.isHost = true;
  state.rpcData = 30;
  state.rpcError = null;
  rpcCalls.length = 0;
  writes.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("ด่าน host", () => {
  it("ไม่ใช่ host → FORBIDDEN ไม่เรียก RPC/เขียนตาราง", async () => {
    state.isHost = false;
    expect(await previewTierRuleChangeAction(IN)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await setCustomerTypeActiveAction("a", false)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(rpcCalls).toEqual([]);
    expect(writes).toEqual([]);
  });
});

describe("previewTierRuleChangeAction", () => {
  it("ส่ง p_effective_month วันที่ 1 + p_rules เป็น JSON number แล้วแปลงแถวผลลัพธ์", async () => {
    state.rpcData = [{ from_tier: "M", to_tier: "L", term_group: "3", contract_count: 4 }];
    expect(await previewTierRuleChangeAction(IN)).toEqual({
      ok: true,
      rows: [{ from: "M", to: "L", termGroup: "3", count: 4 }],
    });
    expect(rpcCalls).toEqual([
      {
        name: "preview_tier_rule_change",
        args: { p_effective_month: "2026-12-01", p_rules: { min_m: 30000, min_l: 50000, min_xl: 100000 } },
      },
    ]);
  });
  it("ร่างผิด/เดือนผิด → INVALID_INPUT ไม่เรียก RPC", async () => {
    expect(await previewTierRuleChangeAction({ ...IN, l: 100 })).toMatchObject({ code: "INVALID_INPUT" });
    expect(await previewTierRuleChangeAction({ ...IN, effectiveMonth: "2026-13" })).toMatchObject({ code: "INVALID_INPUT" });
    expect(rpcCalls).toEqual([]);
  });
  it("TR006 / 42501 → ข้อความไทย · ผลลัพธ์ไม่ใช่ array → UPSTREAM_ERROR", async () => {
    state.rpcError = { code: "TR006" };
    const tr = await previewTierRuleChangeAction(IN);
    expect(tr).toMatchObject({ ok: false, code: "TR006" });
    expect((tr as { message: string }).message).toContain("คำนวณผลกระทบไม่ได้");
    state.rpcError = { code: "42501" };
    expect(await previewTierRuleChangeAction(IN)).toMatchObject({ code: "42501" });
    state.rpcError = null;
    state.rpcData = 30;
    expect(await previewTierRuleChangeAction(IN)).toMatchObject({ ok: false, code: "UPSTREAM_ERROR" });
  });
});

describe("ประเภทลูกค้า (is_active + hint)", () => {
  it("สวิตช์แก้ is_active ตัวเดียว", async () => {
    expect(await setCustomerTypeActiveAction("a", false)).toEqual({ ok: true });
    expect(writes).toEqual([{ table: "customer_types", op: "update", values: { is_active: false } }]);
  });
  it("สวิตช์: รหัสว่าง / ค่าไม่ใช่ boolean → INVALID_INPUT", async () => {
    expect(await setCustomerTypeActiveAction("", true)).toMatchObject({ code: "INVALID_INPUT" });
    expect(await setCustomerTypeActiveAction("a", "x" as unknown as boolean)).toMatchObject({ code: "INVALID_INPUT" });
    expect(writes).toEqual([]);
  });
  it("hint ยาวเกิน 120 → INVALID_INPUT ไม่เขียน", async () => {
    const long = "ก".repeat(121);
    expect(await createCustomerTypeAction({ label: "ใหม่", groupLabel: "G", hint: long })).toMatchObject({ code: "INVALID_INPUT" });
    expect(await updateCustomerTypeAction({ code: "a", label: "วัด", groupLabel: "ศาสนา", hint: long })).toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(writes).toEqual([]);
  });
  it("เพิ่มประเภท: hint เว้นว่าง = null · ค่าเริ่มต้นใช้งาน", async () => {
    await createCustomerTypeAction({ label: "ใหม่", groupLabel: "G", hint: "   " });
    expect(writes[0]).toMatchObject({ table: "customer_types", op: "insert", values: { hint: null, is_active: true } });
  });
  it("แก้ประเภท: ส่ง hint/is_active เฉพาะที่ระบุ", async () => {
    await updateCustomerTypeAction({ code: "a", label: "วัด", groupLabel: "ศาสนา", hint: " ใช้กับวัด ", isActive: false });
    expect(writes[0]).toEqual({
      table: "customer_types",
      op: "update",
      values: { label: "วัด", group_label: "ศาสนา", hint: "ใช้กับวัด", is_active: false },
    });
    writes.length = 0;
    await updateCustomerTypeAction({ code: "a", label: "วัด", groupLabel: "ศาสนา" });
    expect(writes[0]!.values).toEqual({ label: "วัด", group_label: "ศาสนา" });
  });
});
