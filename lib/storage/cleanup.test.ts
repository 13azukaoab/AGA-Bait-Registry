import { describe, expect, it } from "vitest";

import {
  MAX_ATTEMPTS,
  STILL_PRESENT_ERROR,
  STILL_REFERENCED_NOTE,
  runStorageCleanup,
  type CleanupPorts,
  type QueueItem,
} from "./cleanup";

type Call = { op: string; args: unknown[] };

/** ตัวจำลอง Storage + คิว ที่บันทึกทุกการเรียก */
function fakePorts(opts: {
  items: QueueItem[];
  referenced?: string[];
  objects?: string[];
  removeIgnored?: string[]; // remove "สำเร็จ" แต่ object ยังอยู่ (กรณี RLS ปฏิเสธเงียบ)
  removeThrows?: string[];
  referenceThrows?: string[];
}) {
  const calls: Call[] = [];
  const objects = new Set(opts.objects ?? opts.items.map((i) => i.path));
  const ports: CleanupPorts = {
    async fetchPending(limit) {
      calls.push({ op: "fetchPending", args: [limit] });
      return opts.items.slice(0, limit);
    },
    async isReferenced(path) {
      calls.push({ op: "isReferenced", args: [path] });
      if (opts.referenceThrows?.includes(path)) throw new Error("db down");
      return (opts.referenced ?? []).includes(path);
    },
    async removeObject(bucket, path) {
      calls.push({ op: "removeObject", args: [bucket, path] });
      if (opts.removeThrows?.includes(path)) throw new Error("storage error");
      if (!opts.removeIgnored?.includes(path)) objects.delete(path);
    },
    async objectExists(_bucket, path) {
      calls.push({ op: "objectExists", args: [path] });
      return objects.has(path);
    },
    async markDone(id, note) {
      calls.push({ op: "markDone", args: [id, note] });
    },
    async markFailed(id, attempts, error) {
      calls.push({ op: "markFailed", args: [id, attempts, error] });
    },
  };
  return { ports, calls, objects };
}

const item = (id: number, path: string, attempts = 0): QueueItem => ({
  id,
  bucket: "contract-files",
  path,
  attempts,
});

describe("runStorageCleanup", () => {
  it("ลบ object ที่ไม่มีแถวอ้างอิงแล้ว และปิดงาน", async () => {
    const { ports, calls, objects } = fakePorts({ items: [item(1, "c1/a.pdf")] });
    const summary = await runStorageCleanup(ports);
    expect(summary).toEqual({ processed: 1, deleted: 1, skipped: 0, failed: 0 });
    expect(objects.has("c1/a.pdf")).toBe(false);
    expect(calls).toContainEqual({ op: "markDone", args: [1, null] });
  });

  it("ไม่ลบไฟล์ที่ยังมีแถว contract_files ใช้อยู่", async () => {
    const { ports, calls, objects } = fakePorts({
      items: [item(2, "c1/in-use.pdf")],
      referenced: ["c1/in-use.pdf"],
    });
    const summary = await runStorageCleanup(ports);
    expect(summary.skipped).toBe(1);
    expect(objects.has("c1/in-use.pdf")).toBe(true);
    expect(calls.some((c) => c.op === "removeObject")).toBe(false);
    expect(calls).toContainEqual({ op: "markDone", args: [2, STILL_REFERENCED_NOTE] });
  });

  it("remove ไม่ error แต่ object ยังอยู่ → นับเป็นล้ม (Storage ปฏิเสธแบบเงียบ)", async () => {
    const { ports, calls } = fakePorts({
      items: [item(3, "c1/b.pdf", 2)],
      removeIgnored: ["c1/b.pdf"],
    });
    const summary = await runStorageCleanup(ports);
    expect(summary.failed).toBe(1);
    expect(calls).toContainEqual({ op: "markFailed", args: [3, 3, STILL_PRESENT_ERROR] });
    expect(calls.some((c) => c.op === "markDone")).toBe(false);
  });

  it("remove error → นับ attempts + เก็บข้อความ error · รายการอื่นทำต่อ", async () => {
    const { ports, calls } = fakePorts({
      items: [item(4, "c1/bad.pdf"), item(5, "c1/ok.pdf")],
      removeThrows: ["c1/bad.pdf"],
    });
    const summary = await runStorageCleanup(ports);
    expect(summary).toEqual({ processed: 2, deleted: 1, skipped: 0, failed: 1 });
    expect(calls).toContainEqual({ op: "markFailed", args: [4, 1, "storage error"] });
    expect(calls).toContainEqual({ op: "markDone", args: [5, null] });
  });

  it("ตรวจแถวอ้างอิงไม่ได้ → ไม่ลบ (ไม่เดา) และนับเป็นล้ม", async () => {
    const { ports, calls, objects } = fakePorts({
      items: [item(6, "c1/unknown.pdf")],
      referenceThrows: ["c1/unknown.pdf"],
    });
    const summary = await runStorageCleanup(ports);
    expect(summary.failed).toBe(1);
    expect(objects.has("c1/unknown.pdf")).toBe(true);
    expect(calls.some((c) => c.op === "removeObject")).toBe(false);
  });

  it("ส่งขนาดรอบไปให้ fetchPending และคิวว่างไม่ทำอะไร", async () => {
    const { ports, calls } = fakePorts({ items: [] });
    const summary = await runStorageCleanup(ports, 25);
    expect(summary).toEqual({ processed: 0, deleted: 0, skipped: 0, failed: 0 });
    expect(calls).toEqual([{ op: "fetchPending", args: [25] }]);
  });

  it("MAX_ATTEMPTS เป็น 5 ตามแบบที่เจ้าของอนุมัติ", () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });
});

describe("splitObjectPath", () => {
  it("แยกโฟลเดอร์กับชื่อไฟล์", async () => {
    const { splitObjectPath } = await import("./supabasePorts");
    expect(splitObjectPath("c1/sub/a.pdf")).toEqual({ folder: "c1/sub", name: "a.pdf" });
    expect(splitObjectPath("a.pdf")).toEqual({ folder: "", name: "a.pdf" });
  });
});
