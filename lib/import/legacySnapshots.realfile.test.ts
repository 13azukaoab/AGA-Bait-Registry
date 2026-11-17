/**
 * ตรวจตัวแปลง legacy กับไฟล์จริง `fixtures/dashboard_data.json` (DECISIONS 2.72 ก)
 *
 * - ไฟล์จริงไม่ commit (fixtures/ อยู่ใน .gitignore) → ไม่เจอไฟล์ = skip เอง (CI ไม่มีไฟล์)
 * - ตำแหน่งไฟล์: env AGA_FIXTURES_DIR หรือ <repo>/fixtures
 * - go-live = 2026-10 ตามค่าเริ่มต้นของ app_settings (M25) — ตัวนำเข้าจริงอ่านจาก go_live_month() ใน DB
 * - env AGA_LEGACY_OUT=<path>.json (ไม่บังคับ) เขียนยอดรวมต่อเดือนไว้ทำรายงาน (มีแค่ตัวเลขรวม ไม่มีข้อมูลลูกค้า)
 * - ⚠ assert เป็นจำนวน/ตัวนับ ไม่ toEqual กับข้อมูลก้อนใหญ่ (diff จะยาวและอ่านไม่ออก)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BRANCHES } from "../dashboard/branches";
import { buildDashboardData } from "../dashboard/buildDashboardData";
import { assembleDashboardSources } from "../dashboard/sources";
import type { DashboardData, DashboardRow } from "../dashboard/types";
import {
  COUNT_FIELDS,
  MONEY_FIELDS,
  convertLegacyDashboardData,
  legacyTotalsByMonth,
  parseDashboardMonthKey,
  toCents,
} from "./legacySnapshots";

const FIXTURES_DIR = process.env.AGA_FIXTURES_DIR ?? resolve(process.cwd(), "fixtures");
const FILE = join(FIXTURES_DIR, "dashboard_data.json");
const GO_LIVE = "2026-10";

/** จำนวนช่องที่ไม่ตรงระหว่างแถวต้นฉบับกับแถวที่ได้ (เทียบจำนวนเต็ม / สตางค์ · ไม่เทียบ float ตรงๆ) */
function countMismatches(a: DashboardRow, b: DashboardRow): number {
  let n = 0;
  for (const f of COUNT_FIELDS) if (a[f] !== b[f]) n++;
  for (const f of MONEY_FIELDS) if (toCents(a[f]) !== toCents(b[f])) n++;
  return n;
}

