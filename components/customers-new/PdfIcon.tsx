/** ไอคอนไฟล์ PDF (เส้นตาม currentColor — ใช้ในปุ่ม "PDF ✓" ของคอลัมน์ไฟล์แนบ) */
export function PdfIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className ?? "size-4 flex-none"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <path d="M6 1.5h9l5 5V21a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4.5 21V3A1.5 1.5 0 0 1 6 1.5z" />
      <path d="M15 1.5v3.5a1.5 1.5 0 0 0 1.5 1.5H20z" />
      <text
        x="12"
        y="17.5"
        textAnchor="middle"
        fontSize="7"
        fontWeight="700"
        stroke="none"
        fill="currentColor"
      >
        PDF
      </text>
    </svg>
  );
}
