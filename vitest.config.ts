import { defineConfig } from "vitest/config";

// เทสเน้นที่ lib/rules (pure function) — ดูแผน TDD: docs/plans/2026-10-15-lib-rules.md
export default defineConfig({
  // เทส lib/rules เป็น pure function ไม่ใช้ CSS — ปิด postcss กันโหลด Tailwind v4 config (vite อ่าน string plugin ไม่ได้)
  css: {
    postcss: { plugins: [] },
  },
  test: {
    globals: true,
    include: ["lib/**/*.test.ts"],
    passWithNoTests: true,
  },
});
