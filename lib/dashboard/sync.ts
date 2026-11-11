/**
 * ส่ง `dashboard_data.json` ขึ้น repo ของ AGA Bait Dashboard ผ่าน GitHub API — SPEC §9.2
 *
 * ลำดับการทำงาน
 * 1. ตรวจไฟล์ให้ถูกรูปแบบก่อน (43 สาขา/เดือน · 16 ฟิลด์ · ชื่อสาขาสะกดตรง) — `assertValidDashboardData`
 * 2. อ่านไฟล์ปัจจุบันบน repo ทั้ง 2 ไฟล์: `dashboard_data.json` และ `index.html`
 * 3. **ถ้าข้อมูลเหมือนเดิมทั้งคู่ → ข้าม ไม่ commit** (นับว่าสำเร็จ) เพื่อไม่ให้ Netlify build ใหม่ทุกวัน
 * 4. ถ้าต่าง → commit ทั้ง 2 ไฟล์ใน **commit เดียว** (Git Data API) → Netlify deploy รอบเดียว
 * 5. คืน record สำหรับบันทึกลงตาราง `sync_logs` (สำเร็จ / ข้าม / ล้มเหลว + ข้อความ error)
 *
 * ตรวจกับ repo จริงเมื่อ 11 พ.ย. 2026 (อ่านอย่างเดียว):
 * - `index.html` ฝังข้อมูลไว้ในบรรทัด `const DATA = {…};` **ไม่มี fetch ไฟล์ .json เลย**
 *   → หน้าที่ผู้ใช้เห็นมาจาก `index.html` เท่านั้น ถ้า commit แค่ `dashboard_data.json` Dashboard จะไม่เปลี่ยน
 * - จึงต้องเขียนทั้ง 2 ไฟล์เสมอ (ไฟล์ .json คือสำเนาข้อมูลสำหรับนำไปใช้ต่อ/สำรอง)
 *
 * ข้อห้าม: GitHub token มาจาก environment variable ของ Vercel เท่านั้น (CLAUDE.md กฎ 8)
 * ห้ามใส่ token ลงข้อความ error หรือ log
 */
import type { DashboardData } from "./types";
import { assertValidDashboardData } from "./validate";

/** ปลายทางบน GitHub (ค่าตั้งต้นตาม SPEC §9.2) */
export interface DashboardRepoTarget {
  owner: string;
  repo: string;
  /** branch ปลายทาง (ค่าตั้งต้น `main`) */
  branch?: string;
  /** path ของไฟล์ข้อมูล (ค่าตั้งต้น `dashboard_data.json`) */
  dataPath?: string;
  /** path ของหน้าเว็บที่ฝัง `const DATA` (ค่าตั้งต้น `index.html`) */
  indexPath?: string;
}

export type SyncOutcome = "ok" | "skip" | "fail";

/** ผลการส่ง 1 ครั้ง — รูปแบบนี้เอาไปบันทึกตาราง `sync_logs` ได้ตรงๆ (SPEC §9.2, หน้าจอ 10) */
export interface SyncLogRecord {
  result: SyncOutcome;
  /** ไฟล์ที่ commit จริงในรอบนี้ (ข้าม/ล้มเหลว = ว่าง) */
  files: string[];
  /** จำนวนเดือนในไฟล์ที่ส่ง */
  months: number;
  /** จำนวนแถวรวมทั้งไฟล์ (เดือน × สาขา) */
  rows: number;
  /** sha ของ commit ที่สร้าง (เฉพาะกรณีสำเร็จ) */
  commitSha?: string;
  /** ข้อความอธิบายผลสำหรับแสดงในหน้าจอ */
  message: string;
  /** ข้อความ error (เฉพาะกรณีล้มเหลว) — ไม่มี token อยู่ในข้อความนี้ */
  error?: string;
  durationMs: number;
}

export interface SyncOptions {
  target: DashboardRepoTarget;
  /** GitHub token จาก environment variable เท่านั้น */
  token: string;
  /** ข้อความ commit (ค่าตั้งต้นสร้างจากรายชื่อเดือนล่าสุด) */
  commitMessage?: string;
  /** ใส่ fetch จำลองตอนเทส (ค่าตั้งต้นใช้ fetch ของ runtime) */
  fetchImpl?: typeof fetch;
  /** ใส่ตัวจับเวลาจำลองตอนเทส */
  now?: () => number;
}

const GITHUB_API = "https://api.github.com";
const DATA_MARKER = /^const DATA = .*;[ \t]*$/m;

