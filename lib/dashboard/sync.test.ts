import { describe, it, expect } from "vitest";
import type { SnapshotRow } from "../rules/types";
import { buildDashboardData } from "./buildDashboardData";
import {
  extractIndexData,
  isSameJsonContent,
  replaceIndexData,
  serializeDashboardData,
  syncDashboardData,
} from "./sync";
import type { DashboardData } from "./types";

const TOKEN = "ghp_fake_token_for_test";

const sample = (value: number): SnapshotRow => ({
  area: "เขต 1", branch: "พุทธมณฑล",
  s1: 1, s3: 0, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
  cust: 1, vS: value, vM: 0, vL: 0, vXL: 0, value, value_annual: value,
});

/** ไฟล์ Dashboard ที่ถูกต้องครบ 43 สาขา (สร้างจากตัวประกอบไฟล์จริง) */
function makeData(value: number): DashboardData {
  return buildDashboardData({ computed: { "2026-10": [sample(value)] } });
}

/** โครง index.html ของ Dashboard จริง: ฝังข้อมูลไว้ในบรรทัด `const DATA = …;` */
function makeIndexHtml(json: string): string {
  return [
    "<!doctype html>",
    "<html><body><div id=app></div>",
    "<script>",
    `const DATA = ${json};`,
    "const MONTHS = Object.keys(DATA);",
    "</script></body></html>",
  ].join("\n");
}

interface FakeCall {
  method: string;
  path: string;
  body?: unknown;
}

interface FakeRepo {
  /** path → เนื้อไฟล์ (ไม่มี key = ไฟล์ไม่มีบน repo → 404) */
  files: Record<string, string>;
  /** บังคับให้ request ที่ path ขึ้นต้นด้วย key นี้ ตอบ error */
  fail?: { pathIncludes: string; status: number; message: string };
}

/** fetch จำลองของ GitHub API — ไม่ยิงเน็ตจริง (ห้ามยิง GitHub จริงในเทส) */
function makeFetch(repo: FakeRepo) {
  const calls: FakeCall[] = [];

  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.replace("https://api.github.com", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });

    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status });

    if (repo.fail && path.includes(repo.fail.pathIncludes)) {
      return json({ message: repo.fail.message }, repo.fail.status);
    }

    if (path.startsWith("/repos/o/r/contents/")) {
      const file = decodeURIComponent(path.slice("/repos/o/r/contents/".length).split("?")[0] ?? "");
      const content = repo.files[file];
      if (content === undefined) return json({ message: "Not Found" }, 404);
      return json({
        content: Buffer.from(content, "utf8").toString("base64"),
        encoding: "base64",
      });
    }
    if (path === "/repos/o/r/git/ref/heads/main") {
      return json({ object: { sha: "parentsha" } });
    }
    if (path === "/repos/o/r/git/commits/parentsha") {
      return json({ tree: { sha: "basetree" } });
    }
    if (path === "/repos/o/r/git/blobs") {
      return json({ sha: `blob${calls.length}` });
    }
    if (path === "/repos/o/r/git/trees") {
      return json({ sha: "newtree" });
    }
    if (path === "/repos/o/r/git/commits") {
      return json({ sha: "abc1234def5678" });
    }
    if (path === "/repos/o/r/git/refs/heads/main") {
      return json({ ref: "refs/heads/main" });
    }
    return json({ message: `unexpected ${method} ${path}` }, 500);
  };

  return { fetchImpl: impl as unknown as typeof fetch, calls };
}

const target = { owner: "o", repo: "r" };

describe("ตัวช่วยแปลง/เทียบข้อมูล", () => {
  it("serializeDashboardData เขียน JSON แบบไม่มีช่องว่าง (เหมือนไฟล์เดิมบน repo)", () => {
    const json = serializeDashboardData(makeData(100));
    expect(json.startsWith('{"OCT.26":[{"area"')).toBe(true);
    expect(json).not.toContain("\n");
  });

  it("extractIndexData ดึง JSON ออกจากบรรทัด const DATA ได้", () => {
    const json = serializeDashboardData(makeData(100));
    expect(extractIndexData(makeIndexHtml(json))).toBe(json);
  });

  it("extractIndexData คืน null เมื่อไม่มีบรรทัด const DATA", () => {
    expect(extractIndexData("<html></html>")).toBeNull();
  });

  it("replaceIndexData เปลี่ยนเฉพาะบรรทัดข้อมูล ส่วนอื่นของหน้าคงเดิม", () => {
    const oldJson = serializeDashboardData(makeData(100));
    const newJson = serializeDashboardData(makeData(200));
    const html = replaceIndexData(makeIndexHtml(oldJson), newJson);
    expect(extractIndexData(html)).toBe(newJson);
    expect(html).toContain("const MONTHS = Object.keys(DATA);");
    expect(html.split("\n")).toHaveLength(6);
  });

  it("replaceIndexData throw เมื่อหาบรรทัด const DATA ไม่เจอ", () => {
    expect(() => replaceIndexData("<html></html>", "{}")).toThrow(/const DATA/);
  });

  it("isSameJsonContent ไม่สนรูปแบบการเขียนตัวเลข (6744617.0 = 6744617)", () => {
    expect(isSameJsonContent('{"a":6744617.0}', '{"a":6744617}')).toBe(true);
    expect(isSameJsonContent('{"a":1}', '{"a":2}')).toBe(false);
    expect(isSameJsonContent("ไม่ใช่ JSON", "{}")).toBe(false);
    expect(isSameJsonContent(null, "{}")).toBe(false);
  });
});

