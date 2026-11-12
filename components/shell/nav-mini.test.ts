import { describe, expect, it } from "vitest";
import {
  NAV_MINI_ATTR,
  NAV_MINI_START_PATHS,
  NAV_MINI_STORAGE_KEY,
  NAV_NOANIM_ATTR,
  buildNavMiniInitScript,
  isMiniStartPath,
  resolveMini,
} from "./nav-mini";

describe("isMiniStartPath", () => {
  it("/customers/new เริ่มแบบย่อเสมอ", () => {
    expect(NAV_MINI_START_PATHS).toContain("/customers/new");
    expect(isMiniStartPath("/customers/new")).toBe(true);
    expect(isMiniStartPath("/customers/new/")).toBe(true);
  });
  it("หน้าอื่นไม่บังคับ", () => {
    expect(isMiniStartPath("/customers")).toBe(false);
    expect(isMiniStartPath("/customers/new/x")).toBe(false);
    expect(isMiniStartPath("/todo")).toBe(false);
  });
});

describe("resolveMini", () => {
  it("หน้าบังคับย่อ → ย่อ แม้ผู้ใช้เลือกขยายไว้", () => {
    expect(resolveMini("/customers/new", "0")).toBe(true);
  });
  it("หน้าทั่วไปตามค่าที่จำไว้", () => {
    expect(resolveMini("/todo", "1")).toBe(true);
    expect(resolveMini("/todo", "0")).toBe(false);
    expect(resolveMini("/todo", null)).toBe(false);
  });
});

/** รันสคริปต์กันกะพริบกับ document/localStorage/location ปลอม */
function runInitScript(opts: {
  path: string;
  stored: string | null | "throw";
  paths?: readonly string[];
}) {
  const attrs = new Map<string, string>();
  const documentStub = {
    documentElement: {
      setAttribute: (k: string, v: string) => attrs.set(k, v),
    },
  };
  const storageStub = {
    getItem: (key: string) => {
      if (opts.stored === "throw") throw new Error("blocked");
      expect(key).toBe(NAV_MINI_STORAGE_KEY);
      return opts.stored;
    },
  };
  const script = buildNavMiniInitScript(opts.paths);
  new Function("document", "localStorage", "location", script)(
    documentStub,
    storageStub,
    { pathname: opts.path },
  );
  return attrs;
}

describe("NAV_MINI_INIT_SCRIPT", () => {
  it.each([
    ["/customers/new", "0"],
    ["/customers/new/", null],
    ["/todo", "1"],
    ["/todo", "0"],
    ["/todo", null],
  ] as const)("ให้ผลตรงกับ resolveMini (%s, %s)", (path, stored) => {
    const attrs = runInitScript({ path, stored });
    expect(attrs.get(NAV_MINI_ATTR) === "1").toBe(resolveMini(path, stored));
    expect(attrs.get(NAV_NOANIM_ATTR)).toBe("1");
  });

  it("localStorage ใช้ไม่ได้ → ไม่ throw และไม่ย่อ (หน้าทั่วไป)", () => {
    const attrs = runInitScript({ path: "/todo", stored: "throw" });
    expect(attrs.get(NAV_MINI_ATTR)).toBeUndefined();
    expect(attrs.get(NAV_NOANIM_ATTR)).toBe("1");
  });

  it("localStorage ใช้ไม่ได้ แต่หน้าบังคับย่อ → ย่อ", () => {
    const attrs = runInitScript({ path: "/customers/new", stored: "throw" });
    expect(attrs.get(NAV_MINI_ATTR)).toBe("1");
  });
});
