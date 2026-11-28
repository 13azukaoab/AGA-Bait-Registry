import { describe, expect, it, vi } from "vitest";

import {
  CURRENT_PASSWORD_REQUIRED_MESSAGE,
  CURRENT_PASSWORD_UNAVAILABLE_MESSAGE,
  CURRENT_PASSWORD_WRONG_MESSAGE,
  changeOwnPassword,
  type ChangePasswordPorts,
} from "./changePassword";

// SEC-04: เปลี่ยนรหัสเองต้องกรอกรหัสเดิม · บังคับเปลี่ยนครั้งแรกไม่ต้อง (ข้อมูลสมมติทั้งหมด)
const NEW_PASSWORD = "Newpass123";

function makePorts(overrides: Partial<ChangePasswordPorts> = {}) {
  const ports = {
    getUser: vi.fn(async () => ({ id: "user-1", email: "user_a1@aga.local" })),
    loadProfile: vi.fn(async () => ({ mustChangePassword: false, role: "recorder" as const })),
    verifyCurrentPassword: vi.fn(async () => "valid" as const),
    updatePassword: vi.fn(async () => null),
    completePasswordChange: vi.fn(async () => undefined),
    signOutOtherSessions: vi.fn(async () => undefined),
    ...overrides,
  };
  return ports as typeof ports & ChangePasswordPorts;
}

const input = (currentPassword: string, password = NEW_PASSWORD, confirmation = password) => ({
  currentPassword,
  password,
  confirmation,
});

