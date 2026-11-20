/**
 * ตัวควบคุม "กล่องยืนยันก่อนส่งข้อมูลขึ้น Dashboard" (pure — ไม่ผูกกับ React/DOM จึงเทสได้ตรงๆ)
 *
 * Logic summary:
 *   * 3 สถานะ: idle (ปิด) → confirming (กล่องเปิด รอผู้ใช้ตัดสิน) → running (กำลังส่ง) → idle
 *   * ส่งจริง (`run`) ได้ก็ต่อเมื่ออยู่ใน confirming เท่านั้น → ไม่ยืนยัน (ยกเลิก/Esc) = ไม่ส่ง
 *   * confirm() เปลี่ยนเป็น running แบบ synchronous ก่อนเรียก run → กดซ้ำรัวๆ ก่อน React re-render ก็ไม่ส่งซ้ำ
 *   * ระหว่าง running ยกเลิกไม่ได้ (คำขอส่งออกไปแล้ว ถอนไม่ได้) · จบแล้วกลับ idle เสมอ แม้ run จะ throw
 *   * isConfirmPhraseOk: คำยืนยันที่ต้องพิมพ์ (เช่น OCT.26) ตรวจแบบเดียวกับหน้าปิดเดือน
 *     (ไม่สนตัวพิมพ์เล็ก/ใหญ่ และช่องว่างหัวท้าย — ดู isConfirmKeyValid ใน components/months/monthsLogic.ts)
 */

export type ConfirmPhase = "idle" | "confirming" | "running";

export interface ConfirmFlow {
  readonly phase: ConfirmPhase;
  /** เปิดกล่องยืนยัน (ไม่ส่งอะไร) */
  request(): void;
  /** ปิดกล่องโดยไม่ส่ง · ทำได้เฉพาะตอนรอยืนยัน */
  cancel(): void;
  /** ยืนยันส่ง · คืน true ถ้าสั่ง run จริง, false ถ้าถูกกัน (ไม่ได้อยู่ในขั้นรอยืนยัน) */
  confirm(): Promise<boolean>;
}

export function createConfirmFlow(run: () => Promise<void>, onPhase?: (phase: ConfirmPhase) => void): ConfirmFlow {
  let phase: ConfirmPhase = "idle";
  const set = (next: ConfirmPhase) => {
    phase = next;
    onPhase?.(next);
  };
  return {
    get phase() {
      return phase;
    },
    request() {
      if (phase === "idle") set("confirming");
    },
    cancel() {
      if (phase === "confirming") set("idle");
    },
    async confirm() {
      if (phase !== "confirming") return false;
      set("running");
      try {
        await run();
      } finally {
        set("idle");
      }
      return true;
    },
  };
}

/** พิมพ์คำยืนยันตรงหรือไม่ (ไม่สนตัวพิมพ์เล็ก/ใหญ่ และช่องว่างหัวท้าย) */
export function isConfirmPhraseOk(typed: string, phrase: string): boolean {
  return typed.trim().toUpperCase() === phrase.trim().toUpperCase();
}
