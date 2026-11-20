import { describe, expect, it } from "vitest";

import {
  DEFAULT_SALES_LOAD_OPTIONS,
  EXCLUDE_CANCELLED,
  KEEP_UNLESS_ENTRY_ERROR_CANCELLED,
  EXCLUDE_IMPORTED,
  SALES_MAX_ROWS,
  SALES_PAGE_CHUNK,
  loadSalesRows,
  toSalesRow,
  type SalesRowDb,
} from "./salesData";

// ข้อมูลทดสอบสมมติทั้งหมด
const base: SalesRowDb = {
  id: "c1",
  customer_id: "u1",
  sale_type: "renew",
  sale_name: " ผู้ขาย 1 ",
  am_name: "",
  mail_received_date: "2026-11-16",
  value_total: "12345.50",
  customers: {
    name: "ลูกค้าทดสอบ",
    branch_id: "b1",
    branches: { name: "สาขา ก", zone_id: "z1", zones: { name: "เขต 1", sort_order: 1 } },
  },
};

// stub ของ isLateRenewal ในเทสต์เท่านั้น (สูตรจริงอยู่ lib/rules/lateRenewal.ts และมีเทสต์ของตัวเอง)
const lateStub = (t: string, d: string | null) => t === "renew" && !!d && Number(d.slice(8, 10)) > 15;

describe("toSalesRow", () => {
  it("แปลงแถว · ตัดช่องว่างชื่อ · ชื่อว่าง = null · มูลค่าเป็นตัวเลข · ส่งผลล่าช้าจากฟังก์ชันที่ฉีดเข้ามา", () => {
    const r = toSalesRow(base, lateStub);
    expect(r).toMatchObject({
      contractId: "c1",
      customerId: "u1",
      branchName: "สาขา ก",
      zoneName: "เขต 1",
      zoneOrder: 1,
      saleType: "renew",
      saleName: "ผู้ขาย 1",
      amName: null,
      valueTotal: 12345.5,
      isLate: true,
    });
  });
  it("embed เขตเป็น array ก็อ่านได้", () => {
    const r = toSalesRow({ ...base, customers: { ...base.customers!, branches: { ...base.customers!.branches!, zones: [{ name: "เขต 2", sort_order: 2 }] } } }, lateStub);
    expect(r?.zoneName).toBe("เขต 2");
  });
  it("ไม่ใช่ New/Renew หรือขาดสาขา/เขต = ข้าม (null)", () => {
    expect(toSalesRow({ ...base, sale_type: null }, lateStub)).toBeNull();
    expect(toSalesRow({ ...base, sale_type: "other" }, lateStub)).toBeNull();
    expect(toSalesRow({ ...base, customers: null }, lateStub)).toBeNull();
    expect(toSalesRow({ ...base, customers: { ...base.customers!, branches: null } }, lateStub)).toBeNull();
  });
  it("ไม่มีวันที่รับ Mail = mailDate null · มูลค่าผิดรูปแบบ = 0", () => {
    const r = toSalesRow({ ...base, mail_received_date: null, value_total: "abc" }, lateStub);
    expect(r).toMatchObject({ mailDate: null, valueTotal: 0, isLate: false });
  });
});

// ตัวปลอมของ Supabase query builder: บันทึกทุกการเรียก และตอบตามชนิด query (นับ head / หน้าข้อมูล)
type Call = [string, unknown[]];
interface Script {
  pages: (from: number) => { data: SalesRowDb[] | null; count?: number | null; error?: { code?: string; message: string } | null };
  noMail?: { count: number | null; error?: { code?: string; message: string } | null };
}
function fakeSupabase(script: Script) {
  const builders: { calls: Call[]; head: boolean; from: number }[] = [];
  const client = {
    from() {
      const b = { calls: [] as Call[], head: false, from: 0 };
      builders.push(b);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "not", "gte", "is", "or", "order", "range"]) {
        chain[m] = (...args: unknown[]) => {
          b.calls.push([m, args]);
          if (m === "select" && (args[1] as { head?: boolean } | undefined)?.head) b.head = true;
          if (m === "range") b.from = args[0] as number;
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => void) =>
        resolve(b.head ? { data: null, count: script.noMail?.count ?? 0, error: script.noMail?.error ?? null } : { error: null, ...script.pages(b.from) });
      return chain;
    },
  };
  return { client: client as never, builders };
}
const names = (b: { calls: Call[] }) => b.calls.map((c) => c[0]);
const hasCall = (b: { calls: Call[] }, name: string, ...args: unknown[]) =>
  b.calls.some((c) => c[0] === name && args.every((a, i) => c[1][i] === a));
