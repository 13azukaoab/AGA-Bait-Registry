/**
 * ด่านชี้ cloud ของสคริปต์นำเข้า/ถอยกลับ (แผนนำเข้า cloud 23 พ.ย. 2026 หัวข้อ 3)
 *
 * Logic summary:
 *   1. resolveImportTarget — เลือกปลายทาง
 *      - ไม่ใส่ --target = ทางเดิม: URL ต้องเป็น localhost / 127.0.0.1 / [::1] เท่านั้น (ข้อความหยุดเดิม)
 *      - --target cloud = ยอมเฉพาะ https://<ref>.supabase.co (ไม่มีพอร์ต/path/query/userinfo)
 *        และ ref ต้องตรงกัน 3 ที่: --project-ref = subdomain ของ URL = env AGA_CLOUD_PROJECT_REF
 *      - --target ค่าอื่น / --project-ref โดยไม่มี --target cloud = หยุด (ไม่ตกไปทาง local เงียบๆ)
 *      - ข้อความหยุดของ cloud ไม่พิมพ์ URL / ref (กันหลุดไปอยู่ในแชท/ภาพหน้าจอ)
 *   2. runGuarded — ลำดับ dry-run → ยืนยัน → เขียน
 *      - local: เหมือนเดิมทุกอย่าง (ไม่ใส่ --apply = dry-run · ใส่ = เขียนทันที ไม่ถาม)
 *      - cloud ไม่ใส่ --apply = dry-run อย่างเดียว
 *      - cloud + --apply: input ต้องเป็นเทอร์มินัล (กัน `echo … |`) → dry-run ในตัว → แสดงตัวเลข →
 *        ต้องพิมพ์วลีตรงตัว `นำเข้า <n>` / `ลบ <n>` (n มาจากผล dry-run) · ผิด/ว่าง/EOF = ไม่เขียน
 *        ไม่มี flag หรือ env ใดข้ามขั้นนี้ได้
 *   3. resolveLogFile / writeRunLog — ไฟล์ผล (หลักฐาน) นอก repo
 *      - cloud บังคับมีโฟลเดอร์ log (--log-dir หรือ env AGA_IMPORT_LOG_DIR) · local ไม่บังคับ
 *      - โฟลเดอร์ต้องมีอยู่จริงและอยู่นอก repo (เทียบหลัง realpath กัน ../ และ junction)
 *      - เนื้อ log ผ่าน makeRedactor (ตัด URL / host *.supabase.co / key / ref / JWT) · เปิดไฟล์แบบ wx ไม่เขียนทับ
 *      - ผู้เรียกใส่เฉพาะตัวเลขรวม/เลขแถว/ชื่อสาขา (ไม่มีชื่อ/เบอร์ลูกค้า)
 *
 * ไฟล์นี้ไม่อ่าน process.env / process.stdin เอง — สคริปต์ส่งค่าเข้ามา (เทสได้ด้วยค่าสมมติ ไม่ต่อ cloud จริง)
 */
import { realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** ชื่อ env ที่เจ้าของตั้งตอนรัน cloud (ค่าจริงอยู่ในเทอร์มินัลของเครื่องที่รันเท่านั้น) */
export const ENV_CLOUD_PROJECT_REF = "AGA_CLOUD_PROJECT_REF";
export const ENV_LOG_DIR = "AGA_IMPORT_LOG_DIR";

const CLOUD_HOST_RE = /^([a-z0-9]+)\.supabase\.co$/;
const REF_RE = /^[a-z0-9]+$/;

export type ImportTarget = { kind: "local" } | { kind: "cloud"; ref: string };

// ---------------------------------------------------------------------
// อ่าน flag
// ---------------------------------------------------------------------

/** ค่าของ flag (`--name value`) · ไม่มี flag = undefined · มี flag แต่ไม่มีค่า/ค่าเป็น flag อื่น = throw */
export function readFlag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    throw new Error(`${name} ต้องมีค่าต่อท้าย`);
  }
  return value;
}

// ---------------------------------------------------------------------
// เลือกปลายทาง
// ---------------------------------------------------------------------

export interface TargetInput {
  /** ค่าของ --target (undefined = ไม่ใส่) */
  target?: string;
  /** ค่าของ --project-ref */
  projectRef?: string;
  /** NEXT_PUBLIC_SUPABASE_URL */
  url: string;
  /** env AGA_CLOUD_PROJECT_REF */
  envRef?: string;
}

// เขียนแบบ "https:// ตามด้วย" (มีช่องว่าง) เพื่อให้ข้อความรอดตัวลบ URL ของ makeRedactor
const CLOUD_URL_RULE = "NEXT_PUBLIC_SUPABASE_URL ต้องเป็น https:// ตามด้วย <ref>.supabase.co (ไม่มีพอร์ต/path) เมื่อใช้ --target cloud";

function parseUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    // ไม่ใส่ค่า URL ในข้อความ
    throw new Error("หยุด: NEXT_PUBLIC_SUPABASE_URL ไม่ใช่ URL ที่อ่านได้");
  }
}

/** ตรวจปลายทาง (ดู Logic summary ข้อ 1) · ไม่ผ่าน = throw */
export function resolveImportTarget(input: TargetInput): ImportTarget {
  const parsed = parseUrl(input.url);

  if (input.target === undefined) {
    if (input.projectRef !== undefined) {
      throw new Error("หยุด: --project-ref ใช้ได้กับ --target cloud เท่านั้น");
    }
    if (!LOCAL_HOSTS.has(parsed.hostname)) {
      throw new Error(`หยุด: ${parsed.hostname} ไม่ใช่ฐานข้อมูลในเครื่อง (สคริปต์นี้ห้ามเขียน cloud)`);
    }
    return { kind: "local" };
  }

  if (input.target !== "cloud") {
    throw new Error("หยุด: --target รับเฉพาะ cloud (ไม่ใส่ = ฐานข้อมูลในเครื่อง)");
  }

  const host = CLOUD_HOST_RE.exec(parsed.hostname);
  const cleanPath = parsed.pathname === "/" || parsed.pathname === "";
  if (
    parsed.protocol !== "https:" ||
    !host ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !cleanPath ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(`หยุด: ${CLOUD_URL_RULE}`);
  }

  const projectRef = input.projectRef?.trim();
  const envRef = input.envRef?.trim();
  if (!projectRef) throw new Error("หยุด: ต้องระบุ --project-ref <ref> เมื่อใช้ --target cloud");
  if (!envRef) throw new Error(`หยุด: ต้องตั้ง env ${ENV_CLOUD_PROJECT_REF} เมื่อใช้ --target cloud`);
  const urlRef = host[1]!;
  if (!REF_RE.test(projectRef) || projectRef !== urlRef || envRef !== urlRef) {
    throw new Error(
      `หยุด: project ref ไม่ตรงกัน — --project-ref, subdomain ของ NEXT_PUBLIC_SUPABASE_URL และ env ${ENV_CLOUD_PROJECT_REF} ต้องเป็นค่าเดียวกันทั้ง 3 ที่`,
    );
  }
  return { kind: "cloud", ref: urlRef };
}

// ---------------------------------------------------------------------
// คำยืนยัน
// ---------------------------------------------------------------------

export type GuardedAction = "import" | "rollback";

/** วลีที่ต้องพิมพ์ — นำเข้าใช้ "นำเข้า" · ถอยใช้ "ลบ" (คัดลอกข้ามกันไม่ได้) */
export function confirmPhrase(action: GuardedAction, count: number): string {
  return `${action === "import" ? "นำเข้า" : "ลบ"} ${count}`;
}

const norm = (s: string): string => s.normalize("NFC").trim();

/** ตรงตัว (ยอมแค่ช่องว่างหัวท้าย และ Unicode คนละรูปแบบที่หน้าตาเหมือนกัน) */
export function matchesConfirmation(input: string | null | undefined, expected: string): boolean {
  if (input === null || input === undefined) return false;
  const got = norm(input);
  return got !== "" && got === norm(expected);
}

// ---------------------------------------------------------------------
// dry-run → ยืนยัน → เขียน
// ---------------------------------------------------------------------

export interface GuardedRunOptions<D, A> {
  target: ImportTarget;
  /** ใส่ --apply มาหรือไม่ */
  apply: boolean;
  action: GuardedAction;
  /** ตรวจอย่างเดียว ไม่เขียน */
  dryRun: () => Promise<D>;
  /** จำนวนที่ต้องพิมพ์ยืนยัน (จากผล dry-run) */
  confirmCount: (dry: D) => number;
  /** ข้อความสรุปตัวเลขที่จะเขียน (แสดงก่อนถาม) */
  describe: (dry: D) => string;
  /** เขียนจริง · cloud ได้ผล dry-run ที่คนยืนยันแล้ว (ใช้ล็อกจำนวน) · local --apply ได้ undefined (ไม่มี dry-run ก่อน) */
  write: (confirmedDry?: D) => Promise<A>;
  /** ถามในเทอร์มินัล · คืน null เมื่อ EOF/ปิด input */
  ask: (prompt: string) => Promise<string | null>;
  /** stdin เป็นเทอร์มินัลหรือไม่ */
  isTTY: boolean;
  print: (text: string) => void;
}

export type GuardedRunResult<D, A> =
  | { status: "dry-run"; dry: D }
  | { status: "applied"; dry?: D; result: A }
  | { status: "aborted"; dry: D; reason: string };

