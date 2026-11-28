/**
 * ชั้น DB ของงานเติมวันที่ — ใช้ client ปลอม (บันทึกทุกคำสั่งที่เรียก) ไม่ต่อฐานข้อมูลจริง
 * ข้อมูลสมมติทั้งหมด
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { runGuarded } from "./cloudGuard";
import { planJobOpeningBackfill } from "./jobOpeningBackfill";
import { applyBackfill, parseRunLog, readDbTargets, rollbackBackfill, type RunLogEntry } from "./jobOpeningBackfillDb";
import type { JobOpeningIndex } from "./jobOpeningServiceDates";

type Call = { method: string; args: unknown[] };
type Row = Record<string, unknown>;

/**
 * client ปลอมแบบง่าย: ทุก method คืน builder ตัวเดิม · await builder → ผลของ respond()
 * calls = ทุก method ที่ถูกเรียก (ใช้พิสูจน์ว่าไม่มีการเขียน)
 */
function fakeClient(respond: (calls: Call[]) => { data: Row[] | null; error: null | { message: string } }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const local: Call[] = [{ method: "from", args: [table] }];
      calls.push(local[0]!);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "in", "eq", "is", "order", "range", "update", "insert", "upsert", "delete"]) {
        builder[m] = (...args: unknown[]) => {
          const c = { method: m, args };
          calls.push(c);
          local.push(c);
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        try {
          resolve(respond(local));
        } catch (e) {
          reject(e);
        }
      };
      return builder;
    },
    rpc: (...args: unknown[]) => {
      calls.push({ method: "rpc", args });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const WRITE_METHODS = ["update", "insert", "upsert", "delete", "rpc"];

function dbRow(no: string, more: Row = {}): Row {
  return {
    id: `id-${no}`,
    contract_no: no,
    import_batch: "registry-OCT26",
    status: "active",
    start_date: "2026-10-01",
    end_date: "2027-09-30",
    sale_type: "new",
    mail_received_date: null,
    first_service_date: null,
    first_service_time: null,
    ...more,
  };
}

const INDEX: JobOpeningIndex = {
  entries: new Map([
    [
      "CT26-0000001",
      {
        contractNo: "CT26-0000001",
        occurrences: [{ source: "2569", sheet: "ต.ค.26", excelRow: 4 }],
        branchText: "สาทร",
        mail: { value: "2026-09-28", conflict: false, hadProblem: false },
        service: { value: "2026-10-03", conflict: false, hadProblem: false },
        time: { value: "09:00", conflict: false, hadProblem: false },
        timeFromRange: false,
      },
    ],
  ]),
  sheets: [],
  sheetsSkipped: [],
  problems: [],
  duplicates: [],
};

describe("readDbTargets", () => {
  it("อ่านตามเลข (แบ่งก้อน 200) + ทั้ง batch (แบ่งหน้า 1,000) · รวมไม่ซ้ำ · แปลงเวลา HH:MM:SS → HH:MM", async () => {
    const nos = Array.from({ length: 450 }, (_, i) => `CT26-${String(i).padStart(7, "0")}`);
    const batchRows = Array.from({ length: 1500 }, (_, i) => dbRow(`CT25-${String(i).padStart(7, "0")}`));
    const { client, calls } = fakeClient((local) => {
      const inCall = local.find((c) => c.method === "in")!;
      if (inCall.args[0] === "contract_no") {
        const part = inCall.args[1] as string[];
        return { data: part.slice(0, 1).map((n) => dbRow(n, { first_service_date: "2026-10-03", first_service_time: "09:00:00" })), error: null };
      }
      const range = local.find((c) => c.method === "range")!.args as [number, number];
      return { data: batchRows.slice(range[0], range[1] + 1), error: null };
    });
    const targets = await readDbTargets(client, { contractNos: nos, batches: ["registry-OCT26"] });
    expect(calls.filter((c) => c.method === "in" && c.args[0] === "contract_no").map((c) => (c.args[1] as string[]).length)).toEqual([200, 200, 50]);
    expect(calls.filter((c) => c.method === "range").map((c) => c.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(targets).toHaveLength(3 + 1500);
    expect(targets[0]).toMatchObject({ contractNo: "CT26-0000000", serviceDate: "2026-10-03", serviceTime: "09:00" });
    expect(calls.some((c) => WRITE_METHODS.includes(c.method))).toBe(false);
  });

  it("error ของ DB → throw (ข้อความไม่มีค่าในแถว)", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: "permission denied" } }));
    await expect(readDbTargets(client, { contractNos: ["CT26-0000001"], batches: [] })).rejects.toThrow(/permission denied/);
  });
});

describe("โหมด --db (dry-run อ่าน DB) บน cloud: ไม่เขียน ไม่ถามยืนยัน", () => {
  it("runGuarded target cloud + apply false → อ่านอย่างเดียว · ไม่เรียก update/insert/upsert/delete/rpc · ไม่ถาม", async () => {
    const { client, calls } = fakeClient((local) =>
      local.some((c) => c.method === "range") && (local.find((c) => c.method === "range")!.args[0] as number) > 0
        ? { data: [], error: null }
        : { data: [dbRow("CT26-0000001")], error: null },
    );
    let asked = 0;
    let wrote = 0;
    const targets = await readDbTargets(client, { contractNos: [...INDEX.entries.keys()], batches: ["registry-OCT26"] });
    const plan = planJobOpeningBackfill(INDEX, targets, { fillBatches: ["registry-OCT26"] });
    const out = await runGuarded({
      target: { kind: "cloud", ref: "fakeref" },
      apply: false,
      action: "import",
      dryRun: async () => plan,
      confirmCount: (p) => p.counts.contractsToUpdate,
      describe: () => "",
      write: async () => {
        wrote += 1;
        return applyBackfill(client, plan.updates, { onWritten: () => {} });
      },
      ask: async () => {
        asked += 1;
        return null;
      },
      isTTY: false,
      print: () => {},
    });
    expect(out.status).toBe("dry-run");
    expect(plan.counts.contractsToUpdate).toBe(1);
    expect(asked).toBe(0);
    expect(wrote).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => WRITE_METHODS.includes(c.method))).toEqual([]);
  });
});

