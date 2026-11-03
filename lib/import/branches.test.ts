import { describe, it, expect } from "vitest";
import { BRANCHES, normalizeBranch } from "./branches";

describe("branches master (SPEC §4)", () => {
  it("มีครบ 43 สาขา 13 เขต", () => {
    expect(BRANCHES.length).toBe(43);
    const zones = new Set(BRANCHES.map((b) => b.zone));
    expect(zones.size).toBe(13);
  });

  it("แบ่งหน่วยงาน central 24 / province 19", () => {
    const central = BRANCHES.filter((b) => b.division === "central").length;
    const province = BRANCHES.filter((b) => b.division === "province").length;
    expect(central).toBe(24);
    expect(province).toBe(19);
  });

  it("เขต 9 แยกหน่วยงาน: ปากช่อง/สระบุรี = central, ลพบุรี = province", () => {
    const by = (name: string) => BRANCHES.find((b) => b.name === name);
    expect(by("ปากช่อง")).toMatchObject({ zone: "เขต 9", division: "central" });
    expect(by("สระบุรี")).toMatchObject({ zone: "เขต 9", division: "central" });
    expect(by("ลพบุรี")).toMatchObject({ zone: "เขต 9", division: "province" });
  });

  it("พระราม 2 / ปราจีนบุรี อยู่เขต 13 (ตาม SPEC ไม่ใช่ mockup)", () => {
    const by = (name: string) => BRANCHES.find((b) => b.name === name);
    expect(by("พระราม 2")?.zone).toBe("เขต 13");
    expect(by("ปราจีนบุรี")?.zone).toBe("เขต 13");
  });
});

describe("normalizeBranch", () => {
  it("สาขาถูกต้อง → คืนเขต/หน่วยงาน ไม่มี fix", () => {
    const r = normalizeBranch("หัวหิน");
    expect(r).toMatchObject({ branch: "หัวหิน", zone: "เขต 1", division: "central" });
    expect(r.fix).toBeUndefined();
    expect(r.error).toBeUndefined();
  });

  it("แก้สะกดผิดที่รู้จัก: นนทบรี → นนทบุรี (มี fix)", () => {
    const r = normalizeBranch("นนทบรี");
    expect(r.branch).toBe("นนทบุรี");
    expect(r.zone).toBe("เขต 2");
    expect(r.fix).toContain("นนทบรี");
  });

  it("ต่างแค่ช่องว่าง: พระราม2 → พระราม 2 (มี fix)", () => {
    const r = normalizeBranch("พระราม2");
    expect(r.branch).toBe("พระราม 2");
    expect(r.zone).toBe("เขต 13");
    expect(r.fix).toBeDefined();
  });

  it("trim ช่องว่างหัวท้ายโดยไม่ถือเป็น fix", () => {
    const r = normalizeBranch("  สาทร  ");
    expect(r.branch).toBe("สาทร");
    expect(r.fix).toBeUndefined();
  });

  it("สาขาไม่รู้จัก → error", () => {
    const r = normalizeBranch("สาขาที่ไม่มีจริง");
    expect(r.branch).toBeNull();
    expect(r.error).toBeDefined();
  });

  it("ว่าง → error ไม่มีสาขา", () => {
    const r = normalizeBranch("");
    expect(r.branch).toBeNull();
    expect(r.error).toBeDefined();
  });

  it("งานกรุ๊ป (นอกสาขา) → ไม่มีเขต ไม่ถือว่าผิด", () => {
    const r = normalizeBranch("งานกรุ๊ป (ลูกค้านอกสาขา)");
    expect(r.isGroup).toBe(true);
    expect(r.zone).toBeNull();
    expect(r.error).toBeUndefined();
  });
});
