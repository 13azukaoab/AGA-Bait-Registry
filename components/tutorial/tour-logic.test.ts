import { describe, expect, it } from "vitest";

import {
  bottomInsetFromAvoid,
  computePlacement,
  computeRevealDelta,
  decideClick,
  evaluatePassword,
  passwordGuardError,
  rectsOverlap,
  selectorFor,
  shouldAutoOpen,
  shouldRecord,
  type Rect,
} from "./tour-logic";

const T = "2026-11-20T09:00:00.000Z";

describe("เงื่อนไขเปิดบทเรียนอัตโนมัติ", () => {
  it("ทั้ง completed และ skipped ว่าง → เปิด", () => {
    expect(shouldAutoOpen({ completedAt: null, skippedAt: null })).toBe(true);
  });
  it("เคยดูจบแล้ว → ไม่เปิด", () => {
    expect(shouldAutoOpen({ completedAt: T, skippedAt: null })).toBe(false);
  });
  it("เคยกดข้ามแล้ว → ไม่เปิด", () => {
    expect(shouldAutoOpen({ completedAt: null, skippedAt: T })).toBe(false);
  });
  it("ทั้งคู่มีค่า → ไม่เปิด", () => {
    expect(shouldAutoOpen({ completedAt: T, skippedAt: T })).toBe(false);
  });
  it("อ่านสถานะไม่ได้ (null) → ไม่เปิด (กันเด้งซ้ำทุกหน้า)", () => {
    expect(shouldAutoOpen(null)).toBe(false);
  });
});

describe("เงื่อนไขบันทึกสถานะ (complete / skip)", () => {
  const none = { completedAt: null, skippedAt: null };
  it("ผู้ใช้ใหม่: ดูจบ → บันทึก · กดข้าม → บันทึก", () => {
    expect(shouldRecord("done", none)).toBe(true);
    expect(shouldRecord("skip", none)).toBe(true);
  });
  it("เคยข้ามแล้วมาเปิดดูซ้ำจนจบ → บันทึกดูจบ (ล้างค่าข้าม) · แต่กดข้ามซ้ำ → ไม่บันทึกซ้ำ", () => {
    const skipped = { completedAt: null, skippedAt: T };
    expect(shouldRecord("done", skipped)).toBe(true);
    expect(shouldRecord("skip", skipped)).toBe(false);
  });
  it("เคยดูจบแล้วเปิดซ้ำ → ไม่เรียก RPC ทั้งดูจบและข้าม", () => {
    const done = { completedAt: T, skippedAt: null };
    expect(shouldRecord("done", done)).toBe(false);
    expect(shouldRecord("skip", done)).toBe(false);
  });
  it("ไม่มีสถานะ (อ่านไม่ได้) → ไม่เรียก RPC", () => {
    expect(shouldRecord("done", null)).toBe(false);
    expect(shouldRecord("skip", null)).toBe(false);
  });
});

describe("โหมดฝึก: ตัดสินการคลิก", () => {
  const base = { insideTutorialUi: false, insideTarget: false, isLink: false, stepWantsClick: false };

  it("ปุ่มของกล่องบทเรียนเอง → ปล่อย", () => {
    expect(decideClick({ ...base, insideTutorialUi: true })).toBe("allow");
  });
  it("ปุ่มบันทึกจริงในหน้าที่ขั้นนี้ให้ลองกด → บล็อก (ไม่ให้ปุ่มจริงทำงาน) แล้วไปขั้นถัดไป", () => {
    expect(decideClick({ ...base, insideTarget: true, stepWantsClick: true })).toBe("advance-practice");
  });
  it("ลิงก์เมนูที่ขั้นนี้ให้กด → ปล่อยให้เปลี่ยนหน้า แล้วไปขั้นถัดไป", () => {
    expect(decideClick({ ...base, insideTarget: true, stepWantsClick: true, isLink: true })).toBe("advance-link");
  });
  it("ปุ่มบันทึกจริงที่ไม่ใช่จุดที่ไฮไลต์ → บล็อก", () => {
    expect(decideClick({ ...base, stepWantsClick: true })).toBe("block");
    expect(decideClick({ ...base })).toBe("block");
  });
  it("ขั้นที่ไม่ได้ให้กด แม้คลิกในจุดที่ไฮไลต์ → บล็อก", () => {
    expect(decideClick({ ...base, insideTarget: true })).toBe("block");
    expect(decideClick({ ...base, insideTarget: true, isLink: true })).toBe("block");
  });
  it("ลิงก์อื่นที่ไม่ใช่จุดที่ให้กด → บล็อก (ไม่พาออกนอกบทเรียน)", () => {
    expect(decideClick({ ...base, isLink: true, stepWantsClick: true })).toBe("block");
  });
});