/** แปลงข้อมูลเป็นข้อความ JSON แบบเดียวกับไฟล์เดิมบน repo (ไม่มีช่องว่าง ไม่มีขึ้นบรรทัด) */
export function serializeDashboardData(data: DashboardData): string {
  return JSON.stringify(data);
}

/** ดึงข้อความ JSON ออกจากบรรทัด `const DATA = {...};` ของ index.html (ไม่พบ = `null`) */
export function extractIndexData(html: string): string | null {
  const line = html.match(DATA_MARKER)?.[0];
  if (!line) return null;
  return line.replace(/^const DATA = /, "").replace(/;[ \t]*$/, "");
}

/**
 * แทนที่ข้อมูลในบรรทัด `const DATA = …;` ของ index.html ด้วยข้อมูลชุดใหม่
 * throw เมื่อหาบรรทัดไม่เจอ (หน้า Dashboard ถูกแก้โครงสร้าง — ต้องให้คนตรวจก่อน ห้ามเขียนทับมั่ว)
 */
export function replaceIndexData(html: string, json: string): string {
  if (!DATA_MARKER.test(html)) {
    throw new Error(
      "ไม่พบบรรทัด `const DATA = …;` ใน index.html ของ Dashboard — โครงสร้างหน้าเปลี่ยนไป ต้องให้ผู้ดูแลตรวจก่อนส่ง",
    );
  }
  return html.replace(DATA_MARKER, `const DATA = ${json};`);
}

/**
 * เทียบว่าเป็นข้อมูลชุดเดียวกันไหม โดยไม่สนรูปแบบการเขียน
 * (ไฟล์เดิมบน repo เขียนเลขบางตัวเป็น `6744617.0` ซึ่ง `JSON.stringify` จะได้ `6744617`
 *  ถ้าเทียบตรงๆ จะกลายเป็น "ต่าง" ทุกวันแล้ว commit ซ้ำโดยไม่จำเป็น)
 */
export function isSameJsonContent(
  remote: string | null,
  json: string,
): boolean {
  if (remote === null) return false;
  try {
    return JSON.stringify(JSON.parse(remote)) === json;
  } catch {
    return false;
  }
}

