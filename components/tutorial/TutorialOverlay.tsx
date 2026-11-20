"use client";

/**
 * TutorialOverlay — กล่องลอยชี้ทีละจุด + ไฮไลต์ (แบบ ก ที่เจ้าของเลือก)
 *
 * Logic summary (ต่อ 1 ขั้น):
 *   1) ถ้าขั้นมี `path` และยังไม่อยู่หน้านั้น → router.push (อ่านอย่างเดียว ไม่ใช่การบันทึก)
 *   2) ชี้เมนูซ้ายบนจอเล็ก → เปิดลิ้นชักเมนูให้ก่อน (กดปุ่ม ☰ ให้)
 *   3) รอจนเจอ element `data-tour="<target>"` (สูงสุด ~2.5 วิ · ถ้าเพิ่งเปลี่ยนหน้า ~5 วิ)
 *      ไม่เจอ → ข้ามขั้นนั้นไปเงียบๆ (controller.reportMissing) ห้ามค้าง
 *   4) เลื่อนหน้าให้เห็นจุดที่ชี้ แล้ววางไฮไลต์ + กล่อง (หลบแถบบันทึก `data-sticky-savebar`)
 *
 * โหมดฝึก (สำคัญ): ระหว่างบทเรียนดักการ “คลิก” และ “ส่งฟอร์ม” ทั้งหน้าที่ขั้น capture
 *   → ปุ่มจริงของหน้าไม่ทำงาน (ไม่เรียก API/RPC/server action) · ปุ่มที่ขั้นนี้ให้ลองกดจะขึ้นข้อความ “โหมดฝึก”
 *   แล้วไปขั้นถัดไปแทน · ลิงก์เมนูที่ขั้นนี้ให้กด พาไปหน้านั้นจริงได้ (แค่เปลี่ยนหน้า ไม่บันทึกอะไร)
 *   ตรรกะตัดสินใจอยู่ใน tour-logic.ts (decideClick) และมีเทสครอบ
 * คีย์ลัด: ← ย้อน · → ถัดไป · Esc ข้ามทั้งหมด · prefers-reduced-motion ปิดแอนิเมชัน (CSS)
 */
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import { getLesson } from "./lessons";
import {
  computePlacement,
  computeRevealDelta,
  decideClick,
  isClickStep,
  nextAfterMissing,
  selectorFor,
  viewForStep,
  type Placement,
  type Rect,
} from "./tour-logic";
import { TutorialSandbox } from "./TutorialSandbox";
import { useTutorial } from "./TutorialProvider";
import styles from "./tutorial.module.css";

const SMALL_QUERY = "(max-width: 860px)";
const PRACTICE_TOAST = "โหมดฝึก · ไม่บันทึกข้อมูลจริง";
const BLOCK_TOAST_CLICK = "ตอนนี้ให้กดตามช่องที่ไฮไลต์ หรือกด “ข้ามทั้งหมด”";
const BLOCK_TOAST_READ = "กด “ถัดไป” เพื่อไปขั้นต่อไป หรือกด “ข้ามทั้งหมด”";
const WAIT_MS = 2500;
const WAIT_AFTER_NAV_MS = 5000;
const POLL_MS = 100;
const SPOT_PAD = 4;

const subscribeSmall = (cb: () => void) => {
  const q = window.matchMedia(SMALL_QUERY);
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
};
const getSmall = () => window.matchMedia(SMALL_QUERY).matches;
const noopSubscribe = () => () => {};

function toRect(r: DOMRect): Rect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function samePlacement(a: Placement, b: Placement): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** element มองเห็นได้จริงหรือไม่ (มีขนาด + ไม่ถูก visibility:hidden เช่น ลิ้นชักเมนูที่ปิดอยู่) */
function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  return getComputedStyle(el).visibility !== "hidden";
}

/** ปุ่ม ☰ บนแถบบน (จอเล็ก) — มี aria-expanded */
function navToggle(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[aria-controls="app-nav"][aria-expanded]');
}

