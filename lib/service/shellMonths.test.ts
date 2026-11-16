import { describe, expect, it } from "vitest";

import { buildShellMonths, goLiveToMonthKey, loadShellMonths } from "./shellMonths";

describe("buildShellMonths", () => {
  it("ใหม่→เก่า จากเดือนปัจจุบันถึง go-live", () => {
    const r = buildShellMonths("2026-10", "2026-12");
    expect(r.map((x) => x.value)).toEqual(["2026-12", "2026-11", "2026-10"]);
    expect(r[2]?.label).toBe("ตุลาคม 2026");
  });
  it("ข้ามปีและจำกัด 36 เดือน", () => {
    const r = buildShellMonths("2020-01", "2027-01");
    expect(r).toHaveLength(36);
    expect(r[0]?.value).toBe("2027-01");
  });
  it("ยังไม่ถึง go-live = แสดงเดือน go-live เดือนเดียว", () => {
    expect(buildShellMonths("2026-10", "2026-09").map((x) => x.value)).toEqual(["2026-10"]);
  });
  it("อ่านไม่ได้ = ค่าสำรอง เฉพาะเดือนปัจจุบัน", () => {
    expect(buildShellMonths(null, "2026-11").map((x) => x.value)).toEqual(["2026-11"]);
  });
});

describe("goLiveToMonthKey", () => {
  it("แปลงวันที่ และปฏิเสธค่าผิด", () => {
    expect(goLiveToMonthKey("2026-10-01")).toBe("2026-10");
    expect(goLiveToMonthKey("oops")).toBeNull();
    expect(goLiveToMonthKey(null)).toBeNull();
    expect(goLiveToMonthKey("2026-13-01")).toBeNull();
  });
});

describe("loadShellMonths", () => {
  const now = new Date("2026-11-16T05:00:00Z");
  const client = (rpc: () => Promise<{ data: unknown; error: unknown }>) => ({ rpc }) as never;
  it("อ่านจาก RPC go_live_month", async () => {
    const r = await loadShellMonths(client(async () => ({ data: "2026-10-01", error: null })), now);
    expect(r.map((x) => x.value)).toEqual(["2026-11", "2026-10"]);
  });
  it("RPC error / throw = ค่าสำรอง ไม่ล้ม", async () => {
    const e = await loadShellMonths(client(async () => ({ data: null, error: { code: "42501" } })), now);
    expect(e.map((x) => x.value)).toEqual(["2026-11"]);
    const t = await loadShellMonths(client(async () => { throw new Error("net"); }), now);
    expect(t.map((x) => x.value)).toEqual(["2026-11"]);
  });
});