describe("changeOwnPassword — เปลี่ยนเอง (ต้องกรอกรหัสเดิม)", () => {
  it("รหัสเดิมถูก → ตรวจกับผู้ใช้/อีเมลของ session แล้วเปลี่ยนรหัส + ออกจากอุปกรณ์อื่น", async () => {
    const ports = makePorts();
    const outcome = await changeOwnPassword(input("Oldpass123"), ports);

    expect(outcome).toEqual({ kind: "ok", role: "recorder" });
    expect(ports.verifyCurrentPassword).toHaveBeenCalledWith("user-1", "user_a1@aga.local", "Oldpass123");
    expect(ports.updatePassword).toHaveBeenCalledWith(NEW_PASSWORD);
    expect(ports.completePasswordChange).toHaveBeenCalledOnce();
    expect(ports.signOutOtherSessions).toHaveBeenCalledOnce();
  });

  it("ไม่กรอกรหัสเดิม → แจ้งให้กรอก ไม่ตรวจ ไม่เปลี่ยน", async () => {
    const ports = makePorts();
    const outcome = await changeOwnPassword(input(""), ports);

    expect(outcome).toEqual({ kind: "error", error: CURRENT_PASSWORD_REQUIRED_MESSAGE });
    expect(ports.verifyCurrentPassword).not.toHaveBeenCalled();
    expect(ports.updatePassword).not.toHaveBeenCalled();
  });

  it("รหัสเดิมผิด → ข้อความกลาง ไม่เปลี่ยนรหัส", async () => {
    const ports = makePorts({ verifyCurrentPassword: vi.fn(async () => "invalid" as const) });
    const outcome = await changeOwnPassword(input("Wrongpass1"), ports);

    expect(outcome).toEqual({ kind: "error", error: CURRENT_PASSWORD_WRONG_MESSAGE });
    expect(ports.updatePassword).not.toHaveBeenCalled();
    expect(ports.completePasswordChange).not.toHaveBeenCalled();
    expect(ports.signOutOtherSessions).not.toHaveBeenCalled();
  });

  it("ตรวจรหัสเดิมไม่ได้ (rate limit / เครือข่าย) → ไม่เปลี่ยนรหัส (fail closed)", async () => {
    const ports = makePorts({ verifyCurrentPassword: vi.fn(async () => "unavailable" as const) });
    const outcome = await changeOwnPassword(input("Oldpass123"), ports);

    expect(outcome).toEqual({ kind: "error", error: CURRENT_PASSWORD_UNAVAILABLE_MESSAGE });
    expect(ports.updatePassword).not.toHaveBeenCalled();
  });

  it("อ่านโปรไฟล์ไม่ได้ → ถือว่าเปลี่ยนเอง ต้องกรอกรหัสเดิม (fail closed)", async () => {
    const ports = makePorts({ loadProfile: vi.fn(async () => null) });
    const outcome = await changeOwnPassword(input(""), ports);

    expect(outcome).toEqual({ kind: "error", error: CURRENT_PASSWORD_REQUIRED_MESSAGE });
    expect(ports.updatePassword).not.toHaveBeenCalled();
  });

  it("บัญชีไม่มีอีเมล → ตรวจรหัสเดิมไม่ได้ ไม่เปลี่ยน", async () => {
    const ports = makePorts({ getUser: vi.fn(async () => ({ id: "user-1", email: null })) });
    const outcome = await changeOwnPassword(input("Oldpass123"), ports);

    expect(outcome).toEqual({ kind: "error", error: CURRENT_PASSWORD_UNAVAILABLE_MESSAGE });
    expect(ports.verifyCurrentPassword).not.toHaveBeenCalled();
    expect(ports.updatePassword).not.toHaveBeenCalled();
  });

  it("Supabase ปฏิเสธรหัสใหม่ (ซ้ำรหัสเดิม) → แปลเป็นข้อความไทย ไม่ปิดธง", async () => {
    const ports = makePorts({ updatePassword: vi.fn(async () => ({ code: "same_password" })) });
    const outcome = await changeOwnPassword(input("Oldpass123"), ports);

    expect(outcome).toEqual({ kind: "error", error: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม" });
    expect(ports.completePasswordChange).not.toHaveBeenCalled();
    expect(ports.signOutOtherSessions).not.toHaveBeenCalled();
  });

  it("ออกจากอุปกรณ์อื่นล้ม → การเปลี่ยนรหัสยังถือว่าสำเร็จ", async () => {
    const ports = makePorts({
      signOutOtherSessions: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const outcome = await changeOwnPassword(input("Oldpass123"), ports);

    expect(outcome).toEqual({ kind: "ok", role: "recorder" });
  });
});

describe("changeOwnPassword — บังคับเปลี่ยนครั้งแรก (must_change_password)", () => {
  it("ไม่ต้องกรอกรหัสเดิม ไม่เรียกตรวจ แล้วเปลี่ยนรหัส + ปิดธง", async () => {
    const ports = makePorts({
      loadProfile: vi.fn(async () => ({ mustChangePassword: true, role: "admin" as const })),
    });
    const outcome = await changeOwnPassword(input(""), ports);

    expect(outcome).toEqual({ kind: "ok", role: "admin" });
    expect(ports.verifyCurrentPassword).not.toHaveBeenCalled();
    expect(ports.updatePassword).toHaveBeenCalledWith(NEW_PASSWORD);
    expect(ports.completePasswordChange).toHaveBeenCalledOnce();
  });
});

describe("changeOwnPassword — ตรวจรหัสใหม่ก่อนเรียกเครือข่าย", () => {
  it("รหัสใหม่อ่อน → แจ้งเงื่อนไข ไม่อ่านผู้ใช้", async () => {
    const ports = makePorts();
    const outcome = await changeOwnPassword(input("Oldpass123", "short"), ports);

    expect(outcome.kind).toBe("error");
    expect(ports.getUser).not.toHaveBeenCalled();
  });

  it("2 ช่องไม่ตรงกัน → แจ้งไม่ตรงกัน ไม่อ่านผู้ใช้", async () => {
    const ports = makePorts();
    const outcome = await changeOwnPassword(input("Oldpass123", NEW_PASSWORD, "Newpass124"), ports);

    expect(outcome).toEqual({ kind: "error", error: "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน" });
    expect(ports.getUser).not.toHaveBeenCalled();
  });

  it("ไม่ได้ล็อกอิน → unauthenticated", async () => {
    const ports = makePorts({ getUser: vi.fn(async () => null) });
    expect(await changeOwnPassword(input("Oldpass123"), ports)).toEqual({ kind: "unauthenticated" });
    expect(ports.updatePassword).not.toHaveBeenCalled();
  });
});
