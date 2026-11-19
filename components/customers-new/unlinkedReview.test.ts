/**
 * เทส M28b: ตรวจ Renew ที่ยังไม่ผูกสัญญาเก่า — payload RPC · แปล error · กรองปุ่มตาม role (ใช้ client ปลอม ไม่แตะ DB)
 */
import { describe, expect, it } from "vitest";

import { describeDbError } from "./errors";
import {
  CLOSE_NOTE_MAX,
  CLOSE_NOTE_WARNING,
  buildCloseParams,
  buildLinkParams,
  canReviewUnlinked,
  closeUnlinkedRenewal,
  filterByContractNo,
  linkRenewalContract,
  normalizeCloseNote,
  unlinkedStateOf,
} from "./unlinkedReview";

const open = { saleType: "renew", renewedFrom: null, unlinkedClosedAt: null } as const;
const closed = { saleType: "renew", renewedFrom: null, unlinkedClosedAt: "2026-11-16T03:00:00Z" } as const;
const linked = { saleType: "renew", renewedFrom: { contractId: "o", contractNo: "X" }, unlinkedClosedAt: null } as const;
const isNew = { saleType: "new", renewedFrom: null, unlinkedClosedAt: null } as const;

describe("สถานะ + ปุ่มตาม role", () => {
  it("แยกสถานะ 4 แบบ (ไม่มี unlinkedClosedAt = ยังไม่ปิด)", () => {
    expect(unlinkedStateOf(open)).toBe("open");
    expect(unlinkedStateOf(closed)).toBe("closed");
    expect(unlinkedStateOf(linked)).toBe("linked");
    expect(unlinkedStateOf(isNew)).toBe("not-renew");
    expect(unlinkedStateOf({ saleType: "renew", renewedFrom: null })).toBe("open");
  });
  it("host/admin เห็นปุ่มเฉพาะ Renew ที่ยังไม่ผูก (เปิดหรือปิดแล้ว)", () => {
    for (const role of ["host", "admin"] as const) {
      expect(canReviewUnlinked(role, open)).toBe(true);
      expect(canReviewUnlinked(role, closed)).toBe(true);
      expect(canReviewUnlinked(role, linked)).toBe(false);
      expect(canReviewUnlinked(role, isNew)).toBe(false);
    }
  });
  it("role อื่นไม่เห็นปุ่ม", () => {
    for (const role of ["recorder", "viewer"] as const) {
      expect(canReviewUnlinked(role, open)).toBe(false);
    }
  });
});

describe("payload", () => {
  it("หมายเหตุ: ตัดช่องว่าง · ว่าง = null · จำกัดความยาว", () => {
    expect(normalizeCloseNote("  ไม่มีในระบบ  ")).toBe("ไม่มีในระบบ");
    expect(normalizeCloseNote("   ")).toBeNull();
    expect(normalizeCloseNote("ก".repeat(CLOSE_NOTE_MAX + 50))).toHaveLength(CLOSE_NOTE_MAX);
  });
  it("พารามิเตอร์ตรงชื่อ RPC", () => {
    expect(buildCloseParams("c1", " x ")).toEqual({ p_contract_id: "c1", p_note: "x" });
    expect(buildCloseParams("c1", "")).toEqual({ p_contract_id: "c1", p_note: null });
    expect(buildLinkParams("c1", "o1")).toEqual({ p_contract_id: "c1", p_renewed_from_contract_id: "o1" });
  });
  it("คำเตือนใต้ช่องหมายเหตุพูดถึงเบอร์/ที่อยู่", () => {
    expect(CLOSE_NOTE_WARNING).toContain("เบอร์");
    expect(CLOSE_NOTE_WARNING).toContain("ที่อยู่");
  });
});

function fakeClient(error: { code: string } | null) {
  const calls: { fn: string; args: unknown }[] = [];
  const client = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return { data: null, error };
    },
  };
  return { client: client as never, calls };
}

describe("เรียก RPC", () => {
  it("ปิดรายการ → close_unlinked_renewal", async () => {
    const { client, calls } = fakeClient(null);
    expect(await closeUnlinkedRenewal(client, "c1", " หมายเหตุ ")).toEqual({ ok: true });
    expect(calls).toEqual([{ fn: "close_unlinked_renewal", args: { p_contract_id: "c1", p_note: "หมายเหตุ" } }]);
  });
  it("เชื่อมสัญญาเก่า → link_renewal_contract", async () => {
    const { client, calls } = fakeClient(null);
    expect(await linkRenewalContract(client, "c1", "o1")).toEqual({ ok: true });
    expect(calls[0]?.fn).toBe("link_renewal_contract");
  });
  it("error ถูกส่งกลับ ไม่ throw", async () => {
    const { client } = fakeClient({ code: "AG018" });
    const res = await closeUnlinkedRenewal(client, "c1", "");
    expect(res.ok).toBe(false);
  });
});

