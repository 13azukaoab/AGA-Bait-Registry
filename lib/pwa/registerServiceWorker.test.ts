import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerServiceWorker, resetRegisterWarningForTest, type RegisterDeps } from "./registerServiceWorker";

function deps(overrides: Partial<RegisterDeps> = {}): RegisterDeps {
  return {
    isProduction: true,
    serwist: { register: vi.fn().mockResolvedValue(undefined) },
    serviceWorker: { register: vi.fn().mockResolvedValue({}) as unknown as ServiceWorkerContainer["register"] },
    warn: vi.fn(),
    ...overrides,
  };
}

describe("registerServiceWorker", () => {
  beforeEach(() => resetRegisterWarningForTest());

  it("ใช้ window.serwist.register() เมื่อมี", async () => {
    const d = deps();
    await expect(registerServiceWorker(d)).resolves.toBe(true);
    expect(d.serwist!.register).toHaveBeenCalledTimes(1);
    expect(d.serviceWorker!.register).not.toHaveBeenCalled();
  });

  it("ไม่มี window.serwist → ลงทะเบียน /sw.js scope / เอง", async () => {
    const d = deps({ serwist: undefined });
    await expect(registerServiceWorker(d)).resolves.toBe(true);
    expect(d.serviceWorker!.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("browser ปฏิเสธ (Error: Rejected) → ไม่ reject · คืน false · warn ครั้งเดียว", async () => {
    const reject = vi.fn().mockRejectedValue(new Error("Rejected"));
    const d = deps({ serwist: { register: reject } });
    await expect(registerServiceWorker(d)).resolves.toBe(false);
    await expect(registerServiceWorker(d)).resolves.toBe(false);
    expect(d.warn).toHaveBeenCalledTimes(1);
  });

  it("register throw แบบ sync ก็ไม่หลุด", async () => {
    const d = deps({
      serwist: {
        register: () => {
          throw new TypeError("Failed to register a ServiceWorker");
        },
      },
    });
    await expect(registerServiceWorker(d)).resolves.toBe(false);
    expect(d.warn).toHaveBeenCalledTimes(1);
  });

  it("ไม่ใช่ production (dev ปิด SW) → ไม่ลงทะเบียน", async () => {
    const d = deps({ isProduction: false });
    await expect(registerServiceWorker(d)).resolves.toBe(false);
    expect(d.serwist!.register).not.toHaveBeenCalled();
  });

  it("เบราว์เซอร์ไม่รองรับ service worker → ไม่ทำอะไร", async () => {
    const d = deps({ serviceWorker: undefined });
    await expect(registerServiceWorker(d)).resolves.toBe(false);
    expect(d.serwist!.register).not.toHaveBeenCalled();
  });

  it("ไม่มี unhandled rejection เมื่อเรียกแบบไม่ await (เหมือนใน useEffect)", async () => {
    const onUnhandled = vi.fn();
    process.on("unhandledRejection", onUnhandled);
    try {
      void registerServiceWorker(deps({ serwist: { register: vi.fn().mockRejectedValue(new Error("Rejected")) } }));
      await new Promise((r) => setTimeout(r, 20));
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
