/**
 * TourController — เครื่องสถานะของบทเรียน (ไม่มี React/DOM/เครือข่าย)
 *
 * หน้าที่: จำว่าอยู่บทเรียนไหน ขั้นไหน · ถัดไป/ย้อน/ข้าม · ข้ามขั้นที่หาจุดชี้ไม่เจอ ·
 * ต่อบทเรียนส่วนกลาง → บทเรียนของตำแหน่ง · แจ้งตอนจบ **ครั้งเดียวต่อ 1 รอบ** ผ่าน `onFinish`
 *
 * โหมดฝึก: ตัวนี้ไม่มีทางเรียกระบบจริงเอง — มีช่องทางเดียวที่ออกไปข้างนอกคือ `onFinish("done" | "skip")`
 * (ผู้ใช้โค้ดนี้ผูกกับ RPC complete_onboarding / skip_onboarding) ปุ่มบันทึกในบทเรียนจึงเป็นของหลอกเสมอ
 */
import { getLesson, type Lesson, type LessonStep } from "./lessons";

export type FinishKind = "done" | "skip";

export type TourSnapshot = {
  running: boolean;
  lessonId: string | null;
  index: number;
  /** ทิศที่กำลังเดิน: 1 = ไปหน้า · -1 = ย้อนกลับ */
  dir: 1 | -1;
  /** ข้อความผิดพลาดของ guard (เช่น รหัสผ่านยังไม่ผ่าน) */
  guardError: string | null;
};

export type TourDeps = {
  /** บทเรียนของตำแหน่งผู้ใช้ (ใช้ตอนต่อจากบทส่วนกลาง) · null = ไม่มี */
  positionLessonId: () => string | null;
  /** เรียกครั้งเดียวต่อรอบ ตอนจบจริง (ดูจบ / กดข้าม) */
  onFinish: (kind: FinishKind) => void;
  /** ตรวจเงื่อนไขของขั้นที่มี `guard` · คืนข้อความผิดพลาด หรือ null ถ้าผ่าน */
  checkGuard?: (step: LessonStep) => string | null;
};

const IDLE: TourSnapshot = {
  running: false,
  lessonId: null,
  index: 0,
  dir: 1,
  guardError: null,
};

export class TourController {
  private snap: TourSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  /** ขั้นที่หาจุดชี้ไม่เจอ (`lessonId:index`) — ล้างทุกครั้งที่เริ่มรอบใหม่ */
  private missing = new Set<string>();
  private finished = false;

  constructor(private readonly deps: TourDeps) {}

  /* ---------- สำหรับ React (useSyncExternalStore) ---------- */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TourSnapshot => this.snap;

  private set(next: Partial<TourSnapshot>) {
    this.snap = { ...this.snap, ...next };
    this.listeners.forEach((l) => l());
  }

  /* ---------- ข้อมูลปัจจุบัน ---------- */

  get lesson(): Lesson | undefined {
    return this.snap.lessonId ? getLesson(this.snap.lessonId) : undefined;
  }

  get step(): LessonStep | undefined {
    return this.snap.running ? this.lesson?.steps[this.snap.index] : undefined;
  }

  /* ---------- คำสั่ง ---------- */

  /** เริ่มรอบใหม่ (เปิดอัตโนมัติ / ผู้ใช้กดปุ่ม “สอนใช้งาน”) */
  start(lessonId: string): boolean {
    if (!getLesson(lessonId)) return false;
    this.missing = new Set();
    this.finished = false;
    this.set({ running: true, lessonId, index: 0, dir: 1, guardError: null });
    return true;
  }

  next(): void {
    const step = this.step;
    if (!step || !this.lesson) return;
    if (step.guard && this.deps.checkGuard) {
      const err = this.deps.checkGuard(step);
      if (err) {
        this.set({ guardError: err });
        return;
      }
    }
    this.goTo(this.snap.index + 1, 1);
  }

  back(): void {
    if (!this.snap.running || this.snap.index <= 0) return;
    this.goTo(this.snap.index - 1, -1);
  }

  /** ข้ามทั้งหมด (ปุ่ม/Esc) */
  skipAll(): void {
    if (!this.snap.running) return;
    this.finish("skip");
  }

  /** ตัวแสดงรายงานว่าขั้นปัจจุบันหาจุดชี้ไม่เจอ → ข้ามไปขั้นถัดไปตามทิศที่เดินอยู่ */
  reportMissing(): void {
    const { running, lessonId, index, dir } = this.snap;
    if (!running || !lessonId) return;
    this.missing.add(`${lessonId}:${index}`);
    if (dir === 1) {
      this.goTo(index + 1, 1);
    } else if (index - 1 >= 0) {
      this.goTo(index - 1, -1);
    } else {
      // ย้อนจนสุดแล้วยังไม่มีขั้นที่แสดงได้ → เดินหน้าหาขั้นแรกที่แสดงได้
      this.goTo(index + 1, 1);
    }
  }

  /* ---------- ภายใน ---------- */

  private goTo(target: number, dir: 1 | -1) {
    const lesson = this.lesson;
    const lessonId = this.snap.lessonId;
    if (!lesson || !lessonId) return;
    let i = target;
    // ข้ามขั้นที่เคยรู้แล้วว่าหาจุดไม่เจอ ไม่ต้องรอซ้ำ
    while (i >= 0 && i < lesson.steps.length && this.missing.has(`${lessonId}:${i}`)) i += dir;
    if (i >= lesson.steps.length) {
      this.finish("done");
      return;
    }
    if (i < 0) {
      // ย้อนจนสุด: เดินหน้าหาขั้นแรกที่ยังแสดงได้
      i = 0;
      dir = 1;
      while (i < lesson.steps.length && this.missing.has(`${lessonId}:${i}`)) i += 1;
      if (i >= lesson.steps.length) {
        this.finish("done");
        return;
      }
    }
    this.set({ index: i, dir, guardError: null });
  }

  private finish(kind: FinishKind) {
    const lesson = this.lesson;
    if (kind === "done" && lesson?.next === "@position") {
      const nextId = this.deps.positionLessonId();
      if (nextId && getLesson(nextId)) {
        this.missing = new Set();
        this.set({ lessonId: nextId, index: 0, dir: 1, guardError: null });
        return;
      }
    }
    this.set({ running: false, lessonId: null, index: 0, dir: 1, guardError: null });
    if (this.finished) return;
    this.finished = true;
    this.deps.onFinish(kind);
  }
}
