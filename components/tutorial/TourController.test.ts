/**
 * เทส TourController: ข้ามขั้นที่หาจุดไม่เจอ · ต่อบทเรียน · complete/skip เรียกครั้งเดียว · โหมดฝึกไม่เรียกอะไรออกนอก
 */
import { describe, expect, it, vi } from "vitest";

import { LESSONS } from "./lessons";
import { TourController, type FinishKind } from "./TourController";
import { passwordGuardError } from "./tour-logic";

function make(positionLesson: string | null = "recorder", pw = { password: "", confirm: "" }) {
  const onFinish = vi.fn<(kind: FinishKind) => void>();
  const controller = new TourController({
    positionLessonId: () => positionLesson,
    onFinish,
    checkGuard: (step) => (step.guard === "pw" ? passwordGuardError(pw.password, pw.confirm) : null),
  });
  return { controller, onFinish, pw };
}

/** เดินด้วยปุ่ม “ถัดไป” จนจบ (ผ่าน guard ด้วยรหัสตัวอย่างที่ถูกต้อง) */
function finishAll(controller: TourController, pw: { password: string; confirm: string }) {
  pw.password = "Bait2026ok";
  pw.confirm = "Bait2026ok";
  let guard = 0;
  while (controller.getSnapshot().running && guard++ < 100) controller.next();
}

describe("เดินบทเรียน", () => {
  it("start → ขั้นแรก · ถัดไป/ย้อน ขยับทีละขั้น · ย้อนที่ขั้นแรกไม่ทำอะไร", () => {
    const { controller } = make();
    expect(controller.start("recorder")).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ running: true, lessonId: "recorder", index: 0 });
    controller.back();
    expect(controller.getSnapshot().index).toBe(0);
    controller.next();
    controller.next();
    expect(controller.getSnapshot().index).toBe(2);
    controller.back();
    expect(controller.getSnapshot().index).toBe(1);
  });

  it("รหัสบทเรียนที่ไม่มี → เริ่มไม่ได้", () => {
    const { controller } = make();
    expect(controller.start("nope")).toBe(false);
    expect(controller.getSnapshot().running).toBe(false);
  });

  it("บอกข้อมูลขั้นปัจจุบัน", () => {
    const { controller } = make();
    controller.start("admin");
    expect(controller.step?.target).toBe("nav-new");
    expect(controller.lesson?.id).toBe("admin");
  });
});

