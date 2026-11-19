/**
 * เทสด่านชี้ cloud ของสคริปต์นำเข้า/ถอย (ไม่ต่อฐานข้อมูลจริง · URL/key/ref เป็นค่าสมมติทั้งหมด)
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  confirmPhrase,
  makeRedactor,
  matchesConfirmation,
  readFlag,
  resolveImportTarget,
  resolveLogFile,
  runGuarded,
  writeRunLog,
  type ImportTarget,
} from "./cloudGuard";

const REF = "abcdefghijklmnopqrst"; // สมมติ (20 ตัว)
const CLOUD_URL = `https://${REF}.supabase.co`;

describe("readFlag", () => {
  it("ไม่มี flag = undefined · มีค่า = ค่านั้น", () => {
    expect(readFlag(["node", "x"], "--target")).toBeUndefined();
    expect(readFlag(["node", "x", "--target", "cloud"], "--target")).toBe("cloud");
  });
  it("มี flag แต่ไม่มีค่า หรือค่าขึ้นต้นด้วย -- = หยุด (กัน --project-ref --apply)", () => {
    expect(() => readFlag(["node", "x", "--project-ref"], "--project-ref")).toThrow(/ต้องมีค่า/);
    expect(() => readFlag(["node", "x", "--project-ref", "--apply"], "--project-ref")).toThrow(/ต้องมีค่า/);
  });
});

describe("resolveImportTarget — ไม่ใส่ --target (ทางเดิม localhost เท่านั้น)", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321", "http://[::1]:54321"])("ยอม %s", (url) => {
    expect(resolveImportTarget({ url })).toEqual<ImportTarget>({ kind: "local" });
  });
  it("URL cloud โดยไม่ใส่ --target cloud = หยุด (ข้อความเดิม)", () => {
    expect(() => resolveImportTarget({ url: CLOUD_URL, envRef: REF })).toThrow(
      `หยุด: ${REF}.supabase.co ไม่ใช่ฐานข้อมูลในเครื่อง (สคริปต์นี้ห้ามเขียน cloud)`,
    );
  });
  it("--project-ref โดยไม่ใส่ --target cloud = หยุด", () => {
    expect(() => resolveImportTarget({ url: "http://127.0.0.1:54321", projectRef: REF })).toThrow(/--project-ref ใช้ได้กับ --target cloud เท่านั้น/);
  });
  it("--target ค่าอื่น = หยุด (ไม่ตกไปทาง local เงียบๆ)", () => {
    expect(() => resolveImportTarget({ url: "http://127.0.0.1:54321", target: "local" })).toThrow(/--target รับเฉพาะ cloud/);
    expect(() => resolveImportTarget({ url: "http://127.0.0.1:54321", target: "Cloud" })).toThrow(/--target รับเฉพาะ cloud/);
  });
  it("URL พัง = หยุด โดยไม่พิมพ์ URL", () => {
    expect(() => resolveImportTarget({ url: "not a url secret-ish" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL ไม่ใช่ URL/);
    try {
      resolveImportTarget({ url: "not a url secret-ish" });
    } catch (e) {
      expect(String(e)).not.toContain("secret-ish");
    }
  });
});

describe("resolveImportTarget — --target cloud", () => {
  const ok = { target: "cloud", url: CLOUD_URL, projectRef: REF, envRef: REF };

  it("ref 3 ที่ตรงกัน + https://<ref>.supabase.co = ผ่าน", () => {
    expect(resolveImportTarget(ok)).toEqual<ImportTarget>({ kind: "cloud", ref: REF });
    expect(resolveImportTarget({ ...ok, url: `${CLOUD_URL}/` })).toEqual<ImportTarget>({ kind: "cloud", ref: REF });
  });

  it.each([
    ["localhost", "http://127.0.0.1:54321"],
    ["http (ไม่ใช่ https)", `http://${REF}.supabase.co`],
    ["host ปลอมต่อท้าย", `https://${REF}.supabase.co.evil.com`],
    ["userinfo หลอก", `https://${REF}.supabase.co@evil.com`],
    ["subdomain ซ้อน", `https://x.${REF}.supabase.co`],
    ["supabase.co เปล่า", "https://supabase.co"],
    ["มีพอร์ต", `https://${REF}.supabase.co:8443`],
    ["มี path", `https://${REF}.supabase.co/rest/v1`],
    ["มี query", `https://${REF}.supabase.co/?x=1`],
    ["โดเมนอื่น", "https://example.com"],
  ])("ปฏิเสธ host ที่ไม่ใช่ https://<ref>.supabase.co: %s", (_label, url) => {
    expect(() => resolveImportTarget({ ...ok, url })).toThrow(/ต้องเป็น https:\/\/ ตามด้วย <ref>\.supabase\.co/);
  });

  it("ข้อความกฎ URL อ่านออกแม้ผ่านตัวลบค่าลับ", () => {
    const redact = makeRedactor([CLOUD_URL, REF]);
    try {
      resolveImportTarget({ ...ok, url: "https://example.com" });
    } catch (e) {
      expect(redact(String(e))).toContain("https:// ตามด้วย <ref>.supabase.co");
    }
  });

  it("ขาด --project-ref หรือ env AGA_CLOUD_PROJECT_REF = หยุด", () => {
    expect(() => resolveImportTarget({ ...ok, projectRef: undefined })).toThrow(/ต้องระบุ --project-ref/);
    expect(() => resolveImportTarget({ ...ok, envRef: undefined })).toThrow(/ต้องตั้ง env AGA_CLOUD_PROJECT_REF/);
    expect(() => resolveImportTarget({ ...ok, envRef: "  " })).toThrow(/ต้องตั้ง env AGA_CLOUD_PROJECT_REF/);
  });

  it.each([
    ["--project-ref ต่าง", { projectRef: "zzzzzzzzzzzzzzzzzzzz" }],
    ["env ต่าง", { envRef: "zzzzzzzzzzzzzzzzzzzz" }],
    ["URL ต่าง", { url: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co" }],
    ["ตัวพิมพ์ใหญ่ไม่นับว่าตรง", { projectRef: REF.toUpperCase() }],
  ])("ref ไม่ตรงกัน = หยุด (%s) และไม่พิมพ์ค่า ref", (_label, patch) => {
    const run = () => resolveImportTarget({ ...ok, ...patch });
    expect(run).toThrow(/project ref ไม่ตรงกัน/);
    try {
      run();
    } catch (e) {
      expect(String(e)).not.toContain(REF);
      expect(String(e)).not.toContain("zzzz");
    }
  });
});

describe("คำยืนยัน", () => {
  it("วลีตรงตัว: นำเข้า <n> / ลบ <n>", () => {
    expect(confirmPhrase("import", 2369)).toBe("นำเข้า 2369");
    expect(confirmPhrase("rollback", 903)).toBe("ลบ 903");
  });
  it("ยอมช่องว่างหัวท้าย + Unicode คนละรูปแบบ (NFC) · ไม่ยอมตัวเลขผิด/ว่าง/EOF", () => {
    expect(matchesConfirmation("  นำเข้า 2369\r\n", "นำเข้า 2369")).toBe(true);
    expect(matchesConfirmation("นำเข้า 2369".normalize("NFD"), "นำเข้า 2369")).toBe(true);
    expect(matchesConfirmation("นำเข้า 2368", "นำเข้า 2369")).toBe(false);
    expect(matchesConfirmation("นำเข้า  2369", "นำเข้า 2369")).toBe(false);
    expect(matchesConfirmation("ลบ 2369", "นำเข้า 2369")).toBe(false);
    expect(matchesConfirmation("y", "นำเข้า 2369")).toBe(false);
    expect(matchesConfirmation("", "นำเข้า 2369")).toBe(false);
    expect(matchesConfirmation(null, "นำเข้า 2369")).toBe(false);
  });
});

/** ตัวช่วยเทส runGuarded: นับว่าเรียก dry-run / write กี่ครั้ง */
function harness(target: ImportTarget, opts: { apply: boolean; answer?: string | null; isTTY?: boolean; count?: number }) {
  const calls = { dry: 0, write: 0, asked: [] as string[], printed: [] as string[] };
  const run = () =>
    runGuarded({
      target,
      apply: opts.apply,
      action: "import",
      dryRun: async () => {
        calls.dry++;
        return { rows: opts.count ?? 903 };
      },
      confirmCount: (d) => d.rows,
      describe: (d) => `จะเขียน ${d.rows} แถว`,
      write: async () => {
        calls.write++;
        return { written: opts.count ?? 903 };
      },
      ask: async (prompt) => {
        calls.asked.push(prompt);
        return opts.answer ?? null;
      },
      isTTY: opts.isTTY ?? true,
      print: (t) => calls.printed.push(t),
    });
  return { calls, run };
}

