"use client";

/**
 * AppShell — โครงหน้าของทุกหน้าในกลุ่ม app/(app)
 *
 * โครง: แถบบน (Topbar) ติดบน · ใต้แถบ = เมนูซ้าย (NavDrawer) ติดที่ + เนื้อหา (children) เลื่อนได้
 * จอ ≤860px เมนูเป็นลิ้นชัก: เปิดด้วย ☰ · ปิดด้วย Esc / กดฉากหลัง / กดลิงก์ / ขยายจอ / เปลี่ยนหน้า
 * จอ ≥861px ☰ = ย่อ/ขยายเมนู (แถบไอคอน 58px · ชี้เมาส์/Tab = กางทับชั่วคราว) — ตรรกะอยู่ใน nav-mini.ts
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
import { Topbar } from "./Topbar";
import type { MonthOption, Role } from "./types";

const NAV_ID = "app-nav";
/** จุดตัดจอกว้าง/จอเล็กของเมนู — ต้องตรงกับ `min-[861px]` / `max-[860px]` ใน NavDrawer */
const DESKTOP_QUERY = "(min-width: 861px)";

function subscribeDesktop(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const getDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
/** ฝั่ง server ไม่รู้ขนาดจอ → เริ่มด้วยโหมดลิ้นชัก แล้วอัปเดตหลัง hydrate (ไม่ mismatch) */
const getDesktopOnServer = () => false;
const getMiniOnServer = () => false;

export type AppShellProps = {
  /** ตำแหน่งของผู้ใช้ (ค่าจริงมาจากหมวด BE ผ่าน app/(app)/layout.tsx) */
  role: Role;
  /** เปิดตัวสลับบทบาทชั่วคราวใน Topbar (ใช้ตอนยังไม่มีระบบ login จริง) */
  allowRoleSwitch?: boolean;
  months: readonly MonthOption[];
  /** เดือนที่เลือกตอนเริ่ม (ค่า `value` ของ months) — ไม่ระบุ = เดือนแรกในรายการ */
  defaultMonth?: string;
  /** ปลายทางปุ่มออกจากระบบ */
  logoutHref?: string;
  children: ReactNode;
};

export function AppShell({
  role: roleFromProps,
  allowRoleSwitch = false,
  months,
  defaultMonth,
  logoutHref = "/login",
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
  const wide = useSyncExternalStore(subscribeDesktop, getDesktop, getDesktopOnServer);
  const mini = useSyncExternalStore(subscribeMini, getMini, getMiniOnServer);
  useEffect(() => releaseNoAnim(), []);
  useEffect(() => {
    applyMini(resolveMini(pathname, readStoredMini()));
  }, [pathname]);

  const onToggleNav = () => {
    if (wide) setMiniByUser(!mini);
    else setNavOpen(!navOpen);
  };

  const toggleRef = useRef<HTMLButtonElement>(null);
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
    <div
      className="min-h-dvh bg-bg text-fg"
      style={{ "--topbar-h": "57px" } as CSSProperties}
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
        wide={wide}
        mini={mini}
        onToggleNav={onToggleNav}
        months={months}
        month={month}
        onMonthChange={setMonth}
        role={role}
        onRoleChange={allowRoleSwitch ? setRoleOverride : undefined}
        logoutHref={logoutHref}
      />
      <div className="mx-auto flex max-w-[1760px] items-start max-[860px]:block">
        <NavDrawer
          ref={navRef}
          id={NAV_ID}
          role={role}
          currentPath={pathname}
          open={navOpen}
          onClose={() => setNavOpen(false)}
        />
        {/* ไม่ใช้ <main> ที่นี่ เพราะแต่ละหน้ามี <main> ของตัวเองอยู่แล้ว */}
        <div id="content" className="min-w-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
