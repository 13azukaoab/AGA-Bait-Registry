"use client";

/**
 * AppShell — โครงหน้าของทุกหน้าในกลุ่ม app/(app)
 *
 * โครง: แถบบน (Topbar) ติดบน · ใต้แถบ = เมนูซ้าย (NavDrawer) ติดที่ + เนื้อหา (children) เลื่อนได้
 * จอ ≤860px เมนูเป็นลิ้นชัก: เปิดด้วย ☰ · ปิดด้วย Esc / กดฉากหลัง / กดลิงก์ / ขยายจอ / เปลี่ยนหน้า
 * จอ ≥861px ปุ่ม ☰ อยู่บนสุดของเมนูซ้าย = ย่อ/ขยายเมนู (แถบไอคอน 58px · ชี้เมาส์/Tab = กางทับชั่วคราว) — ตรรกะอยู่ใน nav-mini.ts
 *   บางหน้าเริ่มแบบย่อเสมอ (NAV_MINI_START_PATHS) โดยไม่บันทึกค่า
 *
 * สิทธิ์ (สำคัญ):
 * - รับ `role` เป็น prop เท่านั้น — ไม่อ่าน session ไม่แตะ Supabase ไม่มีตรรกะสิทธิ์ในนี้
 * - `allowRoleSwitch` เปิดตัวสลับบทบาทใน Topbar ซึ่งแค่เปลี่ยนค่าในหน่วยความจำของ client
 *   เพื่อให้ลองดูหน้าตาเมนู (ชั่วคราว รอหมวด BE ต่อของจริงแล้วปิด)
 * - ⚠ การซ่อนเมนูไม่ใช่ระบบความปลอดภัย — ของจริงบังคับที่ฐานข้อมูลด้วย RLS
 *   และฝั่ง server ของแต่ละหน้า (SPEC §5)
 */
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { TutorialOverlay, TutorialProvider, type TutorialProfile } from "@/components/tutorial";
import { NavDrawer } from "./NavDrawer";
import {
  NAV_MINI_INIT_SCRIPT,
  applyMini,
  getMini,
  readStoredMini,
  releaseNoAnim,
  resolveMini,
  setMiniByUser,
  subscribeMini,
} from "./nav-mini";
import { DEFAULT_TOPBAR_HEIGHT, topbarHeightPx } from "./topbar-height";
import { Topbar } from "./Topbar";
import { UpdateBanner } from "./UpdateBanner";
import type { MonthOption, Role } from "./types";
import type { UserLabel } from "./userLabel";

const NAV_ID = "app-nav";
/** จุดตัดจอกว้าง/จอเล็กของเมนู — ต้องตรงกับ `min-[861px]` / `max-[860px]` ใน NavDrawer */
const DESKTOP_QUERY = "(min-width: 861px)";

const getMiniOnServer = () => false;

export type AppShellProps = {
  /** ตำแหน่งของผู้ใช้ (ค่าจริงมาจากหมวด BE ผ่าน app/(app)/layout.tsx) */
  role: Role;
  /** เปิดตัวสลับบทบาทชั่วคราวใน Topbar (ใช้ตอนยังไม่มีระบบ login จริง) */
  allowRoleSwitch?: boolean;
  months: readonly MonthOption[];
  /** เดือนที่เลือกตอนเริ่ม (ค่า `value` ของ months) — ไม่ระบุ = เดือนแรกในรายการ */
  defaultMonth?: string;
  /** ป้ายผู้ที่ล็อกอินอยู่ (ข้อความล้วน) — ไม่ส่ง = ไม่แสดง */
  userLabel?: UserLabel | null;
  /** ปลายทางปุ่มออกจากระบบ */
  logoutHref?: string;
  /**
   * สถานะบทเรียนเริ่มใช้งาน (ตำแหน่ง + ดูจบ/ข้ามเมื่อไร) ที่ server อ่านมาให้แล้ว (ไม่ส่ง = บทเรียนอ่านเองฝั่ง browser 1 ครั้ง)
   * ดู components/tutorial/TutorialProvider.tsx
   */
  tutorialProfile?: TutorialProfile | null;
  children: ReactNode;
};

