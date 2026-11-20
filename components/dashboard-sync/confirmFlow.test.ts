/**
 * เทสตัวควบคุมกล่องยืนยันก่อนส่ง Dashboard (pure — ไม่ต้องมี DOM)
 * ครอบคลุม: ไม่ยืนยัน = ไม่ส่ง · ยืนยัน = ส่ง 1 ครั้ง · กดซ้ำระหว่างส่ง = ไม่ส่งซ้ำ · คำยืนยันผิด = ผ่านไม่ได้
 */
import { describe, expect, it, vi } from "vitest";

import { createConfirmFlow, isConfirmPhraseOk, type ConfirmPhase } from "./confirmFlow";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createConfirmFlow", () => {
  it("เริ่มที่ idle · request() เปิดกล่อง (confirming) แต่ยังไม่ส่ง", () => {
    const run = vi.fn(async () => undefined);
    const flow = createConfirmFlow(run);
    expect(flow.phase).toBe("idle");
    flow.request();
    expect(flow.phase).toBe("confirming");
    expect(run).not.toHaveBeenCalled();
  });

  it("กดยกเลิก (หรือ Esc) = ปิดกล่อง และไม่ยิง request", async () => {
    const run = vi.fn(async () => undefined);
    const flow = createConfirmFlow(run);
    flow.request();
    flow.cancel();
    expect(flow.phase).toBe("idle");
    expect(await flow.confirm()).toBe(false); // ปิดแล้ว confirm ไม่ได้
    expect(run).not.toHaveBeenCalled();
  });

  it("ยังไม่เปิดกล่อง แต่เรียก confirm ตรงๆ = ไม่ส่ง", async () => {
    const run = vi.fn(async () => undefined);
    const flow = createConfirmFlow(run);
    expect(await flow.confirm()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("ยืนยัน = ยิง 1 ครั้ง แล้วกลับ idle", async () => {
    const run = vi.fn(async () => undefined);
    const phases: ConfirmPhase[] = [];
    const flow = createConfirmFlow(run, (p) => phases.push(p));
    flow.request();
    expect(await flow.confirm()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(flow.phase).toBe("idle");
    expect(phases).toEqual(["confirming", "running", "idle"]);
  });

  it("กดยืนยันซ้ำรัวๆ ระหว่างกำลังส่ง = ไม่ยิงซ้ำ (แม้ยังไม่ re-render)", async () => {
    const d = deferred();
    const run = vi.fn(() => d.promise);
    const flow = createConfirmFlow(run);
    flow.request();
    const first = flow.confirm();
    const second = flow.confirm();
    const third = flow.confirm();
    expect(flow.phase).toBe("running");
    expect(await second).toBe(false);
    expect(await third).toBe(false);
    d.resolve();
    expect(await first).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ระหว่างกำลังส่ง: ยกเลิกไม่ได้ และ request ซ้ำไม่เปิดกล่องใหม่", async () => {
    const d = deferred();
    const flow = createConfirmFlow(() => d.promise);
    flow.request();
    const p = flow.confirm();
    flow.cancel();
    flow.request();
    expect(flow.phase).toBe("running");
    d.resolve();
    await p;
    expect(flow.phase).toBe("idle");
  });

  it("ส่งเสร็จแล้วกดปุ่มหลักอีกครั้ง = เปิดกล่องยืนยันใหม่ ไม่ส่งเอง", async () => {
    const run = vi.fn(async () => undefined);
    const flow = createConfirmFlow(run);
    flow.request();
    await flow.confirm();
    flow.request();
    expect(flow.phase).toBe("confirming");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("run ล้มเหลว (throw) ก็กลับ idle ไม่ค้างสถานะกำลังส่ง", async () => {
    const flow = createConfirmFlow(async () => {
      throw new Error("boom");
    });
    flow.request();
    await expect(flow.confirm()).rejects.toThrow("boom");
    expect(flow.phase).toBe("idle");
  });
});

describe("isConfirmPhraseOk", () => {
  it("พิมพ์ตรง (ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย) = ผ่าน", () => {
    expect(isConfirmPhraseOk("OCT.26", "OCT.26")).toBe(true);
    expect(isConfirmPhraseOk("  oct.26 ", "OCT.26")).toBe(true);
  });
  it("พิมพ์ผิด/ว่าง/ไม่ครบ = ไม่ผ่าน", () => {
    expect(isConfirmPhraseOk("", "OCT.26")).toBe(false);
    expect(isConfirmPhraseOk("OCT.25", "OCT.26")).toBe(false);
    expect(isConfirmPhraseOk("OCT", "OCT.26")).toBe(false);
    expect(isConfirmPhraseOk("OCT.26x", "OCT.26")).toBe(false);
  });
});
