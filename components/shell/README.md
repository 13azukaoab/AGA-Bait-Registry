# components/shell — โครงหน้า (app shell)

ย้ายมาจาก mockup `docs/mockup/_shell/` (AGA-SHELL v2) เป็น React component · ใช้ครอบทุกหน้าในกลุ่ม `app/(app)` ผ่าน `app/(app)/layout.tsx`

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `AppShell.tsx` | โครง 2 คอลัมน์ (แถบบน + เมนูซ้าย + เนื้อหา) · คุมลิ้นชักบนจอเล็ก (☰ / Esc / ฉากหลัง) |
| `Topbar.tsx` | โลโก้ · ตัวเลือกเดือน · ตัวสลับบทบาท (ชั่วคราว) · ธีม · ออกจากระบบ |
| `NavDrawer.tsx` | เมนูซ้าย (จอกว้างติดที่ / จอเล็กเป็นลิ้นชัก) + ฉากหลังทึบ |
| `NavLinks.tsx` | วาดเมนูตามสิทธิ์ · `aria-current="page"` ให้หน้าปัจจุบัน |
| `nav-items.ts` | **รายการเมนู 14 รายการ + สิทธิ์ของแต่ละรายการ + เส้นทาง (href)** — แก้เมนูที่ไฟล์นี้ที่เดียว |
| `ThemeToggle.tsx` / `theme.ts` / `ThemeScript.tsx` | สลับธีม สว่าง/มืด/ตามเครื่อง · จำใน localStorage (`aga-theme`) · สคริปต์กันกะพริบ |
| `nav-mini.ts` | **เมนูย่อบนจอกว้าง**: สถานะย่อ/ขยาย (attribute `data-nav-mini` บน `<html>`) · localStorage `aga-nav-mini` · รายการหน้าที่เริ่มแบบย่อเสมอ `NAV_MINI_START_PATHS` (ตอนนี้ `/customers/new`) · สคริปต์กันกะพริบ |
| `shell.module.css` | โลโก้เต็มชุด (`aga-logo-full.png`, ฟิลเตอร์โหมดมืด) · สีฉากหลังทึบ · สไตล์เมนูย่อ/กางทับ — ไม่มี hex |
| `types.ts` | `Role`, ชื่อตำแหน่งภาษาไทย, `MonthOption` |

## กติกาที่ต้องจำ

- **สิทธิ์เป็น prop เท่านั้น** (`<AppShell role="host" …>`) — shell ไม่อ่าน session ไม่แตะ Supabase
- เมนูที่สิทธิ์ไม่มี **ไม่ถูกวาดออกมาเลย** (กรองที่ข้อมูลใน `filterNavForRole` ไม่ใช่ซ่อนด้วย CSS) · หัวกลุ่มที่ไม่เหลือเมนูหายไปด้วย
- **การซ่อนเมนูไม่ใช่ระบบความปลอดภัย** — ของจริงบังคับที่ฐานข้อมูลด้วย RLS
- ตัวสลับบทบาทใน Topbar (`allowRoleSwitch`) เป็นของชั่วคราวไว้ลองดูหน้าตา — หมวด BE ต้องเอาออกตอนต่อ login จริง
- ไม่มีรหัสสี hex — ใช้ token จาก `app/globals.css` (`bg-surface`, `text-fg-muted`, `border-border` …)
- จุดตัดจอเล็ก/จอกว้างคือ **860px / 861px** (ตรงกับ mockup) — ถ้าเปลี่ยนต้องแก้ทั้ง `NavDrawer.tsx` และค่า `DESKTOP_QUERY` ใน `AppShell.tsx`

## เมนูย่อ (จอ ≥861px)

- กด ☰ = ย่อเหลือแถบไอคอน 58px · ชี้เมาส์หรือ Tab เข้าแถบ = กางทับเนื้อหาชั่วคราว (ไม่ดันเนื้อหา) · จอ ≤860px ยังเป็นลิ้นชักเดิม
- ใช้ `:has(:focus-visible)` ไม่ใช่ `:focus-within` เพราะลิงก์ที่เพิ่งคลิกด้วยเมาส์ยังถือโฟกัส (SPA ไม่โหลดหน้าใหม่) เมนูจะค้างกาง
- หน้าที่ต้องการเริ่มแบบย่อเสมอ: เพิ่ม path ใน `NAV_MINI_START_PATHS` (nav-mini.ts) — ไม่บันทึกค่า จนกว่าผู้ใช้กด ☰ เอง
- `AppShell` ฝัง `<script>` (NAV_MINI_INIT_SCRIPT) ตั้ง `data-nav-mini` ก่อนวาดเมนู + `data-nav-noanim` กันแอนิเมชันหุบตอนโหลด (ถอดหลังวาด 2 เฟรม) · React อ่านผ่าน useSyncExternalStore จึงไม่เกิด hydration mismatch

## ธีมไม่กะพริบทำงานอย่างไร

`ThemeScript` (server component) ฝัง `<script>` สั้นๆ ต้น `<body>` → อ่าน `localStorage` แล้วตั้ง `data-theme` บน `<html>` **ก่อน** เบราว์เซอร์วาดเมนู
ผลข้างเคียง: React (โหมด dev) เห็นว่า `<html>` มี attribute ที่ server ไม่ได้ render → ขึ้น hydration warning ใน console
ต้องใส่ `suppressHydrationWarning` ที่ `<html>` ใน `app/layout.tsx` (วิธีมาตรฐานของ next-themes) — ดูรายงานส่งงาน
