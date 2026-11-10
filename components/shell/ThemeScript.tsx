import { THEME_INIT_SCRIPT } from "./theme";

/**
 * <script> กันหน้ากะพริบตอนสลับโหมดมืด — เป็น server component (ไม่ใช่ "use client")
 * วางไว้ก่อน AppShell ใน app/(app)/layout.tsx เพื่อให้รันก่อนเบราว์เซอร์วาดเมนู/เนื้อหา
 */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />;
}