export function AppShell({
  role: roleFromProps,
  allowRoleSwitch = false,
  months,
  defaultMonth,
  logoutHref = "/login",
  userLabel = null,
  tutorialProfile,
  children,
}: AppShellProps) {
  const pathname = usePathname();

  // บทบาทที่ผู้ใช้ลองสลับเอง (ชั่วคราว) — ถ้าไม่สลับ ใช้ค่าจาก prop
  const [roleOverride, setRoleOverride] = useState<Role | null>(null);
  const role = allowRoleSwitch ? (roleOverride ?? roleFromProps) : roleFromProps;

  const [month, setMonth] = useState<string>(
    defaultMonth ?? months[0]?.value ?? "",
  );

  // ลิ้นชักเปิดอยู่ "ที่ path นี้" → พอเปลี่ยนหน้า ลิ้นชักปิดเองโดยไม่ต้องใช้ effect
  const [openedAtPath, setOpenedAtPath] = useState<string | null>(null);
  const navOpen = openedAtPath === pathname;
  const setNavOpen = useCallback(
    (open: boolean) => setOpenedAtPath(open ? pathname : null),
    [pathname],
  );

  // เมนูย่อ (จอกว้าง): ค่าอยู่ที่ attribute บน <html> — script ใน JSX ตั้งก่อนวาด, effect นี้ตั้งซ้ำตอนเปลี่ยนหน้า
  const mini = useSyncExternalStore(subscribeMini, getMini, getMiniOnServer);
  useEffect(() => releaseNoAnim(), []);
  useEffect(() => {
    applyMini(resolveMini(pathname, readStoredMini()));
  }, [pathname]);

  // ปุ่มในแถบบนมีเฉพาะจอเล็ก = เปิด/ปิดลิ้นชัก · ปุ่มย่อ/ขยายบนจอกว้างอยู่ใน NavDrawer
  const onToggleNav = () => setNavOpen(!navOpen);

  const toggleRef = useRef<HTMLButtonElement>(null);

  // วัดความสูง <header> จริง (มือถือพับ 2 แถว ~103px) แล้วตั้ง --topbar-h ทั้งแอป · ค่าเริ่มต้น 57px จนกว่าจะวัดเสร็จ
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const header = root?.querySelector("header");
    if (!root || !header || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      const px = topbarHeightPx(header.getBoundingClientRect().height);
      if (px !== null) root.style.setProperty("--topbar-h", `${px}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const navRef = useRef<HTMLElement>(null);

  // ปิดด้วย Esc (คืนโฟกัสให้ปุ่ม ☰) + กันเนื้อหาด้านหลังเลื่อนตอนลิ้นชักเปิด
  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNavOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    navRef.current?.querySelector<HTMLElement>("a")?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [navOpen, setNavOpen]);

  // ขยายเป็นจอกว้างตอนลิ้นชักเปิด → ปิดลิ้นชัก (กัน body ค้างเลื่อนไม่ได้)
  useEffect(() => {
    if (!navOpen) return;
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setNavOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [navOpen, setNavOpen]);

  return (
    // TutorialProvider = บทเรียนเริ่มใช้งาน (E1) — เปิดครั้งแรกอัตโนมัติ + ปุ่ม “สอนใช้งาน” ใน Topbar (components/tutorial)
    <TutorialProvider role={role} initialProfile={tutorialProfile}>
    <div
      ref={rootRef}
      className="min-h-dvh bg-bg text-fg"
      style={{ "--topbar-h": `${DEFAULT_TOPBAR_HEIGHT}px` } as CSSProperties}
    >
      {/* ตั้ง data-nav-mini บน <html> ก่อนวาดเมนู กันกะพริบ/แอนิเมชันหุบตอนโหลด */}
      <script dangerouslySetInnerHTML={{ __html: NAV_MINI_INIT_SCRIPT }} />
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-accent-strong focus:shadow-lg"
      >
        ข้ามไปยังเนื้อหา
      </a>
      <Topbar
        ref={toggleRef}
        navId={NAV_ID}
        navOpen={navOpen}
        onToggleNav={onToggleNav}
        months={months}
        month={month}
        onMonthChange={setMonth}
        role={role}
        onRoleChange={allowRoleSwitch ? setRoleOverride : undefined}
        logoutHref={logoutHref}
        userLabel={userLabel}
      />
      <div className="mx-auto flex max-w-[1760px] items-start max-[860px]:block">
        <NavDrawer
          ref={navRef}
          id={NAV_ID}
          role={role}
          currentPath={pathname}
          mini={mini}
          onToggleMini={() => setMiniByUser(!mini)}
          open={navOpen}
          userLabel={userLabel}
          onClose={() => setNavOpen(false)}
        />
        {/* ไม่ใช้ <main> ที่นี่ เพราะแต่ละหน้ามี <main> ของตัวเองอยู่แล้ว */}
        <div id="content" className="min-w-0 flex-1">
          {children}
        </div>
      </div>
      {/* กล่องแจ้ง "มีเวอร์ชันใหม่" (M34) — ลอยมุมล่างขวา แสดงเมื่อมี service worker ตัวใหม่รออยู่ */}
      <UpdateBanner />
      <TutorialOverlay />
    </div>
    </TutorialProvider>
  );
}
