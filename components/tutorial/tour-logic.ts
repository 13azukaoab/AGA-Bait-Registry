/**
 * ตรรกะล้วน (pure function) ของบทเรียน — แยกจาก React/DOM เพื่อให้เทสได้
 *
 *  - เงื่อนไขเปิดอัตโนมัติ / เงื่อนไขบันทึกสถานะ (complete / skip)
 *  - ตัดสินว่าการคลิกระหว่างบทเรียนต้องทำอย่างไร (โหมดฝึก: ไม่ให้ปุ่มจริงทำงาน)
 *  - วางตำแหน่งกล่อง (หลบแถบบันทึก `data-sticky-savebar`) และคำนวณการเลื่อนหน้า
 */

/* ---------- สถานะ onboarding ของผู้ใช้ ---------- */

export type OnboardingState = {
  /** `profiles.onboarding_completed_at` (ISO) — null = ยังไม่เคยดูจบ */
  completedAt: string | null;
  /** `profiles.onboarding_skipped_at` (ISO) — null = ยังไม่เคยกดข้าม */
  skippedAt: string | null;
};

/** เปิดบทเรียนอัตโนมัติเมื่อทั้งสองช่องว่าง (ยังไม่เคยเห็น) */
export function shouldAutoOpen(state: OnboardingState | null): boolean {
  return state !== null && state.completedAt === null && state.skippedAt === null;
}

/**
 * ต้องเรียก RPC บันทึกหรือไม่
 *  - ดูจบ: บันทึกถ้ายังไม่เคยดูจบ (ดูจบหลังเคยข้าม = บันทึก เพราะ complete ล้างค่าข้ามให้)
 *  - กดข้าม: บันทึกเฉพาะคนที่ยังไม่มีสถานะสุดท้าย (เปิดดูซ้ำแล้วกดข้าม ไม่ต้องบันทึกซ้ำ)
 */
export function shouldRecord(kind: "done" | "skip", state: OnboardingState | null): boolean {
  if (state === null) return false;
  if (kind === "done") return state.completedAt === null;
  return state.completedAt === null && state.skippedAt === null;
}

/* ---------- รหัสผ่านตัวอย่างในหน้าจำลอง ---------- */

export type PasswordRules = { len: boolean; up: boolean; lo: boolean; num: boolean; same: boolean };

export function evaluatePassword(password: string, confirm: string): PasswordRules {
  return {
    len: password.length >= 8,
    up: /[A-Z]/.test(password),
    lo: /[a-z]/.test(password),
    num: /\d/.test(password),
    same: password.length > 0 && password === confirm,
  };
}

/** ข้อความผิดพลาดของขั้น guard "pw" · null = ผ่าน */
export function passwordGuardError(password: string, confirm: string): string | null {
  const r = evaluatePassword(password, confirm);
  if (!(r.len && r.up && r.lo && r.num)) return "รหัสผ่านยังไม่ผ่านเงื่อนไข ดูข้อที่ยังไม่เป็นสีเขียว";
  if (!r.same) return "รหัสผ่านทั้งสองช่องไม่ตรงกัน";
  return null;
}

/* ---------- ตัวเลือก element ---------- */

export function selectorFor(target: string): string {
  return `[data-tour="${target.replace(/["\\]/g, "")}"]`;
}

/* ---------- การคลิกในโหมดฝึก ---------- */

export type ClickInput = {
  /** คลิกอยู่ในกล่องบทเรียน/หน้าจำลองของบทเรียนเอง */
  insideTutorialUi: boolean;
  /** คลิกอยู่ในจุดที่ไฮไลต์ */
  insideTarget: boolean;
  /** element ที่คลิกเป็นลิงก์ (`<a href>`) หรืออยู่ในลิงก์ */
  isLink: boolean;
  /** ขั้นนี้ให้ผู้ใช้ลองกด (act: "click") */
  stepWantsClick: boolean;
};

/**
 * - `allow`            ปล่อยตามปกติ (ปุ่มของกล่องบทเรียนเอง)
 * - `advance-link`     ลิงก์เมนูที่ขั้นนี้ให้กด → ปล่อยให้พาไปหน้านั้นจริง แล้วไปขั้นถัดไป
 * - `advance-practice` ปุ่มบันทึก/ปุ่มทำงานจริงที่ขั้นนี้ให้ลองกด → **บล็อก** (ไม่ให้ปุ่มจริงทำงาน) แสดงข้อความ “โหมดฝึก” แล้วไปขั้นถัดไป
 * - `block`            อย่างอื่นทั้งหมด → บล็อก + บอกให้กดตามที่ไฮไลต์
 */
export type ClickDecision = "allow" | "advance-link" | "advance-practice" | "block";

export function decideClick(input: ClickInput): ClickDecision {
  if (input.insideTutorialUi) return "allow";
  if (input.stepWantsClick && input.insideTarget) {
    return input.isLink ? "advance-link" : "advance-practice";
  }
  return "block";
}

/**
 * ขั้นนี้ “ให้ลองกด” ได้จริงหรือไม่ — ถ้าปุ่มที่ชี้ถูกปิดอยู่ (disabled เช่นปุ่มบันทึกตอนยังไม่มีแถว) เบราว์เซอร์จะไม่ส่งการคลิก
 * ผู้ใช้กดแล้วไม่เกิดอะไร จึงต้องแสดงเป็นขั้นอ่านธรรมดา (ปุ่ม “ถัดไป” + ซ่อนคำแนะนำให้กด)
 */
export function isClickStep(act: "click" | undefined, targetDisabled: boolean): boolean {
  return act === "click" && !targetDisabled;
}