/** ดู Logic summary ข้อ 2 */
export async function runGuarded<D, A>(o: GuardedRunOptions<D, A>): Promise<GuardedRunResult<D, A>> {
  if (o.target.kind === "local") {
    if (o.apply) return { status: "applied", result: await o.write() };
    return { status: "dry-run", dry: await o.dryRun() };
  }

  if (!o.apply) return { status: "dry-run", dry: await o.dryRun() };

  if (!o.isTTY) {
    throw new Error(
      "หยุด: --apply บน cloud ต้องรันในเทอร์มินัลที่พิมพ์ได้ (PowerShell / Windows Terminal) — ห้ามส่งคำยืนยันผ่าน pipe/ไฟล์ · Git Bash (mintty) ใช้ไม่ได้",
    );
  }

  const dry = await o.dryRun();
  const count = o.confirmCount(dry);
  o.print(o.describe(dry));
  if (!Number.isInteger(count) || count <= 0) {
    return { status: "aborted", dry, reason: "dry-run ไม่มีแถวที่จะเขียน — ไม่ทำอะไร" };
  }
  const phrase = confirmPhrase(o.action, count);
  const answer = await o.ask(`พิมพ์ "${phrase}" แล้วกด Enter เพื่อยืนยัน (อย่างอื่น = ยกเลิก): `);
  if (!matchesConfirmation(answer, phrase)) {
    return { status: "aborted", dry, reason: "คำยืนยันไม่ตรง — ยกเลิก ไม่มีอะไรถูกเขียน" };
  }
  return { status: "applied", dry, result: await o.write(dry) };
}

// ---------------------------------------------------------------------
// log นอก repo
// ---------------------------------------------------------------------

export interface LogFileInput {
  target: ImportTarget;
  /** root ของ repo (สคริปต์หาจากตำแหน่งไฟล์ตัวเอง) */
  repoRoot: string;
  /** ชื่อสคริปต์ (ใช้ตั้งชื่อไฟล์) */
  script: string;
  /** --log-dir */
  logDir?: string;
  /** env AGA_IMPORT_LOG_DIR */
  envLogDir?: string;
  now: Date;
}

function isInside(root: string, dir: string): boolean {
  const rel = relative(root, dir);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false; // คนละไดรฟ์ (Windows)
  return !(rel === ".." || rel.startsWith(`..${sep}`));
}

/** path ไฟล์ log (null = local และไม่ได้ขอ log) · ดู Logic summary ข้อ 3 */
export function resolveLogFile(input: LogFileInput): string | null {
  const dir = input.logDir?.trim() || input.envLogDir?.trim();
  if (!dir) {
    if (input.target.kind === "cloud") {
      throw new Error(`หยุด: ต้องระบุโฟลเดอร์ log นอก repo (--log-dir <โฟลเดอร์> หรือ env ${ENV_LOG_DIR}) เมื่อใช้ --target cloud`);
    }
    return null;
  }
  let real: string;
  try {
    real = realpathSync(resolve(dir));
    if (!statSync(real).isDirectory()) throw new Error("not dir");
  } catch {
    throw new Error("หยุด: ไม่พบโฟลเดอร์ log (สร้างโฟลเดอร์นอก repo ก่อน)");
  }
  const root = realpathSync(resolve(input.repoRoot));
  if (isInside(root, real)) throw new Error("หยุด: ห้ามเก็บ log ใน repo — เลือกโฟลเดอร์นอก repo");
  const stamp = input.now.toISOString().replace(/[:.]/g, "-");
  return join(real, `${input.script}-${stamp}.json`);
}

const REDACTED = "<ซ่อน>";

/** ตัวลบค่าลับออกจากข้อความ: ค่าที่ส่งมา (URL/key/ref) + URL ทุกตัว + host *.supabase.co + JWT */
export function makeRedactor(secrets: readonly (string | undefined)[]): (text: string) => string {
  const exact = secrets
    .map((s) => s?.trim())
    .filter((s): s is string => !!s && s.length >= 4)
    .sort((a, b) => b.length - a.length);
  return (text: string): string => {
    // แบบรูปแบบก่อน (ถ้าแทน ref ก่อน host จะเหลือ ".supabase.co" ค้าง) แล้วค่อยค่าที่ส่งมาตรงตัว
    let out = text
      .replace(/https?:\/\/[^\s"'`)]+/gi, REDACTED)
      .replace(/[a-z0-9-]+(\.[a-z0-9-]+)*\.supabase\.(co|in)\b/gi, REDACTED)
      .replace(/eyJ[\w-]*\.[\w-]+\.[\w-]+/g, REDACTED);
    for (const s of exact) out = out.split(s).join(REDACTED);
    return out;
  };
}

/** เขียน log (JSON) ผ่านตัวลบค่าลับ · ไฟล์มีอยู่แล้ว = throw (ไม่เขียนทับหลักฐานเดิม) */
export function writeRunLog(file: string, entry: unknown, redact: (text: string) => string): void {
  writeFileSync(file, `${redact(JSON.stringify(entry, null, 2))}\n`, { encoding: "utf8", flag: "wx" });
}