function toBase64(text: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf8").toString("base64");
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(encoded: string): string {
  const clean = encoded.replace(/\s/g, "");
  if (typeof Buffer !== "undefined") {
    return Buffer.from(clean, "base64").toString("utf8");
  }
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** error ของการเรียก GitHub API — เก็บ status ไว้ให้หน้าจอแนะนำวิธีแก้ได้ (401 = token, 5xx = ลองใหม่) */
export class GithubApiError extends Error {
  constructor(
    readonly status: number,
    readonly request: string,
    message: string,
  ) {
    super(`GitHub API ${status} ${message} (${request})`);
    this.name = "GithubApiError";
  }
}

interface GithubClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
}

function createClient(token: string, fetchImpl: typeof fetch): GithubClient {
  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const response = await fetchImpl(`${GITHUB_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "aga-bait-registry",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      // อ่านข้อความจาก GitHub เท่าที่อ่านได้ (ห้ามใส่ token ลงข้อความ)
      let detail = response.statusText;
      try {
        const text = await response.text();
        const parsed: unknown = JSON.parse(text);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof (parsed as { message?: unknown }).message === "string"
        ) {
          detail = (parsed as { message: string }).message;
        } else if (text) {
          detail = text.slice(0, 200);
        }
      } catch {
        /* ใช้ statusText ต่อไป */
      }
      throw new GithubApiError(response.status, `${method} ${path}`, detail);
    }

    return (await response.json()) as T;
  };

  return {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body),
    patch: (path, body) => call("PATCH", path, body),
  };
}

/** อ่านไฟล์เดิมบน repo — ไม่มีไฟล์ (404) คืน `null` เพื่อให้สร้างใหม่ได้ */
async function readFile(
  client: GithubClient,
  target: Required<DashboardRepoTarget>,
  path: string,
): Promise<string | null> {
  try {
    const res = await client.get<{ content?: string; encoding?: string }>(
      `/repos/${target.owner}/${target.repo}/contents/${path}?ref=${target.branch}`,
    );
    if (!res.content) return null;
    return fromBase64(res.content);
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 404) return null;
    throw error;
  }
}

function withDefaults(target: DashboardRepoTarget): Required<DashboardRepoTarget> {
  return {
    owner: target.owner,
    repo: target.repo,
    branch: target.branch ?? "main",
    dataPath: target.dataPath ?? "dashboard_data.json",
    indexPath: target.indexPath ?? "index.html",
  };
}

function countRows(data: DashboardData): number {
  return Object.values(data).reduce((sum, rows) => sum + rows.length, 0);
}

function defaultCommitMessage(data: DashboardData): string {
  const months = Object.keys(data);
  const latest = months[months.length - 1] ?? "-";
  return `data: update dashboard data (${months.length} months, latest ${latest})`;
}

/**
 * สร้าง commit เดียวที่แก้ 2 ไฟล์ ด้วย Git Data API
 * (ถ้าใช้ contents API จะได้ 2 commit = Netlify build 2 รอบ)
 */
async function commitFiles(
  client: GithubClient,
  target: Required<DashboardRepoTarget>,
  files: { path: string; content: string }[],
  message: string,
): Promise<string> {
  const base = `/repos/${target.owner}/${target.repo}`;

  const ref = await client.get<{ object: { sha: string } }>(
    `${base}/git/ref/heads/${target.branch}`,
  );
  const parentSha = ref.object.sha;

  const parent = await client.get<{ tree: { sha: string } }>(
    `${base}/git/commits/${parentSha}`,
  );

  const blobs = await Promise.all(
    files.map(async (file) => {
      const blob = await client.post<{ sha: string }>(`${base}/git/blobs`, {
        content: toBase64(file.content),
        encoding: "base64",
      });
      return { path: file.path, mode: "100644", type: "blob", sha: blob.sha };
    }),
  );

  const tree = await client.post<{ sha: string }>(`${base}/git/trees`, {
    base_tree: parent.tree.sha,
    tree: blobs,
  });

  const commit = await client.post<{ sha: string }>(`${base}/git/commits`, {
    message,
    tree: tree.sha,
    parents: [parentSha],
  });

  await client.patch(`${base}/git/refs/heads/${target.branch}`, {
    sha: commit.sha,
  });

  return commit.sha;
}

/**
 * ส่งข้อมูลขึ้น Dashboard — คืน record สำหรับบันทึก `sync_logs` เสมอ (ไม่ throw)
 *
 * - `ok`   = commit แล้ว (Netlify จะ deploy ต่อเอง ~30 วินาที)
 * - `skip` = ข้อมูลเหมือนเดิมทั้ง 2 ไฟล์ ไม่ commit (นับว่าสำเร็จ · ไม่ทำให้ Netlify build ใหม่)
 * - `fail` = ล้มเหลว ดูข้อความใน `error` (เช่น token ใช้ไม่ได้ / GitHub ขัดข้อง)
 */
export async function syncDashboardData(
  data: DashboardData,
  options: SyncOptions,
): Promise<SyncLogRecord> {
  const now = options.now ?? (() => Date.now());
  const started = now();
  const months = Object.keys(data).length;
  const rows = countRows(data);
  const base: Omit<SyncLogRecord, "result" | "message"> = {
    files: [],
    months,
    rows,
    durationMs: 0,
  };
  const finish = (
    record: Omit<SyncLogRecord, "durationMs" | "months" | "rows">,
  ): SyncLogRecord => ({ ...base, ...record, durationMs: now() - started });

  try {
    assertValidDashboardData(data);

    const target = withDefaults(options.target);
    const client = createClient(options.token, options.fetchImpl ?? fetch);
    const json = serializeDashboardData(data);

    const [remoteData, remoteIndex] = await Promise.all([
      readFile(client, target, target.dataPath),
      readFile(client, target, target.indexPath),
    ]);

    if (remoteIndex === null) {
      throw new Error(
        `ไม่พบไฟล์ ${target.indexPath} บน repo ${target.owner}/${target.repo} — ต้องให้ผู้ดูแลตรวจก่อนส่ง`,
      );
    }

    const dataSame = isSameJsonContent(remoteData, json);
    const indexSame = isSameJsonContent(extractIndexData(remoteIndex), json);

    if (dataSame && indexSame) {
      return finish({
        result: "skip",
        files: [],
        message: "ข้อมูลเหมือนรอบก่อน ไม่ commit (ไม่ทำให้ Netlify build ใหม่)",
      });
    }

    const newIndex = replaceIndexData(remoteIndex, json);
    const files = [
      { path: target.dataPath, content: json },
      { path: target.indexPath, content: newIndex },
    ];

    const commitSha = await commitFiles(
      client,
      target,
      files,
      options.commitMessage ?? defaultCommitMessage(data),
    );

    return finish({
      result: "ok",
      files: files.map((f) => f.path),
      commitSha,
      message: `commit ${commitSha.slice(0, 7)} · ${months} เดือน × ${rows / (months || 1)} สาขา`,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return finish({
      result: "fail",
      files: [],
      message: "ส่งไม่สำเร็จ",
      error: detail,
    });
  }
}