describe("selectorFor", () => {
  it("สร้าง selector ของ data-tour และตัดอักขระอันตรายออก", () => {
    expect(selectorFor("nav-new")).toBe('[data-tour="nav-new"]');
    expect(selectorFor('a"]b')).toBe('[data-tour="a]b"]');
  });
});

describe("รหัสผ่านตัวอย่างในหน้าจำลอง", () => {
  it("เงื่อนไข 4 ข้อ + ตรงกัน", () => {
    expect(evaluatePassword("Bait2026ok", "Bait2026ok")).toEqual({ len: true, up: true, lo: true, num: true, same: true });
    expect(evaluatePassword("abc", "")).toEqual({ len: false, up: false, lo: true, num: false, same: false });
  });
  it("guard: ยังไม่ผ่านเงื่อนไข → ข้อความ · ไม่ตรงกัน → ข้อความ · ผ่าน → null", () => {
    expect(passwordGuardError("abc", "abc")).toContain("ยังไม่ผ่านเงื่อนไข");
    expect(passwordGuardError("Bait2026ok", "Bait2026no")).toContain("ไม่ตรงกัน");
    expect(passwordGuardError("Bait2026ok", "Bait2026ok")).toBeNull();
  });
});

/* ---------- วางกล่อง / หลบแถบบันทึก ---------- */

const rect = (left: number, top: number, w: number, h: number): Rect => ({ left, top, right: left + w, bottom: top + h });
const TIP = { w: 332, h: 200 };
const VIEW = { w: 1280, h: 800 };

