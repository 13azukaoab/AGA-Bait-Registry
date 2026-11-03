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
    <html lang="th">
      <body className={notoSansThai.variable}>{children}</body>
    </html>
  );
}
