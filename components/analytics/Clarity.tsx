import Script from "next/script";
import { clarityIdToLoad } from "@/lib/analytics/clarity";

/**
 * Microsoft Clarity (บันทึกหน้าจอ/heatmap ช่วง UAT · DECISIONS M36)
 * - โหลดเฉพาะ production + มี NEXT_PUBLIC_CLARITY_ID ที่รูปแบบถูกต้อง (ดู lib/analytics/clarity.ts)
 * - PDPA: ตั้ง Masking = Strict ใน Clarity + ใส่ data-clarity-mask ที่ตารางลูกค้าอีกชั้น
 */
export function Clarity() {
  const id = clarityIdToLoad(process.env.NEXT_PUBLIC_CLARITY_ID, process.env.NEXT_PUBLIC_SENTRY_ENV);
  if (id === null) return null;

  const snippet =
    '(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};' +
    't=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;' +
    "y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})" +
    `(window, document, "clarity", "script", ${JSON.stringify(id)});`;

  return (
    <Script id="microsoft-clarity" strategy="afterInteractive">
      {snippet}
    </Script>
  );
}
