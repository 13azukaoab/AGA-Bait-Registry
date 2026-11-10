import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

// ฟอนต์ Noto Sans Thai (SPEC §3) — ผูกเป็น CSS variable ใช้ใน globals.css
const notoSansThai = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  display: "swap",
  variable: "--font-noto-sans-thai",
});

export const metadata: Metadata = {
  title: "AGA Bait Registry",
  description: "ระบบทะเบียนบริการ Bait — Advance Group Asia (AGA)",
  manifest: "/manifest.webmanifest",
  applicationName: "AGA Bait Registry",
  appleWebApp: {
    capable: true,
    title: "AGA Bait",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#1f5fa8",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: สคริปต์ธีม (components/shell/ThemeScript) ตั้ง data-theme บน <html>
    // ก่อน React hydrate เพื่อไม่ให้หน้ากะพริบ — React เลยเห็น attribute ที่ server ไม่ได้ render
    // (ไม่กระทบผู้ใช้ แค่กัน warning ใน dev · ผลเฉพาะ attribute ของ <html> ไม่ลามถึงลูก)
    <html lang="th" suppressHydrationWarning>
      <body className={notoSansThai.variable}>{children}</body>
    </html>
  );
}
