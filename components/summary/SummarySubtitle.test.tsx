/**
 * เทสคำบรรยายใต้หัวข้อหน้า /summary (DECISIONS 2.116)
 * ข้อความ "หน้า public ไม่มีข้อมูลลูกค้า" แสดงเฉพาะหน้าสาธารณะ (ไม่ login) · อยู่ในกรอบระบบ (login) = ซ่อน · ส่วนอื่นคงเดิม
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SummarySubtitle } from "./SummaryDashboard";

const html = (showPublicNote: boolean) =>
  renderToStaticMarkup(createElement(SummarySubtitle, { branchCount: 43, zoneCount: 13, monthKey: "OCT.26", showPublicNote }));

describe("SummarySubtitle", () => {
  it("หน้าสาธารณะ (ไม่ login) แสดงข้อความหน้า public", () => {
    const out = html(true);
    expect(out).toContain("หน้า public ไม่มีข้อมูลลูกค้า");
    expect(out).toContain("ข้อมูลที่ส่งเข้า AGA Bait Dashboard");
  });
  it("ในกรอบระบบ (login) ซ่อนข้อความหน้า public แต่ส่วนอื่นคงเดิม", () => {
    const out = html(false);
    expect(out).not.toContain("หน้า public");
    expect(out).toContain("ทั่วไทย 43 สาขา");
    expect(out).toContain("13 เขต");
    expect(out).toContain("Status snapshot (OCT.26)");
    expect(out).toContain("ข้อมูลที่ส่งเข้า AGA Bait Dashboard");
  });
});