describe("แปล error (M28b)", () => {
  it("AG018 ปิดไปแล้ว", () => {
    expect(describeDbError({ code: "AG018" }, "close")).toContain("ปิดไปแล้ว");
  });
  it("AG019 แก้ช่องปิดรายการตรงไม่ได้ ให้ใช้ปุ่มปิดรายการ", () => {
    const m = describeDbError({ code: "AG019" }, "save");
    expect(m).toContain("แก้ช่องปิดรายการตรงไม่ได้");
    expect(m).toContain("ไม่มีสัญญาเก่าในระบบ");
  });
  it("AG014 ตอนปิด = ปิดได้เฉพาะ Renew ที่ยังไม่ผูก · ตอนเชื่อมคงข้อความเดิม", () => {
    expect(describeDbError({ code: "AG014" }, "close")).toContain("ปิดรายการได้เฉพาะ");
    expect(describeDbError({ code: "AG014" }, "link")).toContain("ผูกสัญญาเก่าย้อนหลังได้เฉพาะ");
  });
  it("42501 ไม่มีสิทธิ์/นอกขอบเขต แยกข้อความเชื่อม/ปิด", () => {
    expect(describeDbError({ code: "42501" }, "link")).toContain("เชื่อมสัญญาเก่า");
    expect(describeDbError({ code: "42501" }, "close")).toContain("ปิดรายการ");
    expect(describeDbError({ code: "42501" }, "close")).toContain("ขอบเขต");
  });
});

describe("filterByContractNo", () => {
  const list = [{ contractNo: "AGA-2026-001" }, { contractNo: "agb-77" }, { contractNo: "X-100" }];
  it("ว่าง/ช่องว่าง = ทั้งหมด", () => {
    expect(filterByContractNo(list, "")).toHaveLength(3);
    expect(filterByContractNo(list, "   ")).toHaveLength(3);
  });
  it("ไม่สนตัวพิมพ์ + substring + ตัดช่องว่างหัวท้าย", () => {
    expect(filterByContractNo(list, " aga-")).toEqual([{ contractNo: "AGA-2026-001" }]);
    expect(filterByContractNo(list, "AGB")).toEqual([{ contractNo: "agb-77" }]);
    expect(filterByContractNo(list, "100")).toEqual([{ contractNo: "X-100" }]);
  });
  it("ไม่เจอ = ว่าง", () => {
    expect(filterByContractNo(list, "zzz")).toEqual([]);
  });
});

describe("M41: Renew ที่นำเข้า (import_batch)", () => {
  const importedRenew = { saleType: "renew", renewedFrom: null, unlinkedClosedAt: null, importBatch: "central-2026-11" } as const;
  const newRenew = { saleType: "renew", renewedFrom: null, unlinkedClosedAt: null, importBatch: null } as const;
  it("Renew ที่นำเข้า → state imported ไม่ใช่ open (ไม่ขึ้นป้ายยังไม่ผูก)", () => {
    expect(unlinkedStateOf(importedRenew)).toBe("imported");
  });
  it("Renew ที่นำเข้า → ทุก role กดเชื่อมไม่ได้", () => {
    for (const role of ["host", "admin", "recorder", "viewer"] as const) {
      expect(canReviewUnlinked(role, importedRenew)).toBe(false);
    }
  });
  it("Renew ใหม่ import_batch = null → ยังเป็น open + host/admin กดได้ เหมือนเดิม", () => {
    expect(unlinkedStateOf(newRenew)).toBe("open");
    expect(canReviewUnlinked("host", newRenew)).toBe(true);
    expect(canReviewUnlinked("admin", newRenew)).toBe(true);
    expect(canReviewUnlinked("recorder", newRenew)).toBe(false);
  });
  it("นำเข้าแต่ผูกสัญญาเก่าอยู่แล้ว → linked · ไม่ใช่ Renew → not-renew", () => {
    expect(unlinkedStateOf({ ...linked, importBatch: "b" })).toBe("linked");
    expect(unlinkedStateOf({ ...isNew, importBatch: "b" })).toBe("not-renew");
  });
});