type Layout = { key: string; rect: Rect | null; placement: Placement };

export function TutorialOverlay() {
  const { controller, snapshot, toast, showToast, sandboxPw, setSandboxPw } = useTutorial();
  const router = useRouter();
  const pathname = usePathname();
  const small = useSyncExternalStore(subscribeSmall, getSmall, () => false);
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const lesson = snapshot.lessonId ? getLesson(snapshot.lessonId) : undefined;
  const rawStep = snapshot.running ? lesson?.steps[snapshot.index] : undefined;
  const stepKey = `${snapshot.lessonId}:${snapshot.index}`;
  // ขั้นที่หาจุดหลักไม่เจอและมีจุดสำรอง → แสดงจุดสำรองแทน (จำไว้ต่อขั้น)
  const [fallbackKey, setFallbackKey] = useState<string | null>(null);
  const usingFallback = fallbackKey === stepKey;
  const step = useMemo(() => (rawStep ? viewForStep(rawStep, usingFallback) : undefined), [rawStep, usingFallback]);
  const running = snapshot.running && !!lesson && !!step;
  const stepCount = lesson?.steps.length ?? 0;

  const tipRef = useRef<HTMLDivElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const stepRef = useRef(step);
  const smallRef = useRef(small);
  const revealedKey = useRef<string | null>(null);
  const navRequestedKey = useRef<string | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [targetVersion, setTargetVersion] = useState(0);
  // จุดที่ชี้ถูกปิดอยู่ (disabled) → กดไม่ได้ ให้แสดงเป็นขั้นอ่านธรรมดา
  const [targetDisabled, setTargetDisabled] = useState(false);

  const stepKeyRef = useRef(stepKey);
  useEffect(() => {
    stepRef.current = step;
    smallRef.current = small;
    stepKeyRef.current = stepKey;
  });

  /* ---------- วัดตำแหน่งแล้ววางกล่อง ---------- */
  const measure = useCallback(() => {
    const tipEl = tipRef.current;
    const current = stepRef.current;
    if (!tipEl || !current) return;
    const el = targetRef.current;
    // ขั้นที่ชี้จุดแต่ยังหาจุดไม่เจอ → ยังไม่วางกล่อง (กันกล่องวูบกลางจอก่อนถูกข้าม)
    if (current.target && !(el && el.isConnected)) return;
    const rect = el && el.isConnected ? toRect(el.getBoundingClientRect()) : null;
    const disabled = !!el && el.matches(':disabled, [aria-disabled="true"]');
    setTargetDisabled((prev) => (prev === disabled ? prev : disabled));
    // หน้าจำลอง: ใช้ทั้งการ์ดเป็นกรอบวางกล่อง (กล่องอยู่ข้างการ์ด ไม่ทับปุ่มข้างเคียง)
    const card = el?.closest<HTMLElement>("[data-tutorial-card]") ?? null;
    const avoid = Array.from(document.querySelectorAll("[data-sticky-savebar]"))
      .filter((n) => !tipEl.contains(n))
      .map((n) => toRect(n.getBoundingClientRect()));
    const placement = computePlacement({
      target: rect,
      tip: { w: tipEl.offsetWidth, h: tipEl.offsetHeight },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      small: smallRef.current,
      avoid,
      // เมนูซ้าย / การ์ดกลางจอของหน้าจำลอง → วางกล่องด้านข้าง ไม่ให้บังช่องกรอกและปุ่มที่ให้ลองกด
      preferRight: !!el?.closest("#app-nav, [data-tutorial-sandbox]"),
      anchor: card ? toRect(card.getBoundingClientRect()) : undefined,
    });
    setLayout((prev) =>
      prev && prev.key === stepKeyRef.current && samePlacement(prev.placement, placement) &&
      JSON.stringify(prev.rect) === JSON.stringify(rect)
        ? prev
        : { key: stepKeyRef.current, rect, placement },
    );
  }, []);

  /* ---------- ตั้ง/ล้างสถานะของหน้าตอนบทเรียนทำงาน ---------- */
  useEffect(() => {
    if (!running) return;
    document.body.dataset.tutorial = "on";
    return () => {
      setFallbackKey(null); // รอบหน้าเริ่มจากจุดหลักใหม่
      delete document.body.dataset.tutorial;
      const nav = document.getElementById("app-nav");
      if (nav) nav.style.paddingBottom = "";
      // จบบทเรียนแล้วปิดลิ้นชักเมนูที่เปิดให้ (จอเล็ก)
      const toggle = navToggle();
      if (toggle && toggle.getAttribute("aria-expanded") === "true" && getSmall()) toggle.click();
      document.querySelector<HTMLElement>('[data-tour="help-btn"]')?.focus({ preventScroll: true });
    };
  }, [running]);

  /* ---------- ดักคลิก/ส่งฟอร์ม (โหมดฝึก) + คีย์ลัด ---------- */
  useEffect(() => {
    if (!running) return;

    const onClick = (event: MouseEvent) => {
      if (!event.isTrusted) return; // คลิกที่โค้ดสร้างเอง (เช่น เปิดลิ้นชักเมนู) ปล่อยผ่าน
      const t = event.target;
      if (!(t instanceof Element)) return;
      const current = stepRef.current;
      const targetEl = current?.target ? document.querySelector(selectorFor(current.target)) : null;
      const inSandboxFree = !!t.closest("[data-tutorial-sandbox]") && !t.closest("[data-tutorial-fake]");
      const decision = decideClick({
        insideTutorialUi: !!t.closest("[data-tutorial-ui]") || inSandboxFree,
        insideTarget: !!targetEl && targetEl.contains(t),
        isLink: !!t.closest("a[href]"),
        stepWantsClick: isClickStep(current?.act, !!targetEl?.matches(':disabled, [aria-disabled="true"]')),
      });
      if (decision === "allow") return;
      if (decision === "advance-link") {
        // ปล่อยให้ลิงก์พาไปหน้านั้นจริง แล้วไปขั้นถัดไป
        setTimeout(() => controller.next(), 0);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (decision === "advance-practice") {
        controller.next();
        if (!controller.getSnapshot().guardError) showToast(PRACTICE_TOAST);
      } else {
        showToast(current?.act === "click" ? BLOCK_TOAST_CLICK : BLOCK_TOAST_READ);
      }
    };

    // Enter ในช่องกรอก / ปุ่ม submit → ไม่ให้ฟอร์มของหน้าจริงส่งในโหมดฝึก
    const onSubmit = (event: SubmitEvent) => {
      const t = event.target;
      if (t instanceof Element && t.closest("[data-tutorial-sandbox]")) return;
      event.preventDefault();
      event.stopPropagation();
      showToast(PRACTICE_TOAST);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        controller.skipAll();
        return;
      }
      const t = event.target as HTMLElement | null;
      const typing = !!t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable);
      if (typing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        controller.next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        controller.back();
      }
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [running, controller, showToast]);

  /* ---------- พาไปหน้า / เปิดเมนู / รอจุดชี้ / ข้ามถ้าไม่เจอ ---------- */
  useEffect(() => {
    if (!running || !step) return;
    targetRef.current = null;

    const isApp = (step.screen ?? "app") === "app";
    let navigating = false;
    if (isApp && step.path && pathname !== step.path && navRequestedKey.current !== stepKey) {
      navRequestedKey.current = stepKey;
      navigating = true;
      router.push(step.path);
    }

    // จอเล็ก: ชี้เมนูซ้าย → เปิดลิ้นชักให้ · ขั้นอื่น → ปิดลิ้นชักที่เราเปิดไว้
    if (isApp) {
      const toggle = navToggle();
      const wantsNav = !!step.target && step.target.startsWith("nav-");
      if (toggle && getSmall()) {
        const open = toggle.getAttribute("aria-expanded") === "true";
        if (wantsNav !== open && !navigating) toggle.click();
      }
    }
    const nav = document.getElementById("app-nav");
    if (nav) nav.style.paddingBottom = smallRef.current && step.target?.startsWith("nav-") ? "62vh" : "";

    if (!step.target) {
      targetRef.current = null;
      setTargetVersion((v) => v + 1);
      return;
    }

    const selector = selectorFor(step.target);
    const deadline = Date.now() + (navigating ? WAIT_AFTER_NAV_MS : WAIT_MS);
    const timer = setInterval(() => {
      const el = document.querySelector<HTMLElement>(selector);
      if (el && isVisible(el)) {
        clearInterval(timer);
        targetRef.current = el;
        setTargetVersion((v) => v + 1);
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        if (rawStep && nextAfterMissing(rawStep, usingFallback) === "fallback") {
          setFallbackKey(stepKey); // หาจุดหลักไม่เจอ → ใช้จุดสำรอง
        } else {
          controller.reportMissing(); // หาไม่เจอทั้งคู่ → ข้ามขั้นนี้เงียบๆ
        }
      }
    }, POLL_MS);
    // ตรวจทันที 1 ครั้ง (ไม่ต้องรอรอบแรก)
    const first = document.querySelector<HTMLElement>(selector);
    if (first && isVisible(first)) {
      clearInterval(timer);
      targetRef.current = first;
      setTargetVersion((v) => v + 1);
    }
    return () => clearInterval(timer);
  }, [running, step, rawStep, usingFallback, stepKey, pathname, router, controller]);

  /* ---------- เมื่อเจอจุดชี้: เลื่อนให้เห็น (ครั้งเดียวต่อขั้น) แล้ววางกล่อง + ตามเลย์เอาต์ที่ขยับ ---------- */
  useEffect(() => {
    if (!running) return;
    const el = targetRef.current;
    if (el && revealedKey.current !== stepKey) {
      revealedKey.current = stepKey;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const tipEl = tipRef.current;
      const savebar = document.querySelector("[data-sticky-savebar]");
      const sheetH = smallRef.current && tipEl ? Math.min(tipEl.offsetHeight, window.innerHeight * 0.62) + 20 : 20;
      const savebarH =
        savebar && !el.closest("#app-nav") && !savebar.contains(el)
          ? Math.max(0, window.innerHeight - savebar.getBoundingClientRect().top)
          : 0;
      const delta = computeRevealDelta({
        rect: toRect(el.getBoundingClientRect()),
        viewportH: window.innerHeight,
        // แถบบน (sticky) สูงไม่เท่ากันตามขนาดจอ (จอเล็กขึ้น 2 บรรทัด) → วัดจริง
        topInset: (document.querySelector("header")?.getBoundingClientRect().bottom ?? 57) + 8,
        bottomInset: Math.max(sheetH, savebarH + 12),
      });
      if (delta !== 0 && !el.closest("#app-nav")) {
        // หน้าจำลองเลื่อนในกรอบของตัวเอง (fixed) ส่วนหน้าจริงเลื่อนทั้งหน้า
        const sandbox = el.closest("[data-tutorial-sandbox]");
        if (sandbox) sandbox.scrollBy(0, delta);
        else window.scrollBy(0, delta);
      }
    }
    measure();
    const t1 = setTimeout(measure, 60);
    const t2 = setTimeout(measure, 260);
    const poll = setInterval(measure, 250); // ตามเลย์เอาต์ที่ขยับ (ฟอนต์โหลด ข้อมูลเข้า)
    const onChange = () => measure();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, { passive: true, capture: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onChange);
      ro.observe(document.body);
      if (tipRef.current) ro.observe(tipRef.current);
    }
    nextBtnRef.current?.focus({ preventScroll: true });
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(poll);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
      ro?.disconnect();
    };
  }, [running, stepKey, targetVersion, small, measure]);

  if (!mounted || !running || !lesson || !step) return null;

  const ready = layout !== null && layout.key === stepKey;
  const placement: Placement = ready ? layout.placement : { mode: "center" };
  const rect = ready ? layout.rect : null;

  const tipStyle: CSSProperties = { visibility: ready ? "visible" : "hidden" };
  let tipClass = styles.tip;
  let side: string | undefined;
  if (placement.mode === "sheet") {
    tipClass = `${styles.tip} ${styles.tipSheet}`;
    tipStyle.bottom = placement.bottom;
  } else if (placement.mode === "center") {
    tipClass = `${styles.tip} ${styles.tipCenter}`;
  } else {
    tipStyle.left = placement.x;
    tipStyle.top = placement.y;
    Object.assign(tipStyle, { "--ax": `${placement.arrowX}px`, "--ay": `${placement.arrowY}px` });
    side = placement.side;
  }

  const isLast = snapshot.index === stepCount - 1;
  const clickStep = isClickStep(step.act, targetDisabled);
  const nextLabel = clickStep ? "ข้ามขั้นนี้" : (step.cta ?? (isLast ? "เสร็จสิ้น" : "ถัดไป"));
  const screen = step.screen ?? "app";

  return createPortal(
    <>
      {screen !== "app" ? (
        <TutorialSandbox
          screen={screen}
          password={sandboxPw.password}
          confirm={sandboxPw.confirm}
          onChange={setSandboxPw}
          error={snapshot.guardError}
        />
      ) : null}

      {rect ? (
        <div
          className={styles.spot}
          aria-hidden="true"
          style={{
            left: rect.left - SPOT_PAD,
            top: rect.top - SPOT_PAD,
            width: rect.right - rect.left + SPOT_PAD * 2,
            height: rect.bottom - rect.top + SPOT_PAD * 2,
          }}
        />
      ) : null}

      <div
        ref={tipRef}
        className={tipClass}
        style={tipStyle}
        data-side={side}
        data-tutorial-ui="tip"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tutorial-title"
        aria-describedby="tutorial-body"
      >
        <i className={styles.arrow} aria-hidden="true" />
        <div className={styles.prog} aria-hidden="true">
          {lesson.steps.map((_, k) => (
            <i key={k} data-on={k <= snapshot.index} />
          ))}
        </div>
        <div className={styles.meta}>
          <span>
            {lesson.title} · ขั้น {snapshot.index + 1} / {stepCount}
          </span>
          <span className={styles.badge}>โหมดฝึก</span>
        </div>
        <h2 id="tutorial-title" className={styles.title}>
          {step.title}
        </h2>
        <p id="tutorial-body" className={styles.body}>
          {step.body}
        </p>
        {step.hint && !(step.act === "click" && targetDisabled) ? <p className={styles.hint}>{step.hint}</p> : null}
        {snapshot.guardError && screen === "app" ? (
          <p className={styles.error} role="alert">
            {snapshot.guardError}
          </p>
        ) : null}
        <div className={styles.acts}>
          <button type="button" className={styles.btn} disabled={snapshot.index === 0} onClick={() => controller.back()}>
            ย้อน
          </button>
          <button
            ref={nextBtnRef}
            type="button"
            className={`${styles.btn} ${clickStep ? "" : styles.btnPri}`}
            onClick={() => controller.next()}
          >
            {nextLabel}
          </button>
        </div>
        <button type="button" className={styles.link} onClick={() => controller.skipAll()}>
          ข้ามทั้งหมด (Esc)
        </button>
      </div>

      <div className="sr-only" aria-live="polite">
        ขั้น {snapshot.index + 1} จาก {stepCount}: {step.title}
      </div>
      {toast ? (
        <div className={styles.toast} role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