const rowsOf = (n: number, from = 0): SalesRowDb[] => Array.from({ length: n }, (_, i) => ({ ...base, id: `c${from + i}` }));

describe("loadSalesRows", () => {
  it("วันที่หน้าต่างรูปแบบผิด = ไม่ยิง query (คืน code)", async () => {
    const supabase = { from: () => { throw new Error("ต้องไม่ถูกเรียก"); } };
    const res = await loadSalesRows(supabase as never, "2026-11; drop", lateStub);
    expect(res).toEqual({ ok: false, code: "bad_window" });
  });

  it("query หลักเอาเฉพาะแถวที่มีวันที่รับ Mail ในช่วง (gte) · ไม่ดึงแถว null มาทั้งชุด · แยก query นับแบบ head", async () => {
    const { client, builders } = fakeSupabase({
      pages: () => ({ data: [base, { ...base, id: "c2", sale_type: null }], count: 2 }),
      noMail: { count: 2369 },
    });
    const res = await loadSalesRows(client, "2026-08-01", lateStub);
    expect(res.ok && res.rows.length).toBe(1); // แถว sale_type null ถูกข้าม
    expect(res.ok && res.noMailCount).toBe(2369);
    expect(res.ok && res.truncated).toBe(false);
    const main = builders.find((b) => !b.head)!;
    const count = builders.find((b) => b.head)!;
    expect(hasCall(main, "gte", "mail_received_date", "2026-08-01")).toBe(true);
    expect(hasCall(count, "is", "mail_received_date", null)).toBe(true);
    expect(names(count)).not.toContain("range"); // query นับไม่ดึงแถว
    // ไม่ใช้ "mail_received_date หรือ null" อีกแล้ว (เงื่อนไข or ที่เหลือมีแค่ตัวกรองสัญญายกเลิก)
    expect(main.calls.filter((c) => c[0] === "or").every((c) => c[1][0] === KEEP_UNLESS_ENTRY_ERROR_CANCELLED)).toBe(true);
    expect(builders).toHaveLength(2);
  });

  it("ข้อมูลเกินเพดาน → โหลดเท่าเพดาน + truncated=true (ไม่ตัดเงียบ)", async () => {
    const total = SALES_MAX_ROWS + 700;
    const { client, builders } = fakeSupabase({
      pages: (from) => ({ data: rowsOf(SALES_PAGE_CHUNK, from), count: total }),
    });
    const res = await loadSalesRows(client, "2026-08-01", lateStub);
    expect(res.ok && res.truncated).toBe(true);
    expect(res.ok && res.rows.length).toBe(SALES_MAX_ROWS);
    // หน้าหลัก 5 ครั้ง (ไม่เกินเพดาน) + query นับ 1 ครั้ง
    expect(builders.filter((b) => !b.head)).toHaveLength(SALES_MAX_ROWS / SALES_PAGE_CHUNK);
  });

  it("เท่าเพดานพอดี = ไม่ truncated", async () => {
    const { client } = fakeSupabase({ pages: (from) => ({ data: rowsOf(SALES_PAGE_CHUNK, from), count: SALES_MAX_ROWS }) });
    const res = await loadSalesRows(client, "2026-08-01", lateStub);
    expect(res.ok && res.truncated).toBe(false);
    expect(res.ok && res.rows.length).toBe(SALES_MAX_ROWS);
  });

  it("error จากฐานข้อมูล (query หลัก / query นับ) คืนแค่ code ไม่คืนข้อความดิบ", async () => {
    const a = fakeSupabase({ pages: () => ({ data: null, error: { code: "42501", message: "ข้อมูลลูกค้า" } }) });
    expect(await loadSalesRows(a.client, "2026-08-01", lateStub)).toEqual({ ok: false, code: "42501" });
    const b = fakeSupabase({ pages: () => ({ data: [] , count: 0 }), noMail: { count: null, error: { code: "57014", message: "ข้อมูลลูกค้า" } } });
    expect(await loadSalesRows(b.client, "2026-08-01", lateStub)).toEqual({ ok: false, code: "57014" });
  });

  it("ค่าเริ่มต้น (2.91 ล่าสุด): ไม่นับสัญญายกเลิกเพราะลงข้อมูลผิด · นับสัญญานำเข้า — ทั้ง query หลักและ query นับ", async () => {
    expect(EXCLUDE_CANCELLED).toBe(true);
    expect(EXCLUDE_IMPORTED).toBe(false);
    expect(DEFAULT_SALES_LOAD_OPTIONS).toEqual({ excludeCancelled: true, excludeImported: false });
    const { client, builders } = fakeSupabase({ pages: () => ({ data: [], count: 0 }) });
    await loadSalesRows(client, "2026-08-01", lateStub);
    expect(builders).toHaveLength(2);
    for (const b of builders) {
      expect(hasCall(b, "or", KEEP_UNLESS_ENTRY_ERROR_CANCELLED)).toBe(true);
      expect(hasCall(b, "is", "import_batch", null)).toBe(false);
    }
  });

  it("ตัวเลือกปิดทั้งคู่ (นับทุกสัญญา) ยังทำงานได้", async () => {
    const { client, builders } = fakeSupabase({ pages: () => ({ data: [], count: 0 }) });
    await loadSalesRows(client, "2026-08-01", lateStub, { excludeCancelled: false, excludeImported: false });
    for (const b of builders) {
      expect(names(b)).not.toContain("or");
      expect(hasCall(b, "is", "import_batch", null)).toBe(false);
    }
  });

  it("excludeCancelled = true → ใส่เงื่อนไขตัดเฉพาะ cancelled+entry_error ทั้ง 2 query", async () => {
    const { client, builders } = fakeSupabase({ pages: () => ({ data: [], count: 0 }) });
    await loadSalesRows(client, "2026-08-01", lateStub, { excludeCancelled: true, excludeImported: false });
    for (const b of builders) {
      expect(hasCall(b, "or", KEEP_UNLESS_ENTRY_ERROR_CANCELLED)).toBe(true);
      expect(hasCall(b, "is", "import_batch", null)).toBe(false);
    }
  });

  it("excludeImported = true → เอาเฉพาะ import_batch ว่าง ทั้ง 2 query", async () => {
    const { client, builders } = fakeSupabase({ pages: () => ({ data: [], count: 0 }) });
    await loadSalesRows(client, "2026-08-01", lateStub, { excludeCancelled: false, excludeImported: true });
    for (const b of builders) {
      expect(hasCall(b, "is", "import_batch", null)).toBe(true);
      expect(names(b)).not.toContain("or");
    }
  });

  it("เปิดทั้งสองตัวกรองพร้อมกันได้", async () => {
    const { client, builders } = fakeSupabase({ pages: () => ({ data: [], count: 0 }) });
    await loadSalesRows(client, "2026-08-01", lateStub, { excludeCancelled: true, excludeImported: true });
    for (const b of builders) {
      expect(hasCall(b, "or", KEEP_UNLESS_ENTRY_ERROR_CANCELLED)).toBe(true);
      expect(hasCall(b, "is", "import_batch", null)).toBe(true);
    }
  });
});

