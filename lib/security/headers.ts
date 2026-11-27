/**
 * Security headers ที่ส่งกับทุก response (SEC-02)
 *
 * - X-Frame-Options: DENY               กัน clickjacking (เบราว์เซอร์รุ่นเก่า)
 * - CSP frame-ancestors 'none'          กัน clickjacking (มาตรฐานใหม่) — ใส่เฉพาะ directive นี้
 *                                       ยังไม่ใส่ CSP เต็ม (จะทำเป็น Report-Only ภายหลัง)
 * - X-Content-Type-Options: nosniff     กันเบราว์เซอร์เดา MIME type เอง
 * - Referrer-Policy                     ไม่ส่ง path/query ไปเว็บอื่น
 * - Permissions-Policy                  ปิดสิทธิ์อุปกรณ์ที่แอปไม่ใช้
 *                                       (ไม่จำกัด clipboard เพราะแอปใช้ navigator.clipboard.write/writeText)
 *
 * ไม่ใส่ HSTS: Vercel ใส่ให้เอง
 */
export const securityHeaders: { key: string; value: string }[] = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];