describe("applyBackfill", () => {
  it("PATCH ทีละสัญญา: update(set).eq(id).is(ช่อง, null) · เวลาอย่างเดียวเพิ่ม eq(วันที่) · 0 แถว = changedSinceRead", async () => {
    let n = 0;
    const { client, calls } = fakeClient(() => {
      n += 1;
      return { data: n === 2 ? [] : [{ id: "x" }], error: null };
    });
    const written: RunLogEntry[] = [];
    const res = await applyBackfill(
      client,
      [
        { id: "id-1", contractNo: "CT26-0000001", set: { mail_received_date: "2026-09-28", first_service_date: "2026-10-03" } },
        { id: "id-2", contractNo: "CT26-0000002", set: { mail_received_date: "2026-09-28" } },
        { id: "id-3", contractNo: "CT26-0000003", set: { first_service_time: "09:00" }, requireServiceDate: "2026-10-03" },
      ],
      { onWritten: (e) => written.push(e) },
    );
    expect(res).toEqual({ written: 2, changedSinceRead: ["CT26-0000002"] });
    expect(written.map((w) => w.contractNo)).toEqual(["CT26-0000001", "CT26-0000003"]);
    const seq = calls.map((c) => [c.method, ...c.args]);
    expect(seq.slice(0, 6)).toEqual([
      ["from", "contracts"],
      ["update", { mail_received_date: "2026-09-28", first_service_date: "2026-10-03" }],
      ["eq", "id", "id-1"],
      ["is", "mail_received_date", null],
      ["is", "first_service_date", null],
      ["select", "id"],
    ]);
    expect(seq.slice(-6)).toEqual([
      ["from", "contracts"],
      ["update", { first_service_time: "09:00" }],
      ["eq", "id", "id-3"],
      ["is", "first_service_time", null],
      ["eq", "first_service_date", "2026-10-03"],
      ["select", "id"],
    ]);
    expect(calls.some((c) => ["insert", "upsert", "delete", "rpc"].includes(c.method))).toBe(false);
  });

  it("แผนที่ไม่มี id (โหมดไฟล์) = หยุดก่อนเขียน", async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null }));
    await expect(applyBackfill(client, [{ id: null, contractNo: "CT26-0000001", set: { mail_received_date: "2026-09-28" } }], { onWritten: () => {} })).rejects.toThrow(/ไม่มี id/);
    expect(calls).toEqual([]);
  });

  it("error ระหว่างเขียน → throw พร้อมจำนวนที่เขียนไปแล้ว", async () => {
    let n = 0;
    const { client } = fakeClient(() => {
      n += 1;
      return n === 1 ? { data: [{ id: "x" }], error: null } : { data: null, error: { message: "boom" } };
    });
    await expect(
      applyBackfill(
        client,
        [
          { id: "id-1", contractNo: "CT26-0000001", set: { mail_received_date: "2026-09-28" } },
          { id: "id-2", contractNo: "CT26-0000002", set: { mail_received_date: "2026-09-28" } },
        ],
        { onWritten: () => {} },
      ),
    ).rejects.toThrow(/เขียนแล้ว 1 สัญญา.*boom/);
  });
});

describe("rollbackBackfill / parseRunLog", () => {
  it("ตั้งกลับเป็น NULL เฉพาะช่องที่เติม + ค่ายังเท่าเดิม · ถอยวันที่โดยไม่ได้เติมเวลา → ต้องไม่มีเวลา", async () => {
    let n = 0;
    const { client, calls } = fakeClient(() => {
      n += 1;
      return { data: n === 2 ? [] : [{ id: "x" }], error: null };
    });
    const res = await rollbackBackfill(client, [
      { id: "id-1", contractNo: "CT26-0000001", set: { first_service_date: "2026-10-03" } },
      { id: "id-2", contractNo: "CT26-0000002", set: { mail_received_date: "2026-09-28" } },
    ]);
    expect(res).toEqual({ reverted: 1, skipped: ["CT26-0000002"] });
    expect(calls.slice(0, 6).map((c) => [c.method, ...c.args])).toEqual([
      ["from", "contracts"],
      ["update", { first_service_date: null }],
      ["eq", "id", "id-1"],
      ["eq", "first_service_date", "2026-10-03"],
      ["is", "first_service_time", null],
      ["select", "id"],
    ]);
  });

  it("อ่าน JSON Lines · บรรทัดเสีย/ช่องแปลก = หยุด", () => {
    const ok = `${JSON.stringify({ id: "a", contractNo: "CT26-0000001", set: { mail_received_date: "2026-09-28" } })}\n\n`;
    expect(parseRunLog(ok)).toEqual([{ id: "a", contractNo: "CT26-0000001", set: { mail_received_date: "2026-09-28" } }]);
    expect(() => parseRunLog("{oops")).toThrow(/บรรทัด 1/);
    expect(() => parseRunLog(JSON.stringify({ id: "a", contractNo: "x", set: { status: "closed" } }))).toThrow(/รูปแบบ/);
    expect(() => parseRunLog(JSON.stringify({ id: "a", contractNo: "x", set: {} }))).toThrow(/รูปแบบ/);
  });
});
