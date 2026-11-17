import { formatVersion } from "@/lib/version";

/**
 * เลขเวอร์ชันระบบ (SemVer — DECISIONS 2.58) ตัวเล็กสีจาง บรรทัดเดียว
 * ค่าฝังตอน build จาก next.config.ts (NEXT_PUBLIC_APP_VERSION / NEXT_PUBLIC_COMMIT_SHA)
 * ใช้ได้ทั้ง server และ client component
 */
export function AppVersion({ className }: { className?: string }) {
  const text = formatVersion(
    process.env.NEXT_PUBLIC_APP_VERSION ?? "",
    process.env.NEXT_PUBLIC_COMMIT_SHA ?? "",
  );
  return (
    <p
      title="เวอร์ชันระบบ"
      className={`select-text whitespace-nowrap text-xs text-fg-muted ${className ?? ""}`}
    >
      {text}
    </p>
  );
}
