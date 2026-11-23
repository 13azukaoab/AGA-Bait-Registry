import type { UserLabel } from "./userLabel";

/**
 * ป้าย "ผู้ที่ล็อกอินอยู่" (ข้อความล้วน ไม่ใช่ปุ่ม)
 * - variant "topbar": แสดงเฉพาะจอกว้าง (≥861px) ชื่อตัดด้วย … ได้ ตำแหน่งเป็นป้ายเทาจาง
 * - variant "drawer": แสดงบนสุดของลิ้นชักเฉพาะจอเล็ก (≤860px) — ไม่เพิ่มความสูงแถบบนมือถือ
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
        className="mb-3 flex items-center gap-2 border-b border-border px-2.5 pb-3 text-fg min-[861px]:hidden"
      >
        {icon}
        <div className="min-w-0">
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
      className="flex min-w-0 items-center gap-1.5 text-[13px] text-fg max-[860px]:hidden"
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
