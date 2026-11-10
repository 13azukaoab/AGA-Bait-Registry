import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// เทส pure function: lib/** (สูตรคำนวณ, auth, dashboard) และตัวช่วยคำนวณของหน้าจอใน components/**
// alias "@" ให้ตรงกับ tsconfig paths เพื่อให้ไฟล์ที่ import "@/lib/..." รันในเทสได้
export default defineConfig({
  // เทสเป็น pure function ไม่ใช้ CSS — ปิด postcss กันโหลด Tailwind v4 config (vite อ่าน string plugin ไม่ได้)
  css: {
    postcss: { plugins: [] },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
    passWithNoTests: true,
  },
});