describe.skipIf(!existsSync(FILE))("legacy: ไฟล์จริง dashboard_data.json", () => {
  // อ่านไฟล์ใน beforeAll — ตัว describe ถูกเรียกตอน collect แม้จะ skip (ไม่มีไฟล์บน CI = ห้ามอ่านตรงนี้)
  let data: DashboardData;
  let res: ReturnType<typeof convertLegacyDashboardData>;
  beforeAll(() => {
    data = JSON.parse(readFileSync(FILE, "utf8")) as DashboardData;
    res = convertLegacyDashboardData(data, { goLiveMonth: GO_LIVE });
  });

  it("ไฟล์มี 22 เดือน JAN.25–OCT.26 · นำเข้า 21 เดือน JAN.25–SEP.26 = 903 แถว · ตัด OCT.26", () => {
    expect(Object.keys(data)).toHaveLength(22);
    expect(res.months[0]).toBe("2025-01");
    expect(res.months[res.months.length - 1]).toBe("2026-09");
    expect(res.months).toHaveLength(21);
    expect(res.skippedKeys).toEqual(["OCT.26"]);
    expect(res.rows).toHaveLength(903);
  });

  it("ทุกช่อง (จำนวน 9 + เงิน 5) ต่อเดือนต่อสาขา ตรงไฟล์ต้นฉบับ 100%", () => {
    const outByKey = new Map(res.rows.map((r) => [`${r.month}|${r.branch}`, r]));
    let compared = 0;
    let mismatches = 0;
    let missing = 0;
    for (const [key, rows] of Object.entries(data)) {
      const month = parseDashboardMonthKey(key);
      if (month >= GO_LIVE) continue;
      for (const src of rows) {
        const out = outByKey.get(`${month}|${src.branch}`);
        if (!out) {
          missing++;
          continue;
        }
        compared++;
        mismatches += countMismatches(src, out);
      }
    }
    expect(missing).toBe(0);
    expect(compared).toBe(903);
    expect(mismatches).toBe(0);
  });

  it("ยอดรวมต่อเดือน (cust + มูลค่า) ตรงกับผลรวมของไฟล์ต้นฉบับ", () => {
    const totals = legacyTotalsByMonth(res.rows);
    let bad = 0;
    for (const t of totals) {
      const src = data[Object.keys(data).find((k) => parseDashboardMonthKey(k) === t.month)!]!;
      const cust = src.reduce((s, r) => s + r.cust, 0);
      const cents = src.reduce((s, r) => s + toCents(r.value), 0);
      if (cust !== t.cust || cents !== t.valueCents || t.rows !== 43) bad++;
    }
    expect(totals).toHaveLength(21);
    expect(bad).toBe(0);

    const out = process.env.AGA_LEGACY_OUT;
    if (out) {
      writeFileSync(
        out,
        JSON.stringify({ totals, areaDifferences: res.areaDifferences }, null, 2),
        "utf8",
      );
    }
  });

  it("ส่งผ่านทางอ่านจริงของ sync (assembleDashboardSources → buildDashboardData) ได้ JAN.25–SEP.26 เหมือนไฟล์เดิม", () => {
    const sources = assembleDashboardSources({
      goLiveMonth: GO_LIVE,
      lastMonth: "2026-09",
      snapshots: res.rows,
      closedCentralMonths: new Set(),
      registry: { contracts: [], visits: [], rules: [] },
    });
    const rebuilt = buildDashboardData(sources, { goLiveMonth: GO_LIVE });
    const keys = Object.keys(data).filter((k) => parseDashboardMonthKey(k) < GO_LIVE);
    expect(Object.keys(rebuilt)).toEqual(keys);

    const currentArea = new Map(BRANCHES.map((b) => [b.branch, b.area]));
    let mismatches = 0;
    let wrongArea = 0;
    let rows = 0;
    for (const key of keys) {
      const byName = new Map(data[key]!.map((r) => [r.branch, r]));
      for (const out of rebuilt[key]!) {
        rows++;
        mismatches += countMismatches(byName.get(out.branch)!, out);
        if (out.area !== currentArea.get(out.branch)) wrongArea++;
      }
      expect(rebuilt[key]!.map((r) => r.branch)).toEqual(BRANCHES.map((b) => b.branch));
    }
    expect(rows).toBe(903);
    expect(mismatches).toBe(0);
    expect(wrongArea).toBe(0);
  });

  it("แถวที่เขตในไฟล์ต่างจากเขตปัจจุบัน = 4 สาขาที่รู้แล้วเท่านั้น (54 แถว)", () => {
    const byBranch = new Map<string, { fileArea: string; months: string[] }>();
    for (const d of res.areaDifferences) {
      const e = byBranch.get(d.branch) ?? { fileArea: d.fileArea, months: [] };
      e.months.push(d.month);
      byBranch.set(d.branch, e);
    }
    const summary = Object.fromEntries(
      [...byBranch].map(([b, e]) => [
        b,
        `${e.fileArea} ${e.months[0]}..${e.months[e.months.length - 1]} (${e.months.length})`,
      ]),
    );
    expect(summary).toEqual({
      "พระราม 2": "เขต 1 2025-01..2026-05 (17)",
      "ปราจีนบุรี": "เขต 5 2025-01..2026-05 (17)",
      "ภูเก็ต": "เขต 10 2025-01..2025-10 (10)",
      "สุราษฎร์ธานี": "เขต 11 2025-01..2025-10 (10)",
    });
    expect(res.areaDifferences).toHaveLength(54);
  });
});