describe("วางกล่องบทเรียน", () => {
  it("ไม่ชี้จุด → กลางจอ", () => {
    expect(computePlacement({ target: null, tip: TIP, viewport: VIEW, small: false, avoid: [] })).toEqual({ mode: "center" });
  });

  it("จอกว้าง: วางใต้จุดที่ชี้ก่อน", () => {
    const p = computePlacement({ target: rect(100, 100, 200, 40), tip: TIP, viewport: VIEW, small: false, avoid: [] });
    expect(p.mode).toBe("floating");
    if (p.mode === "floating") {
      expect(p.side).toBe("bottom");
      expect(p.y).toBe(140 + 16);
    }
  });

  it("จุดอยู่ล่างจอ → ย้ายกล่องไปไว้เหนือจุด", () => {
    const p = computePlacement({ target: rect(100, 700, 200, 40), tip: TIP, viewport: VIEW, small: false, avoid: [] });
    expect(p.mode === "floating" && p.side).toBe("top");
  });

  it("ชี้เมนูซ้าย (preferRight) → วางด้านขวาของเมนู", () => {
    const p = computePlacement({ target: rect(8, 200, 220, 36), tip: TIP, viewport: VIEW, small: false, avoid: [], preferRight: true });
    expect(p.mode === "floating" && p.side).toBe("right");
  });

  it("กล่องต้องไม่บังแถบบันทึก: ชี้ปุ่มในแถบบันทึกล่างจอ → กล่องไปอยู่เหนือแถบ", () => {
    const savebar = rect(0, 730, 1280, 70);
    const target = rect(1000, 745, 160, 40); // ปุ่มบันทึกในแถบ
    const p = computePlacement({ target, tip: TIP, viewport: VIEW, small: false, avoid: [savebar] });
    expect(p.mode).toBe("floating");
    if (p.mode === "floating") {
      const box = rect(p.x, p.y, TIP.w, TIP.h);
      expect(rectsOverlap(box, savebar)).toBe(false);
      expect(rectsOverlap(box, target)).toBe(false);
    }
  });

  it("กล่องไม่ทับแถบบันทึกแม้จุดที่ชี้อยู่เหนือแถบ (ไม่เลือกด้านล่างที่ชนแถบ)", () => {
    const savebar = rect(0, 730, 1280, 70);
    const target = rect(100, 640, 200, 40);
    const p = computePlacement({ target, tip: TIP, viewport: VIEW, small: false, avoid: [savebar] });
    if (p.mode === "floating") expect(rectsOverlap(rect(p.x, p.y, TIP.w, TIP.h), savebar)).toBe(false);
    else throw new Error("ควรเป็น floating");
  });

  it("มี anchor (การ์ดของหน้าจำลอง): กล่องอยู่ด้านข้างการ์ด ไม่ทับปุ่มข้างเคียงของจุดที่ชี้", () => {
    const card = rect(450, 40, 380, 300);
    const target = rect(470, 270, 130, 38); // ปุ่มบันทึก (ปุ่ม “ใส่รหัสตัวอย่าง” อยู่ถัดไปทางขวา)
    const sibling = rect(620, 270, 130, 38);
    const p = computePlacement({ target, anchor: card, tip: TIP, viewport: VIEW, small: false, avoid: [], preferRight: true });
    expect(p.mode === "floating" && p.side).toBe("right");
    if (p.mode === "floating") {
      expect(p.x).toBe(card.right + 16);
      expect(rectsOverlap(rect(p.x, p.y, TIP.w, TIP.h), sibling)).toBe(false);
    }
  });

  it("จอเล็ก: เป็นแผ่นติดล่าง และยกให้อยู่เหนือแถบบันทึก", () => {
    const savebar = rect(0, 720, 375, 92);
    const p = computePlacement({
      target: rect(10, 100, 200, 40),
      tip: { w: 359, h: 240 },
      viewport: { w: 375, h: 812 },
      small: true,
      avoid: [savebar],
    });
    expect(p).toEqual({ mode: "sheet", bottom: 812 - 720 + 8 });
  });

  it("จอเล็กไม่มีแถบบันทึก → ชิดล่าง 8px", () => {
    const p = computePlacement({ target: null, tip: { w: 359, h: 240 }, viewport: { w: 375, h: 812 }, small: true, avoid: [] });
    expect(p).toEqual({ mode: "sheet", bottom: 8 });
  });

  it("แถบบันทึกที่อยู่นอกจอ/ครึ่งบนของจอ ไม่นับเป็นแถบล่าง", () => {
    expect(bottomInsetFromAvoid([rect(0, 1200, 375, 80)], 812)).toBe(0);
    expect(bottomInsetFromAvoid([rect(0, 100, 375, 80)], 812)).toBe(0);
    expect(bottomInsetFromAvoid([rect(0, 740, 375, 72)], 812)).toBe(72);
  });
});

describe("เลื่อนหน้าให้เห็นจุดที่ชี้", () => {
  const base = { viewportH: 800, topInset: 65, bottomInset: 220 };
  it("อยู่ในช่วงที่เห็น → ไม่เลื่อน", () => {
    expect(computeRevealDelta({ ...base, rect: rect(0, 200, 100, 40) })).toBe(0);
  });
  it("ต่ำกว่ากล่อง/แถบล่าง → เลื่อนลงเท่าที่เกิน", () => {
    expect(computeRevealDelta({ ...base, rect: rect(0, 700, 100, 40) })).toBe(740 - (800 - 220));
  });
  it("สูงกว่าแถบบน → เลื่อนขึ้น (ค่าลบ)", () => {
    expect(computeRevealDelta({ ...base, rect: rect(0, 20, 100, 40) })).toBe(20 - 65);
  });
  it("จุดสูงมาก (สูงกว่าพื้นที่ที่เห็น) → ไม่เลื่อนจนหัวจุดหลุดใต้แถบบน", () => {
    expect(computeRevealDelta({ ...base, rect: rect(0, 100, 100, 900) })).toBe(100 - 65);
  });
});
