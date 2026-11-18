/**
 * กัน bypass ด่านเจ้าของ (M21b): `@/lib/supabase/admin` (service role) import ได้เฉพาะ
 *   - `lib/admin/userAdmin.ts` (+ เทสของมัน) ไฟล์เดียว — ไฟล์ใหม่ใน lib/admin ต้องเพิ่มในรายการอนุญาตเอง
 *   - `app/api/cron/**`  (งานเบื้องหลัง ไม่มีผู้ใช้)
 *   - ตัวมันเอง `lib/supabase/admin.ts`
 * ไฟล์อื่นที่ import (รวม relative path, require, dynamic import) → เทสนี้ล้ม
 * เหตุผล: `auth.admin.updateUserById` ข้าม DB guard — ต้องผ่าน `lib/admin/userAdmin.ts` เท่านั้น
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".claude", "coverage", "dist"]);
const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** ที่อนุญาต (path แบบ posix สัมพัทธ์จาก root) */
function isAllowed(rel: string): boolean {
  return (
    rel === "lib/supabase/admin.ts" ||
    rel === "lib/admin/userAdmin.ts" || // ไฟล์เดียวใน lib/admin ที่ได้ใช้ (ไฟล์ใหม่ต้องมาแก้รายการนี้ = ผ่านการรีวิว)
    rel === "lib/admin/userAdmin.test.ts" ||
    rel === "lib/admin/monthCloseAdmin.ts" || // M39 ปิดเดือน/คำนวณใหม่ (BE อนุมัติ 18 พ.ย. 2026 · route ตรวจสิทธิ์ที่ DB ก่อน)
    rel.startsWith("app/api/cron/")
  );
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTENSIONS.test(name)) out.push(full);
  }
}

/** import/require/dynamic import ที่ชี้ไปโมดูล supabase/admin (alias หรือ relative) */
const ADMIN_MODULE =
  /(?:from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)["'`](?:@\/lib\/supabase\/admin|(?:\.{1,2}\/)+(?:lib\/)?(?:supabase\/)?admin|\.\/admin)(?:\.[a-z]+)?["'`]/;

describe("ห้ามไฟล์นอกที่อนุญาต import service-role client", () => {
  it("ไม่มี bypass", () => {
    const files: string[] = [];
    walk(ROOT, files);
    const offenders = files
      .map((f) => ({ rel: relative(ROOT, f).split(sep).join("/"), full: f }))
      .filter(({ rel }) => !isAllowed(rel))
      // ไฟล์เทสนี้เองมี pattern อยู่ในคอมเมนต์/regex
      .filter(({ rel }) => rel !== "lib/admin/noAdminImportBypass.test.ts")
      .filter(({ full }) => ADMIN_MODULE.test(readFileSync(full, "utf8")))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("regex จับรูปแบบ import ที่คาดได้", () => {
    for (const s of [
      'import { createAdminClient } from "@/lib/supabase/admin";',
      "import('@/lib/supabase/admin')",
      'require("@/lib/supabase/admin")',
      'import { a } from "../../lib/supabase/admin"',
      'import { a } from "../supabase/admin"',
      'export * from "@/lib/supabase/admin";',
      'import x = require("@/lib/supabase/admin")',
      "import(`@/lib/supabase/admin`)",
    ]) {
      expect(ADMIN_MODULE.test(s), s).toBe(true);
    }
    expect(ADMIN_MODULE.test('import { x } from "@/lib/supabase/server"')).toBe(false);
  });
});
