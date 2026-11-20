import { describe, expect, it } from "vitest";

import { toContractRow } from "../customer-detail/data";
import { igCollectState, icHanded, primaryContract } from "../customer-detail/logic";
import { effectiveContractStatus, isContractEnded, type ContractStatusAny } from "./contractEnd";
import { summarizeCollect } from "./logic";

// ข้อมูลทดสอบสมมติทั้งหมด
const today = "2026-11-20";

describe("isContractEnded — นิยามกลาง", () => {
  it("active: วันสิ้นสุดก่อนวันนี้ = หมดอายุ · วันสุดท้าย (= วันนี้) ยังไม่หมด · อนาคตยังไม่หมด", () => {
    expect(isContractEnded({ status: "active", endDate: "2026-11-19" }, today)).toBe(true);
    expect(isContractEnded({ status: "active", endDate: "2026-11-20" }, today)).toBe(false);
    expect(isContractEnded({ status: "active", endDate: "2027-01-01" }, today)).toBe(false);
  });
  it("expired_pending_collection / closed / cancelled = จบ ไม่ว่าวันสิ้นสุดอยู่ที่ไหน", () => {
    for (const status of ["expired_pending_collection", "closed", "cancelled"] as const) {
      expect(isContractEnded({ status, endDate: "2030-01-01" }, today)).toBe(true);
      expect(isContractEnded({ status, endDate: "2020-01-01" }, today)).toBe(true);
    }
  });
  it("paused = ไม่จบเสมอ แม้เลยวันสิ้นสุด (DB กันเก็บ CP010)", () => {
    expect(isContractEnded({ status: "paused", endDate: "2030-01-01" }, today)).toBe(false);
    expect(isContractEnded({ status: "paused", endDate: "2020-01-01" }, today)).toBe(false);
  });
});

describe("effectiveContractStatus", () => {
  it("active ที่หมดอายุ → expired_pending_collection · อย่างอื่นคงเดิม", () => {
    expect(effectiveContractStatus("active", "2026-11-19", today)).toBe("expired_pending_collection");
    expect(effectiveContractStatus("active", "2026-11-20", today)).toBe("active");
    const keep: ContractStatusAny[] = ["paused", "expired_pending_collection", "closed", "cancelled"];
    for (const s of keep) expect(effectiveContractStatus(s, "2020-01-01", today)).toBe(s);
  });
  it("สอดคล้องกับ isContractEnded: สถานะที่แปลงแล้ว 'จบ' ⇔ isContractEnded", () => {
    const all: ContractStatusAny[] = ["active", "paused", "expired_pending_collection", "closed", "cancelled"];
    for (const status of all) {
      for (const endDate of ["2020-01-01", today, "2030-01-01"]) {
        const eff = effectiveContractStatus(status, endDate, today);
        const endedByStatus = eff === "expired_pending_collection" || eff === "closed" || eff === "cancelled";
        expect(endedByStatus).toBe(isContractEnded({ status, endDate }, today));
      }
    }
  });
});

describe("หน้ารายละเอียดลูกค้า: toContractRow ใช้นิยามเดียวกัน", () => {
  const db = (over: Record<string, unknown>) =>
    ({
      id: "c1",
      contract_no: "TS-1",
      customer_id: "u1",
      start_date: "2025-01-15",
      end_date: null,
      term_months: 12,
      value_total: 60000,
      sale_type: "new",
      status: "active",
      closed_at: null,
      cancelled_at: null,
      renewed_from_contract_id: null,
      stations_initialized_at: null,
      contract_teams: [],
      ...over,
    }) as never;
  const rules = [{ tier: "S", minAnnual: 0 }, { tier: "M", minAnnual: 30000 }] as never;

  it("active ที่เลยวันสิ้นสุด (ไม่มี end_date ใช้กฎ เริ่ม 15/1/2025 + 12 เดือน − 1 วัน = 14/1/2026) → หมดสัญญา รอเก็บ · เก็บสถานะดิบไว้", () => {
    const r = toContractRow(db({}), rules, today);
    expect(r.status).toBe("expired_pending_collection");
    expect(r.dbStatus).toBe("active");
  });
  it("ใช้ end_date ถ้ามี: ยังไม่ถึง → active · วันสุดท้ายวันนี้ → active", () => {
    expect(toContractRow(db({ end_date: "2026-12-31" }), rules, today).status).toBe("active");
    expect(toContractRow(db({ end_date: today }), rules, today).status).toBe("active");
    expect(toContractRow(db({ end_date: "2026-11-19" }), rules, today).status).toBe("expired_pending_collection");
  });
  it("paused เลยวัน / closed / cancelled คงสถานะเดิม", () => {
    expect(toContractRow(db({ status: "paused" }), rules, today).status).toBe("paused");
    expect(toContractRow(db({ status: "closed" }), rules, today).status).toBe("closed");
    expect(toContractRow(db({ status: "cancelled" }), rules, today).status).toBe("cancelled");
  });
  it("สัญญาที่หมดอายุแล้ว: สถานี IG = รอเก็บ · IC = มอบให้ลูกค้า · เป็นสัญญาหลักเมื่อไม่มีสัญญา active", () => {
    const ended = toContractRow(db({}), rules, today);
    const ig = { type: "IG", status: "active", collectedAt: null, notCollectedOn: null } as never;
    const ic = { type: "IC", status: "active" } as never;
    expect(igCollectState(ig, ended)).toBe("pending");
    expect(icHanded(ic, ended)).toBe("expired");
    expect(primaryContract([ended])?.status).toBe("expired_pending_collection");
  });
  it("สัญญาใช้งานจริงยังเป็นหัวการ์ด แม้มีสัญญาเก่าที่หมดอายุ · paused มาก่อนสัญญาหมดอายุ", () => {
    const ended = toContractRow(db({ id: "old", start_date: "2024-01-01" }), rules, today);
    const active = toContractRow(db({ id: "now", start_date: "2026-06-01" }), rules, today);
    const paused = toContractRow(db({ id: "pz", start_date: "2025-05-01", status: "paused" }), rules, today);
    expect(primaryContract([ended, active])?.id).toBe("now");
    expect(primaryContract([ended, paused])?.id).toBe("pz");
  });
});

describe("/todo: summarizeCollect ใช้นิยามกลางเดียวกัน", () => {
  it("นับเฉพาะสัญญาจบแล้ว: active หมดอายุ นับ · paused ไม่นับ", () => {
    const s = summarizeCollect(
      [
        { customerId: "a", remaining: 2, status: "active", endDate: "2026-11-19" },
        { customerId: "b", remaining: 5, status: "paused", endDate: "2026-01-01" },
        { customerId: "c", remaining: 3, status: "active", endDate: today },
      ],
      today,
    );
    expect(s).toEqual({ customers: 1, stations: 2 });
  });
});