// ประเมินเงื่อนไข `or` ของ PostgREST แบบ SQL (เทียบ NULL ได้ "ไม่รู้" = ไม่ผ่าน) เพื่อตรวจว่าแถวไหนถูกเก็บ/ตัดจริง
function keeps(row: { status: string; cancel_reason_code: string | null }): boolean {
  const cond = (c: string): boolean => {
    const [col, op, ...rest] = c.split(".");
    const v = (row as Record<string, string | null>)[col!];
    const arg = rest.join(".");
    if (op === "is" && arg === "null") return v === null;
    if (op === "neq") return v !== null && v !== arg; // NULL <> x = ไม่รู้ → ไม่ผ่าน
    throw new Error("เงื่อนไขที่เทสต์ไม่รู้จัก: " + c);
  };
  return KEEP_UNLESS_ENTRY_ERROR_CANCELLED.split(",").some(cond);
}

describe("เงื่อนไขตัดสัญญายกเลิกเพราะลงข้อมูลผิด (2.91)", () => {
  it("ตัดเฉพาะ cancelled + entry_error", () => {
    expect(keeps({ status: "cancelled", cancel_reason_code: "entry_error" })).toBe(false);
  });
  it("ยังนับ: cancelled เพราะลูกค้ายกเลิกจริง / อื่นๆ / ไม่มีเหตุผล", () => {
    expect(keeps({ status: "cancelled", cancel_reason_code: "customer_cancelled" })).toBe(true);
    expect(keeps({ status: "cancelled", cancel_reason_code: "other" })).toBe(true);
    expect(keeps({ status: "cancelled", cancel_reason_code: null })).toBe(true);
  });
  it("ยังนับ: สัญญาที่ไม่ได้ยกเลิก (ทุกสถานะ) แม้มีค่าเหตุผลค้าง", () => {
    for (const status of ["active", "paused", "expired_pending_collection", "closed"]) {
      expect(keeps({ status, cancel_reason_code: null })).toBe(true);
      expect(keeps({ status, cancel_reason_code: "entry_error" })).toBe(true);
    }
  });
});