/* ---------- เรขาคณิต ---------- */

export type Rect = { left: number; top: number; right: number; bottom: number };

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export type Side = "bottom" | "top" | "right" | "left";

export type Placement =
  | { mode: "center" }
  | { mode: "sheet"; bottom: number }
  | { mode: "floating"; side: Side; x: number; y: number; arrowX: number; arrowY: number };

export type PlacementInput = {
  /** null = ไม่ชี้จุด */
  target: Rect | null;
  tip: { w: number; h: number };
  viewport: { w: number; h: number };
  /** จอเล็ก = กล่องเป็นแผ่นติดล่างเต็มความกว้าง */
  small: boolean;
  /** ช่องที่กล่องห้ามบัง (แถบบันทึก `data-sticky-savebar`) */
  avoid: readonly Rect[];
  /** ชี้เมนูซ้าย → ให้กล่องอยู่ด้านขวาของเมนูก่อน */
  preferRight?: boolean;
  /**
   * กรอบที่ใช้คำนวณตำแหน่งกล่องแทน `target` (ไม่ระบุ = ใช้ target) — ใช้กับหน้าจำลอง:
   * ให้กล่องไปอยู่ด้านข้างของการ์ดทั้งใบ ไม่ทับปุ่มข้างเคียงของจุดที่ชี้
   */
  anchor?: Rect;
};

const GAP = 16;
const MARGIN = 8;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/** ระยะจากขอบล่างจอถึงแถบบันทึกที่ติดล่าง (ใช้ยกแผ่นบทเรียนให้อยู่เหนือแถบ) */
export function bottomInsetFromAvoid(avoid: readonly Rect[], viewportH: number): number {
  let top = viewportH;
  for (const r of avoid) {
    if (r.bottom <= 0 || r.top >= viewportH) continue; // ไม่อยู่ในจอ
    if (r.top > viewportH * 0.4) top = Math.min(top, r.top); // แถบที่ติดล่าง
  }
  return viewportH - top;
}

export function computePlacement(input: PlacementInput): Placement {
  const { target, tip, viewport, small, avoid } = input;
  if (small) {
    const inset = bottomInsetFromAvoid(avoid, viewport.h);
    return { mode: "sheet", bottom: inset > 0 ? inset + MARGIN : MARGIN };
  }
  if (!target) return { mode: "center" };

  const order: Side[] = input.preferRight
    ? ["right", "bottom", "top", "left"]
    : ["bottom", "top", "right", "left"];
  const targetW = target.right - target.left;
  const targetH = target.bottom - target.top;
  const a = input.anchor ?? target;

  const candidates = order.map((side) => {
    let x: number;
    let y: number;
    // ด้านบน/ล่าง: แนวนอนตามจุดที่ชี้ · ด้านซ้าย/ขวา: แนวตั้งตามจุดที่ชี้ (ลูกศรจะชี้ตรง) — อีกแกนใช้กรอบ anchor
    if (side === "bottom") {
      x = target.left;
      y = a.bottom + GAP;
    } else if (side === "top") {
      x = target.left;
      y = a.top - GAP - tip.h;
    } else if (side === "right") {
      x = a.right + GAP;
      y = target.top;
    } else {
      x = a.left - GAP - tip.w;
      y = target.top;
    }
    const inView =
      x >= MARGIN &&
      y >= MARGIN &&
      x + tip.w <= viewport.w - MARGIN &&
      y + tip.h <= viewport.h - MARGIN;
    const cx = clamp(x, MARGIN, viewport.w - tip.w - MARGIN);
    const cy = clamp(y, MARGIN, viewport.h - tip.h - MARGIN);
    const box: Rect = { left: cx, top: cy, right: cx + tip.w, bottom: cy + tip.h };
    const hitsAvoid = avoid.some((r) => rectsOverlap(box, r));
    const hitsTarget = rectsOverlap(box, target);
    return { side, cx, cy, inView, hitsAvoid, hitsTarget };
  });

  const best =
    candidates.find((c) => c.inView && !c.hitsAvoid && !c.hitsTarget) ??
    candidates.find((c) => !c.hitsAvoid && !c.hitsTarget) ??
    candidates.find((c) => !c.hitsAvoid) ??
    candidates[0]!;

  return {
    mode: "floating",
    side: best.side,
    x: best.cx,
    y: best.cy,
    arrowX: clamp(target.left + targetW / 2 - best.cx - 6, 16, Math.max(16, tip.w - 32)),
    arrowY: clamp(target.top + Math.min(targetH, 40) / 2 - best.cy - 6, 16, Math.max(16, tip.h - 32)),
  };
}

/**
 * ต้องเลื่อนหน้าแนวตั้งเท่าไรให้จุดที่ชี้พ้นแถบบน (topInset) และพ้นกล่อง/แถบบันทึกด้านล่าง (bottomInset)
 * คืนค่าบวก = เลื่อนลง · ลบ = เลื่อนขึ้น · 0 = ไม่ต้องเลื่อน
 */
export function computeRevealDelta(args: {
  rect: Rect;
  viewportH: number;
  topInset: number;
  bottomInset: number;
}): number {
  const { rect, viewportH, topInset, bottomInset } = args;
  const limitBottom = viewportH - bottomInset;
  if (rect.bottom > limitBottom) {
    // เลื่อนลงให้ล่างพอดี แต่ไม่เลื่อนจนบนสุดหลุดใต้แถบบน
    const need = rect.bottom - limitBottom;
    const maxByTop = rect.top - topInset;
    return Math.max(0, Math.min(need, maxByTop));
  }
  if (rect.top < topInset) return rect.top - topInset;
  return 0;
}