describe("runGuarded — localhost (ทางเดิม)", () => {
  it("ไม่ใส่ --apply = dry-run อย่างเดียว ไม่ถาม ไม่เขียน", async () => {
    const h = harness({ kind: "local" }, { apply: false });
    await expect(h.run()).resolves.toMatchObject({ status: "dry-run", dry: { rows: 903 } });
    expect(h.calls).toMatchObject({ dry: 1, write: 0, asked: [] });
  });
  it("--apply = เขียนทันทีเหมือนเดิม (ไม่ถามยืนยัน · ไม่ต้องเป็น TTY)", async () => {
    const h = harness({ kind: "local" }, { apply: true, isTTY: false });
    await expect(h.run()).resolves.toMatchObject({ status: "applied", result: { written: 903 } });
    expect(h.calls).toMatchObject({ dry: 0, write: 1, asked: [] });
  });
});

describe("runGuarded — cloud", () => {
  const cloud: ImportTarget = { kind: "cloud", ref: REF };

  it("ไม่ใส่ --apply = dry-run อย่างเดียว", async () => {
    const h = harness(cloud, { apply: false });
    await expect(h.run()).resolves.toMatchObject({ status: "dry-run" });
    expect(h.calls).toMatchObject({ dry: 1, write: 0, asked: [] });
  });

  it("write ได้รับผล dry-run ที่ยืนยันแล้ว (cloud) / undefined (local)", async () => {
    const seen: unknown[] = [];
    const base = {
      apply: true,
      action: "import" as const,
      dryRun: async () => ({ rows: 7 }),
      confirmCount: (d: { rows: number }) => d.rows,
      describe: () => "",
      write: async (d?: { rows: number }) => {
        seen.push(d);
      },
      ask: async () => "นำเข้า 7",
      isTTY: true,
      print: () => {},
    };
    await runGuarded({ ...base, target: cloud });
    await runGuarded({ ...base, target: { kind: "local" } });
    expect(seen).toEqual([{ rows: 7 }, undefined]);
  });

  it("--apply: dry-run ในตัวก่อน แสดงตัวเลข แล้วพิมพ์ตรงตัว = เขียน", async () => {
    const h = harness(cloud, { apply: true, answer: "นำเข้า 903" });
    await expect(h.run()).resolves.toMatchObject({ status: "applied", dry: { rows: 903 }, result: { written: 903 } });
    expect(h.calls.dry).toBe(1);
    expect(h.calls.write).toBe(1);
    expect(h.calls.printed.join("\n")).toContain("จะเขียน 903 แถว");
    expect(h.calls.asked[0]).toContain("นำเข้า 903");
  });

  it.each([
    ["พิมพ์ผิด", "นำเข้า 902"],
    ["พิมพ์ y", "y"],
    ["ไม่พิมพ์ (Enter เปล่า)", ""],
    ["ปิด input (EOF)", null],
  ])("--apply แต่ %s = ไม่เขียน", async (_label, answer) => {
    const h = harness(cloud, { apply: true, answer });
    await expect(h.run()).resolves.toMatchObject({ status: "aborted" });
    expect(h.calls.write).toBe(0);
  });

  it("--apply ที่ input ไม่ใช่เทอร์มินัล (เช่น echo ... |) = หยุดก่อนอ่าน DB", async () => {
    const h = harness(cloud, { apply: true, isTTY: false, answer: "นำเข้า 903" });
    await expect(h.run()).rejects.toThrow(/ต้องรันในเทอร์มินัลที่พิมพ์ได้/);
    expect(h.calls).toMatchObject({ dry: 0, write: 0 });
  });

  it("dry-run ได้ 0 แถว = ไม่ถาม ไม่เขียน", async () => {
    const h = harness(cloud, { apply: true, answer: "นำเข้า 0", count: 0 });
    await expect(h.run()).resolves.toMatchObject({ status: "aborted" });
    expect(h.calls.asked).toEqual([]);
    expect(h.calls.write).toBe(0);
  });

  it("dry-run พัง = ไม่ถาม ไม่เขียน (throw ต่อ)", async () => {
    let wrote = 0;
    await expect(
      runGuarded({
        target: cloud,
        apply: true,
        action: "import",
        dryRun: async () => {
          throw new Error("มีข้อมูลเดิม");
        },
        confirmCount: () => 1,
        describe: () => "",
        write: async () => {
          wrote++;
        },
        ask: async () => "นำเข้า 1",
        isTTY: true,
        print: () => {},
      }),
    ).rejects.toThrow(/มีข้อมูลเดิม/);
    expect(wrote).toBe(0);
  });
});