describe("syncDashboardData — ส่งขึ้น repo Dashboard (SPEC §9.2)", () => {
  it("ข้อมูลเหมือนเดิมทั้ง 2 ไฟล์ = ข้าม ไม่ commit", async () => {
    const data = makeData(100);
    const json = serializeDashboardData(data);
    const { fetchImpl, calls } = makeFetch({
      files: { "dashboard_data.json": json, "index.html": makeIndexHtml(json) },
    });

    const log = await syncDashboardData(data, { target, token: TOKEN, fetchImpl });

    expect(log.result).toBe("skip");
    expect(log.files).toEqual([]);
    expect(log.commitSha).toBeUndefined();
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("ไฟล์เดิมเขียนเลขเป็น 6744617.0 ก็ยังนับว่าเหมือนเดิม (ไม่ commit ซ้ำทุกวัน)", async () => {
    const data = makeData(6744617);
    const json = serializeDashboardData(data);
    const loose = json.replace('"value":6744617', '"value":6744617.0');
    expect(loose).not.toBe(json);
    const { fetchImpl } = makeFetch({
      files: { "dashboard_data.json": loose, "index.html": makeIndexHtml(loose) },
    });

    const log = await syncDashboardData(data, { target, token: TOKEN, fetchImpl });
    expect(log.result).toBe("skip");
  });

  it("ข้อมูลต่าง = commit เดียวแก้ทั้ง 2 ไฟล์ แล้วคืน sha", async () => {
    const oldJson = serializeDashboardData(makeData(100));
    const { fetchImpl, calls } = makeFetch({
      files: {
        "dashboard_data.json": oldJson,
        "index.html": makeIndexHtml(oldJson),
      },
    });

    const log = await syncDashboardData(makeData(200), {
      target,
      token: TOKEN,
      fetchImpl,
    });

    expect(log.result).toBe("ok");
    expect(log.commitSha).toBe("abc1234def5678");
    expect(log.files).toEqual(["dashboard_data.json", "index.html"]);
    expect(log.months).toBe(1);
    expect(log.rows).toBe(43);

    const blobPosts = calls.filter((c) => c.path === "/repos/o/r/git/blobs");
    const commitPosts = calls.filter(
      (c) => c.method === "POST" && c.path === "/repos/o/r/git/commits",
    );
    expect(blobPosts).toHaveLength(2); // 2 ไฟล์
    expect(commitPosts).toHaveLength(1); // commit เดียว → Netlify build รอบเดียว
    expect(
      calls.some((c) => c.method === "PATCH" && c.path === "/repos/o/r/git/refs/heads/main"),
    ).toBe(true);
  });

  it("ส่ง index.html ที่แทนข้อมูลใหม่แล้ว ไม่ใช่ไฟล์เดิม", async () => {
    const oldJson = serializeDashboardData(makeData(100));
    const newData = makeData(200);
    const { fetchImpl, calls } = makeFetch({
      files: {
        "dashboard_data.json": oldJson,
        "index.html": makeIndexHtml(oldJson),
      },
    });

    await syncDashboardData(newData, { target, token: TOKEN, fetchImpl });

    const blobs = calls.filter((c) => c.path === "/repos/o/r/git/blobs");
    const contents = blobs.map((c) =>
      Buffer.from(String((c.body as { content: string }).content), "base64").toString("utf8"),
    );
    const indexBlob = contents.find((c) => c.includes("<!doctype html>"));
    expect(extractIndexData(indexBlob ?? "")).toBe(serializeDashboardData(newData));
  });

  it("index.html ตรงแต่ไฟล์ .json ไม่ตรง = ยัง commit (ให้ 2 ไฟล์กลับมาตรงกัน)", async () => {
    const data = makeData(100);
    const json = serializeDashboardData(data);
    const { fetchImpl } = makeFetch({
      files: {
        "dashboard_data.json": serializeDashboardData(makeData(999)),
        "index.html": makeIndexHtml(json),
      },
    });

    const log = await syncDashboardData(data, { target, token: TOKEN, fetchImpl });
    expect(log.result).toBe("ok");
  });

  it("ไม่มีไฟล์ .json บน repo = ยัง commit ได้ (สร้างไฟล์ใหม่)", async () => {
    const json = serializeDashboardData(makeData(100));
    const { fetchImpl } = makeFetch({ files: { "index.html": makeIndexHtml(json) } });

    const log = await syncDashboardData(makeData(100), {
      target,
      token: TOKEN,
      fetchImpl,
    });
    expect(log.result).toBe("ok");
  });

  it("GitHub ตอบ 401 = ล้มเหลว พร้อมข้อความบอกสาเหตุ", async () => {
    const json = serializeDashboardData(makeData(100));
    const { fetchImpl } = makeFetch({
      files: { "dashboard_data.json": json, "index.html": makeIndexHtml(json) },
      fail: { pathIncludes: "/contents/", status: 401, message: "Bad credentials" },
    });

    const log = await syncDashboardData(makeData(200), {
      target,
      token: TOKEN,
      fetchImpl,
    });

    expect(log.result).toBe("fail");
    expect(log.error).toContain("401");
    expect(log.error).toContain("Bad credentials");
    expect(log.files).toEqual([]);
  });

  it("GitHub ตอบ 502 ตอน commit = ล้มเหลว", async () => {
    const oldJson = serializeDashboardData(makeData(100));
    const { fetchImpl } = makeFetch({
      files: {
        "dashboard_data.json": oldJson,
        "index.html": makeIndexHtml(oldJson),
      },
      fail: { pathIncludes: "/git/", status: 502, message: "Bad gateway" },
    });

    const log = await syncDashboardData(makeData(200), {
      target,
      token: TOKEN,
      fetchImpl,
    });

    expect(log.result).toBe("fail");
    expect(log.error).toContain("502");
  });

  it("ข้อความ error ต้องไม่มี token หลุดออกมา", async () => {
    const json = serializeDashboardData(makeData(100));
    const { fetchImpl } = makeFetch({
      files: { "dashboard_data.json": json, "index.html": makeIndexHtml(json) },
      fail: { pathIncludes: "/contents/", status: 401, message: "Bad credentials" },
    });

    const log = await syncDashboardData(makeData(200), {
      target,
      token: TOKEN,
      fetchImpl,
    });
    expect(JSON.stringify(log)).not.toContain(TOKEN);
  });

  it("เน็ตล่ม (fetch throw) = ล้มเหลว ไม่โยน error ออกมา", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const log = await syncDashboardData(makeData(100), {
      target,
      token: TOKEN,
      fetchImpl,
    });
    expect(log.result).toBe("fail");
    expect(log.error).toContain("network down");
  });

  it("index.html ไม่มีบรรทัด const DATA = ล้มเหลว ไม่เขียนทับ", async () => {
    const { fetchImpl, calls } = makeFetch({
      files: { "index.html": "<html>หน้าใหม่ไม่มี DATA</html>" },
    });

    const log = await syncDashboardData(makeData(100), {
      target,
      token: TOKEN,
      fetchImpl,
    });

    expect(log.result).toBe("fail");
    expect(log.error).toMatch(/const DATA/);
    expect(calls.some((c) => c.method !== "GET")).toBe(false);
  });

  it("ไม่มี index.html บน repo = ล้มเหลว (ต้องให้คนตรวจก่อน)", async () => {
    const { fetchImpl } = makeFetch({ files: {} });
    const log = await syncDashboardData(makeData(100), {
      target,
      token: TOKEN,
      fetchImpl,
    });
    expect(log.result).toBe("fail");
    expect(log.error).toMatch(/index\.html/);
  });

  it("ข้อมูลผิดรูปแบบ (ไม่ครบ 43 สาขา) = ล้มเหลวตั้งแต่ก่อนเรียก GitHub", async () => {
    const { fetchImpl, calls } = makeFetch({ files: {} });
    const broken: DashboardData = { "OCT.26": [] };

    const log = await syncDashboardData(broken, { target, token: TOKEN, fetchImpl });

    expect(log.result).toBe("fail");
    expect(log.error).toMatch(/43/);
    expect(calls).toHaveLength(0);
  });

  it("ใช้ข้อความ commit ที่ส่งมาได้", async () => {
    const oldJson = serializeDashboardData(makeData(100));
    const { fetchImpl, calls } = makeFetch({
      files: {
        "dashboard_data.json": oldJson,
        "index.html": makeIndexHtml(oldJson),
      },
    });

    await syncDashboardData(makeData(200), {
      target,
      token: TOKEN,
      fetchImpl,
      commitMessage: "data: OCT.26 close province",
    });

    const commit = calls.find(
      (c) => c.method === "POST" && c.path === "/repos/o/r/git/commits",
    );
    expect((commit?.body as { message: string }).message).toBe(
      "data: OCT.26 close province",
    );
  });

  it("บันทึกเวลาที่ใช้ลง record (ไว้แสดงในหน้าประวัติการส่ง)", async () => {
    const json = serializeDashboardData(makeData(100));
    const { fetchImpl } = makeFetch({
      files: { "dashboard_data.json": json, "index.html": makeIndexHtml(json) },
    });
    let t = 1000;
    const log = await syncDashboardData(makeData(100), {
      target,
      token: TOKEN,
      fetchImpl,
      now: () => (t += 500),
    });
    expect(log.durationMs).toBe(500);
  });
});
