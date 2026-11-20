import { describe, expect, it } from "vitest";

import { canAccessPath } from "../../lib/auth/access";
import {
  countActiveFilters,
  defaultFilters,
  filtersFromParams,
  filtersToParams,
  MAX_SEARCH_LENGTH,
  needsPostFilter,
  nextSort,
  sortDirection,
  sanitizeSearch,
} from "./registryFilters";

const Z1 = "11111111-1111-4111-8111-111111111111";
const B1 = "22222222-2222-4222-8222-222222222222";

describe("registryFilters", () => {
  it("ค่าเริ่มต้น: ไม่มีตัวกรอง เรียงค่าเริ่มต้น", () => {
    const f = defaultFilters();
    expect(countActiveFilters(f)).toBe(0);
    expect(f.sort).toBe("default");
    expect(filtersToParams(f).toString()).toBe("");
  });

  it("แปลงไป-กลับกับ URL ได้ครบทุกตัวกรอง", () => {
    const f = { zones: [Z1], branches: [B1], sizes: ["L", "XL"] as const, years: "3" as const, statuses: ["near_end", "ended"] as const, sort: "end_asc" as const };
    const params = filtersToParams({ ...f, sizes: [...f.sizes], statuses: [...f.statuses] });
    expect(filtersFromParams(new URLSearchParams(params.toString()))).toEqual({ ...f, sizes: [...f.sizes], statuses: [...f.statuses] });
  });

  it("ค่าที่ผิดรูปแบบถูกทิ้ง (id ไม่ใช่ uuid · enum แปลก · sort แปลก)", () => {
    const f = filtersFromParams(new URLSearchParams(`zone=${Z1},drop%20table&br=abc&size=S,XXL&yr=9&st=active,evil&sort=name`));
    expect(f.zones).toEqual([Z1]);
    expect(f.branches).toEqual([]);
    expect(f.sizes).toEqual(["S"]);
    expect(f.years).toBe("");
    expect(f.statuses).toEqual(["active"]);
    expect(f.sort).toBe("default");
  });

  it("URL ไม่มีทางเก็บคำค้น (ไม่มีฟิลด์ค้นหาใน RegistryFilters)", () => {
    const all = filtersToParams({ ...defaultFilters(), zones: [Z1], sizes: ["S"], statuses: ["active"], years: "1", sort: "value_desc" });
    expect([...all.keys()].sort()).toEqual(["sort", "size", "st", "yr", "zone"].sort());
  });

  it("นับตัวกรอง ไม่นับการเรียง", () => {
    expect(countActiveFilters({ ...defaultFilters(), zones: [Z1], statuses: ["active", "ended"], years: "1", sort: "end_desc" })).toBe(4);
  });

  it("ต้องกรองซ้ำฝั่งแอปเฉพาะเมื่อกรอง Tier หรือสถานะ", () => {
    expect(needsPostFilter(defaultFilters())).toBe(false);
    expect(needsPostFilter({ ...defaultFilters(), years: "3", zones: [Z1] })).toBe(false);
    expect(needsPostFilter({ ...defaultFilters(), sizes: ["S"] })).toBe(true);
    expect(needsPostFilter({ ...defaultFilters(), statuses: ["active"] })).toBe(true);
  });

  it("ตัดอักขระอันตรายของ query ออกจากคำค้น และจำกัดความยาว", () => {
    expect(sanitizeSearch('  สมชาย,(x)"*%_\\  ใจดี ')).toBe("สมชาย x ใจดี");
    expect(sanitizeSearch("   ")).toBe("");
    expect(sanitizeSearch("ก".repeat(200)).length).toBe(MAX_SEARCH_LENGTH);
  });
});

describe("กัน viewer (PDPA)", () => {
  it("viewer เข้า /customers ไม่ได้ · host/admin/recorder เข้าได้", () => {
    expect(canAccessPath("viewer", "/customers")).toBe(false);
    expect(canAccessPath("host", "/customers")).toBe(true);
    expect(canAccessPath("admin", "/customers")).toBe(true);
    expect(canAccessPath("recorder", "/customers")).toBe(true);
  });
});

describe("nextSort / sortDirection", () => {
  it("วนครบ 3 สถานะ แล้วกลับลำดับเดิม · สลับคอลัมน์เริ่มที่น้อย→มาก", () => {
    expect(nextSort("default", "end")).toBe("end_asc");
    expect(nextSort("end_asc", "end")).toBe("end_desc");
    expect(nextSort("end_desc", "end")).toBe("default");
    expect(nextSort("end_desc", "value")).toBe("value_asc");
    expect(sortDirection("value_desc", "value")).toBe("descending");
    expect(sortDirection("value_desc", "end")).toBe("none");
    expect(sortDirection("end_asc", "end")).toBe("ascending");
  });
});
