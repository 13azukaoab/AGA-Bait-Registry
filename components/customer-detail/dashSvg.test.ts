import { describe, expect, it } from "vitest";

import { dashSvg, esc } from "./dashSvg";
import type { DashMonth } from "./logic";

const row = (o: Partial<DashMonth> & { month: string }): DashMonth => ({
  state: "ok",
  ig: 0,
  ic: 0,
  ag: 0,
  ext: 0,
  t: 0,
  igL: [],
  icL: [],
  agL: [],
  tL: [],
  ...o,
});

describe("dashSvg", () => {
  const rows = [row({ month: "2026-01", ig: 2, ext: 2, igL: ["IG-1", "IG-2"], t: 1, tL: ["IG-3"] }), row({ month: "2026-02", state: "miss" })];
  it("esc ป้องกัน HTML จากข้อมูล", () => {
    expect(esc('<b>"x"&')).toBe("&lt;b&gt;&quot;x&quot;&amp;");
  });
  it("วาด 2 ช่วง + ตัวเลขบนแท่ง + ป้าย ตก", () => {
    const s = dashSvg(rows, { ext: true, ag: true, timber: true });
    expect(s.startsWith("<svg")).toBe(true);
    expect(s).toContain("พบปลวก (จุด)");
    expect(s).toContain("เปลี่ยนไม้ (จุด)");
    expect(s).toContain(">ตก<");
    expect(s).toContain("IG-1, IG-2");
  });
  it("ปิดช่วงที่ไม่เลือก", () => {
    expect(dashSvg(rows, { ext: false, ag: false, timber: true })).not.toContain("พบปลวก (จุด)");
    expect(dashSvg(rows, { ext: true, ag: false, timber: false })).not.toContain("เปลี่ยนไม้ (จุด)");
  });
  it("ส่งออกมีหัวกระดาษ + ไม่มีตัวอักษรเล็กกว่า 12px", () => {
    const s = dashSvg(rows, { ext: true, ag: true, timber: true }, { hdr: { t1: "หัว <x>", t2: "รอง", foot: "ท้าย" } });
    expect(s).toContain("หัว &lt;x&gt;");
    const sizes = [...s.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });
});
