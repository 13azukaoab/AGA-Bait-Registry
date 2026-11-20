"use client";

/**
 * TutorialProvider — ผูกเครื่องสถานะบทเรียน (TourController) เข้ากับแอป
 *
 * Logic summary:
 *   * อยู่ใน AppShell จึงคงอยู่ข้ามหน้า (เปลี่ยนหน้าระหว่างบทเรียนได้โดยสถานะไม่หาย)
 *   * ตอนเปิดแอป: อ่านสถานะ onboarding ของตัวเอง (หรือรับจาก prop `initialProfile` ถ้า server ส่งมาให้)
 *     → ถ้า completed/skipped ว่างทั้งคู่ เปิดบทเรียนส่วนกลางอัตโนมัติ 1 ครั้งต่อการโหลดแอป
 *   * จบ → complete_onboarding() · กดข้าม → skip_onboarding() (ผ่าน `onboarding.ts` เท่านั้น · เรียกครั้งเดียวต่อรอบ
 *     และเรียกเฉพาะเมื่อสถานะยังไม่เป็นสุดท้าย — ดู shouldRecord)
 *   * ปุ่ม “สอนใช้งาน” เรียก `start(id)` เปิดซ้ำได้ทุกเมื่อ
 *   * ตัวหน้าจอ (กล่องลอย/ไฮไลต์) อยู่ใน TutorialOverlay — provider ไม่แตะ DOM
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { LESSONS, lessonIdForUser, type LessonId } from "./lessons";
import {
  browserOnboardingClient,
  loadTutorialProfile,
  recordCompleted,
  recordSkipped,
  type TutorialProfile,
} from "./onboarding";
import { TourController, type FinishKind, type TourSnapshot } from "./TourController";
import { passwordGuardError, shouldAutoOpen, shouldRecord } from "./tour-logic";

export type LessonOption = { id: LessonId; label: string };

export type TutorialContextValue = {
  controller: TourController;
  snapshot: TourSnapshot;
  /** บทเรียนที่เปิดดูซ้ำได้ (ส่วนกลาง + ของตำแหน่งตัวเอง) */
  lessonOptions: readonly LessonOption[];
  start: (id: LessonId) => void;
  /** ข้อความแจ้งสั้นๆ ของโหมดฝึก (เช่น “โหมดฝึก · ไม่บันทึกข้อมูลจริง”) */
  toast: string | null;
  showToast: (message: string) => void;
  /** ช่องรหัสผ่านของหน้าจำลอง (ส่วนกลาง) */
  sandboxPw: { password: string; confirm: string };
  setSandboxPw: (next: { password: string; confirm: string }) => void;
};

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error("useTutorial ต้องอยู่ใต้ <TutorialProvider>");
  return ctx;
}

type Props = {
  /** role ของบัญชี (ใช้เลือกบทเรียนเมื่อไม่รู้จัก position_code) */
  role: string;
  /** สถานะที่ server อ่านมาให้แล้ว (ไม่ส่ง = provider อ่านเองฝั่ง browser) */
  initialProfile?: TutorialProfile | null;
  /** ปิดการเปิดอัตโนมัติ (ใช้ตอนทดสอบ) */
  autoOpen?: boolean;
  children: ReactNode;
};

const TOAST_MS = 3200;

export function TutorialProvider({ role, initialProfile = null, autoOpen = true, children }: Props) {
  const [profile, setProfile] = useState<TutorialProfile | null>(initialProfile);
  const [toast, setToast] = useState<string | null>(null);
  const [sandboxPw, setSandboxPw] = useState({ password: "", confirm: "" });

  // ค่าล่าสุดสำหรับ callback ของ controller (อัปเดตใน effect ไม่ใช่ตอน render)
  const profileRef = useRef<TutorialProfile | null>(profile);
  const roleRef = useRef(role);
  const pwRef = useRef(sandboxPw);
  useEffect(() => {
    profileRef.current = profile;
    roleRef.current = role;
    pwRef.current = sandboxPw;
  }, [profile, role, sandboxPw]);

  const controller = useMemo(
    () =>
      new TourController({
        positionLessonId: () => lessonIdForUser(profileRef.current?.positionCode, roleRef.current),
        checkGuard: (step) =>
          step.guard === "pw" ? passwordGuardError(pwRef.current.password, pwRef.current.confirm) : null,
        onFinish: (kind: FinishKind) => {
          const current = profileRef.current;
          if (!shouldRecord(kind, current) || !current) return;
          // อัปเดตทันที (กันเรียกซ้ำ) แล้วค่อยบันทึกจริง — ถ้าบันทึกไม่สำเร็จ ครั้งหน้าบทเรียนจะเปิดเองอีกครั้ง
          const now = new Date().toISOString();
          const optimistic: TutorialProfile =
            kind === "done" ? { ...current, completedAt: now, skippedAt: null } : { ...current, skippedAt: now };
          profileRef.current = optimistic;
          setProfile(optimistic);
          try {
            const client = browserOnboardingClient();
            void (kind === "done" ? recordCompleted(client) : recordSkipped(client));
          } catch {
            // สร้าง client ไม่ได้ (เช่น ไม่มี env) → ไม่บันทึก ไม่ให้บทเรียนพัง
          }
        },
      }),
    [],
  );

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  // อ่านสถานะของตัวเองครั้งเดียวตอนเปิดแอป (ถ้า server ไม่ได้ส่งมา)
  useEffect(() => {
    if (initialProfile) return;
    let cancelled = false;
    try {
      void loadTutorialProfile(browserOnboardingClient()).then((loaded) => {
        if (!cancelled && loaded) setProfile(loaded);
      });
    } catch {
      // สร้าง client ไม่ได้ → ไม่เปิดบทเรียนอัตโนมัติ (ปุ่ม “สอนใช้งาน” ยังใช้ได้)
    }
    return () => {
      cancelled = true;
    };
  }, [initialProfile]);

  // เปิดอัตโนมัติครั้งแรก (ทั้ง completed/skipped ว่าง) — 1 ครั้งต่อการโหลดแอป
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoOpened.current || !shouldAutoOpen(profile)) return;
    autoOpened.current = true;
    setSandboxPw({ password: "", confirm: "" });
    controller.start("central");
  }, [autoOpen, profile, controller]);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const start = useCallback(
    (id: LessonId) => {
      setSandboxPw({ password: "", confirm: "" });
      controller.start(id);
    },
    [controller],
  );

  const positionLessonId = lessonIdForUser(profile?.positionCode, role);
  const lessonOptions = useMemo<LessonOption[]>(() => {
    const list: LessonOption[] = [
      { id: "central", label: "เริ่มใช้งานครั้งแรก (ล็อกอิน / เปลี่ยนรหัส)" },
    ];
    if (positionLessonId) list.push({ id: positionLessonId, label: LESSONS[positionLessonId].title });
    return list;
  }, [positionLessonId]);

  const value = useMemo<TutorialContextValue>(
    () => ({ controller, snapshot, lessonOptions, start, toast, showToast, sandboxPw, setSandboxPw }),
    [controller, snapshot, lessonOptions, start, toast, showToast, sandboxPw],
  );

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}