describe("ข้ามขั้นที่หาจุดไม่เจอ", () => {
  it("เดินหน้า: ขั้น 1 หาไม่เจอ → ไปขั้น 2 เงียบๆ", () => {
    const { controller, onFinish } = make();
    controller.start("recorder");
    controller.reportMissing();
    expect(controller.getSnapshot().index).toBe(1);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("หลายขั้นติดกันหาไม่เจอ → ข้ามต่อเนื่อง ไม่ค้าง", () => {
    const { controller } = make();
    controller.start("recorder");
    controller.next(); // 1
    controller.next(); // 2 = svc-allok
    controller.reportMissing(); // 3 svc-termite
    controller.reportMissing(); // 4 svc-ag
    controller.reportMissing(); // 5 bait-add
    expect(controller.getSnapshot().index).toBe(5);
  });

  it("ขั้นสุดท้ายหาไม่เจอ → จบบทเรียน (done) ไม่ค้าง", () => {
    const { controller, onFinish } = make();
    controller.start("recorder");
    const last = LESSONS.recorder.steps.length - 1;
    for (let i = 0; i < last; i++) controller.next();
    expect(controller.getSnapshot().index).toBe(last);
    controller.reportMissing();
    expect(controller.getSnapshot().running).toBe(false);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith("done");
  });

  it("ทุกขั้นที่เหลือหาไม่เจอ → จบ (done) ไม่วนไม่ค้าง", () => {
    const { controller, onFinish } = make();
    controller.start("pmom");
    for (let i = 0; i < 20 && controller.getSnapshot().running; i++) controller.reportMissing();
    expect(controller.getSnapshot().running).toBe(false);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("ย้อนกลับ: ขั้นก่อนหน้าที่เคยรู้ว่าหาไม่เจอ ถูกข้ามตอนกดย้อน", () => {
    const { controller } = make();
    controller.start("recorder");
    controller.next(); // 1
    controller.next(); // 2
    controller.reportMissing(); // 2 missing → 3
    controller.reportMissing(); // 3 missing → 4
    expect(controller.getSnapshot().index).toBe(4);
    controller.back(); // 3 missing → ข้ามไป 1
    expect(controller.getSnapshot()).toMatchObject({ index: 1, dir: -1 });
  });

  it("ย้อนจนสุดแล้วขั้นต้นๆ หาไม่เจอ → เดินหน้าไปขั้นแรกที่แสดงได้ (ไม่ค้าง ไม่ติดลบ)", () => {
    const { controller } = make();
    controller.start("recorder");
    controller.reportMissing(); // 0 missing → 1
    controller.back(); // ย้อนไป 0 ซึ่งหาไม่เจอ → ต้องเด้งกลับมาขั้น 1
    expect(controller.getSnapshot().index).toBe(1);
  });
});

describe("ต่อบทเรียนส่วนกลาง → บทเรียนของตำแหน่ง", () => {
  it("จบบทส่วนกลางแล้วเข้าบทของตำแหน่ง โดยยังไม่ถือว่าจบ (ไม่เรียก onFinish)", () => {
    const { controller, onFinish, pw } = make("recorder");
    controller.start("central");
    pw.password = pw.confirm = "Bait2026ok";
    for (let i = 0; i < LESSONS.central.steps.length; i++) controller.next();
    expect(controller.getSnapshot()).toMatchObject({ running: true, lessonId: "recorder", index: 0 });
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("ผู้ใช้ไม่มีบทเรียนตำแหน่ง (viewer) → จบที่บทส่วนกลาง", () => {
    const { controller, onFinish, pw } = make(null);
    controller.start("central");
    finishAll(controller, pw);
    expect(controller.getSnapshot().running).toBe(false);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith("done");
  });

  it("ขั้น guard รหัสผ่าน: รหัสไม่ผ่าน → ไม่ไปต่อ + มีข้อความ · ผ่านแล้วไปต่อ", () => {
    const { controller, pw } = make("admin");
    controller.start("central");
    for (let i = 0; i < 5; i++) controller.next(); // ถึงขั้น chpw-save (index 5)
    expect(controller.step?.guard).toBe("pw");
    controller.next();
    expect(controller.getSnapshot().index).toBe(5);
    expect(controller.getSnapshot().guardError).toContain("ยังไม่ผ่านเงื่อนไข");
    pw.password = pw.confirm = "Bait2026ok";
    controller.next();
    expect(controller.getSnapshot()).toMatchObject({ index: 6, guardError: null });
  });
});

describe("complete / skip เรียกครั้งเดียว", () => {
  it("ดูจนจบ → onFinish('done') ครั้งเดียว · กดซ้ำหลังจบไม่เรียกอีก", () => {
    const { controller, onFinish, pw } = make("pmom");
    controller.start("central");
    finishAll(controller, pw);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith("done");
    controller.next();
    controller.skipAll();
    controller.reportMissing();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("กดข้ามกลางทาง → onFinish('skip') ครั้งเดียว · กดข้ามรัวๆ ไม่เรียกซ้ำ", () => {
    const { controller, onFinish } = make("admin");
    controller.start("central");
    controller.next();
    controller.skipAll();
    controller.skipAll();
    controller.skipAll();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith("skip");
    expect(controller.getSnapshot().running).toBe(false);
  });

  it("ไม่ได้เริ่มบทเรียน → skipAll ไม่เรียกอะไร", () => {
    const { controller, onFinish } = make();
    controller.skipAll();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("เปิดดูซ้ำ (รอบใหม่) → นับเป็นรอบใหม่ เรียก onFinish ได้อีก 1 ครั้งของรอบนั้น", () => {
    const { controller, onFinish } = make("admin");
    controller.start("admin");
    controller.skipAll();
    controller.start("admin");
    controller.skipAll();
    expect(onFinish).toHaveBeenCalledTimes(2);
  });
});

describe("โหมดฝึกไม่เรียก API", () => {
  it("เดินครบทุกบทเรียนทุกแบบ (ถัดไป/ย้อน/ข้ามขั้น/ข้ามทั้งหมด) — ช่องทางออกนอกมีแค่ onFinish เท่านั้น", () => {
    const calls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      calls.push("fetch");
      return Promise.reject(new Error("ห้ามเรียกเครือข่ายในโหมดฝึก"));
    });
    try {
      for (const id of ["central", "admin", "recorder", "pmom"] as const) {
        const { controller, onFinish, pw } = make("pmom");
        pw.password = pw.confirm = "Bait2026ok";
        controller.start(id);
        controller.next();
        controller.back();
        controller.reportMissing();
        controller.next();
        controller.skipAll();
        expect(onFinish).toHaveBeenCalledTimes(1);
        controller.start(id);
        for (let i = 0; i < 30; i++) controller.next();
      }
      expect(calls).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
