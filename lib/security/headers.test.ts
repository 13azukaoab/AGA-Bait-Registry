import { describe, expect, it } from "vitest";

import { securityHeaders } from "./headers";

const get = (key: string) => securityHeaders.find((h) => h.key === key)?.value;

describe("securityHeaders", () => {
  it("มี header ที่ต้องมีครบ ค่าตรงเป๊ะ", () => {
    expect(get("X-Frame-Options")).toBe("DENY");
    expect(get("X-Content-Type-Options")).toBe("nosniff");
    expect(get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
  });

  it("CSP มีแค่ frame-ancestors 'none' (ไม่ใช่ CSP เต็ม)", () => {
    expect(get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
  });

  it("ไม่ใส่ HSTS (Vercel ใส่ให้)", () => {
    expect(get("Strict-Transport-Security")).toBeUndefined();
  });

  it("Permissions-Policy ไม่แตะ clipboard (แอปใช้คัดลอก)", () => {
    expect(get("Permissions-Policy")).not.toMatch(/clipboard/i);
  });
});
