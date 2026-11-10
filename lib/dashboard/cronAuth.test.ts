import { describe, it, expect } from "vitest";
import { isAuthorizedCronRequest } from "./cronAuth";

describe("isAuthorizedCronRequest — ด่านหน้าของ Auto Sync (SPEC §9.2)", () => {
  it("ไม่ได้ตั้ง CRON_SECRET = ปฏิเสธเสมอ แม้ส่ง header มาถูกรูปแบบ", () => {
    expect(isAuthorizedCronRequest("Bearer anything", undefined)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer anything", "")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer anything", null)).toBe(false);
    expect(isAuthorizedCronRequest(null, undefined)).toBe(false);
  });

  it("secret ตรง = ผ่าน", () => {
    expect(isAuthorizedCronRequest("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("secret ไม่ตรง = ไม่ผ่าน", () => {
    expect(isAuthorizedCronRequest("Bearer wrong", "s3cret")).toBe(false);
  });

  it("ไม่มี header = ไม่ผ่าน", () => {
    expect(isAuthorizedCronRequest(null, "s3cret")).toBe(false);
    expect(isAuthorizedCronRequest("", "s3cret")).toBe(false);
  });

  it("ส่ง secret มาเฉยๆ ไม่มีคำว่า Bearer = ไม่ผ่าน", () => {
    expect(isAuthorizedCronRequest("s3cret", "s3cret")).toBe(false);
  });
});
