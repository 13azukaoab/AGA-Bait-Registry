import styles from "./shell.module.css";
import type { UserLabel } from "./userLabel";

/**
 * ป้าย "ผู้ที่ล็อกอินอยู่" (ข้อความล้วน ไม่ใช่ปุ่ม)
 * - variant "topbar": แสดงเฉพาะจอ ≥1200px ชื่อตัดด้วย … ได้ ตำแหน่งเป็นป้ายเทาจาง
 * - variant "drawer": แสดงบนสุดของเมนูซ้ายเมื่อจอ <1200px (ลิ้นชัก ☰ บนจอเล็ก · เมนูซ้ายติดที่บนจอ 861–1199px)
 * - จุดตัด 1200px: ต่ำกว่านี้ป้ายบนแถบบนดันกลุ่มปุ่มจนแถบบนขึ้น 2 แถว หรือบีบชื่อระบบจนสูงขึ้น (วัดชื่อยาวสุด: 1100px สูง 72px · 1160px ขึ้นไป 57px) (เจ้าของเลือกซ่อน 24 พ.ย. 2026)
 *   แถบบนจึงอยู่แถวเดียวเสมอ (วัดจริงที่ 900 / 1000 / 1024 / 1280px)
 * - เมนูย่อ 58px: เหลือไอคอนคน (ชี้เมาส์เห็น title ชื่อเต็ม / เมนูกางแล้วเห็นข้อความ) — ดู .navUserText ใน shell.module.css
 */
export function UserBadge({
  label,
  variant,
}: {
  label: UserLabel;
  variant: "topbar" | "drawer";
}) {
  const icon = (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  );
  const ariaLabel = `ผู้ใช้ที่เข้าสู่ระบบ: ${label.full}`;

  if (variant === "drawer") {
    return (
      <div
        role="group"
        title={label.full}
        aria-label={ariaLabel}
        className="mb-3 flex items-center gap-2 border-b border-border px-2.5 pb-3 text-fg min-[1200px]:hidden"
      >
        {icon}
        <div className={`${styles.navUserText} min-w-0`}>
          <b className="block truncate text-sm font-semibold">{label.name}</b>
          {label.position ? (
            <span className="block truncate text-xs text-fg-muted">{label.position}</span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      role="group"
      title={label.full}
      aria-label={ariaLabel}
      className="flex min-w-0 items-center gap-1.5 text-[13px] text-fg max-[1199px]:hidden"
    >
      {icon}
      <span className="max-w-[220px] truncate font-medium">{label.name}</span>
      {label.position ? (
        <>
          <span aria-hidden="true" className="text-fg-muted">·</span>
          <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted">
            {label.position}
          </span>
        </>
      ) : null}
    </div>
  );
}