describe("log นอก repo", () => {
  const stamp = new Date("2026-11-23T02:00:00.000Z");

  function dirs() {
    const base = mkdtempSync(join(tmpdir(), "aga-cloudguard-"));
    const repo = join(base, "repo");
    const outside = join(base, "logs");
    mkdirSync(join(repo, "docs"), { recursive: true });
    mkdirSync(outside);
    return { repo, outside };
  }

  it("cloud ต้องมีโฟลเดอร์ log (arg หรือ env) · local ไม่บังคับ", () => {
    const { repo } = dirs();
    expect(() => resolveLogFile({ target: { kind: "cloud", ref: REF }, repoRoot: repo, script: "x", now: stamp })).toThrow(/ต้องระบุโฟลเดอร์ log/);
    expect(resolveLogFile({ target: { kind: "local" }, repoRoot: repo, script: "x", now: stamp })).toBeNull();
  });

  it("โฟลเดอร์นอก repo = ได้ path ไฟล์ · arg มาก่อน env", () => {
    const { repo, outside } = dirs();
    const file = resolveLogFile({ target: { kind: "cloud", ref: REF }, repoRoot: repo, script: "import-legacy", logDir: outside, envLogDir: repo, now: stamp });
    expect(file).toBe(join(outside, "import-legacy-2026-11-23T02-00-00-000Z.json"));
    const fromEnv = resolveLogFile({ target: { kind: "cloud", ref: REF }, repoRoot: repo, script: "x", envLogDir: outside, now: stamp });
    expect(fromEnv).toContain(outside);
  });

  it("โฟลเดอร์ใน repo (ตัว repo เอง / โฟลเดอร์ย่อย / ../ วนกลับเข้า) = หยุด", () => {
    const { repo } = dirs();
    for (const d of [repo, join(repo, "docs"), join(repo, "docs", "..")]) {
      expect(() => resolveLogFile({ target: { kind: "cloud", ref: REF }, repoRoot: repo, script: "x", logDir: d, now: stamp })).toThrow(/ห้ามเก็บ log ใน repo/);
    }
  });

  it("โฟลเดอร์ไม่มีอยู่จริง = หยุด", () => {
    const { repo, outside } = dirs();
    expect(() =>
      resolveLogFile({ target: { kind: "cloud", ref: REF }, repoRoot: repo, script: "x", logDir: join(outside, "nope"), now: stamp }),
    ).toThrow(/ไม่พบโฟลเดอร์ log/);
  });

  it("เขียน log แล้วไม่มี URL / host / key / ref / JWT หลุด · ไม่เขียนทับไฟล์เดิม", () => {
    const { outside } = dirs();
    const key = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl"; // JWT สมมติ
    const redact = makeRedactor([CLOUD_URL, key, REF]);
    const file = join(outside, "log.json");
    writeRunLog(
      file,
      {
        script: "import-central-registry",
        target: "cloud",
        status: "error",
        error: `fetch failed: getaddrinfo ENOTFOUND ${REF}.supabase.co (${CLOUD_URL}/rest/v1/contracts) key=${key} other=eyJxxx.yyy.zzz`,
        summary: { contracts: 2369 },
      },
      redact,
    );
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain(REF);
    expect(text).not.toContain("supabase.co");
    expect(text).not.toContain(key);
    expect(text).not.toContain("eyJxxx");
    expect(text).toContain("2369");
    expect(JSON.parse(text)).toMatchObject({ script: "import-central-registry", status: "error" });
    expect(() => writeRunLog(file, { again: true }, redact)).toThrow();
    expect(readdirSync(outside)).toEqual(["log.json"]);
  });
});
