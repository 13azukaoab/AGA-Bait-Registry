# AGA-SHELL v2 — ชุด topbar / โลโก้ / เมนูซ้าย มาตรฐาน (เมนูตามสิทธิ์ + เปลี่ยนชื่อเมนู)

ใช้เหมือนกันทุกหน้า mockup (ยกเว้น `login.html`) · ทุกหน้ายังเป็น single-file HTML (คัดลอกบล็อกลงไฟล์ ไม่ได้ลิงก์ไฟล์นอก)
หน้าอ้างอิงที่ทำเสร็จและเทสแล้ว = `../aga-bait-registry-prototype.html` (ดูวิธีวางจริงที่นั่น)

## เปลี่ยนจาก v1 → v2 (งาน A5 — 10 พ.ย. 2026)
1. **เปลี่ยนชื่อเมนูหลายอัน** + **เอา "รายละเอียดลูกค้า" (`data-nav="customer"`) ออกจาก sidebar** (เป็นหน้า detail เปิดจากคลิกชื่อลูกค้า ไม่ใช่เมนูหลัก)
2. **เมนูแสดงตามสิทธิ์** — แต่ละลิงก์มี `data-roles="…"` (host/admin/recorder/viewer) · ตัวกรองคือ `applyNavRole(role)` ใน `shell.js`
3. ลำดับกลุ่ม "ทะเบียนและสรุป" = registry · new (เปิดงาน) · material · summary · หัวกลุ่มเดิม "ดูแลระบบ (host)" → "ดูแลระบบ"

**ชื่อเมนูใหม่ (ตาม `data-nav`):**
| data-nav | ชื่อเดิม | ชื่อใหม่ | data-roles |
|---|---|---|---|
| todo | หน้า "ต้องทำ" | สถานะทะเบียนบริการ | host recorder |
| service | กรอกผลบริการ (IG/IC) | กรอกข้อมูลทำบริการประจำเดือน | host recorder |
| bait | กล่องเหยื่อ AG นอกรอบ | ติดตามผล AG และติดกล่อง AG (ไม่พร้อมรอบบริการ) | host recorder |
| collect | รอเก็บสถานี (หมดสัญญา) | ลูกค้ารอเก็บสถานี | host recorder |
| registry | ทะเบียนลูกค้า/สัญญา | ทะเบียนลูกค้า/สัญญา (คงเดิม) | host admin recorder |
| new | เปิดงาน (admin) | เปิดงานเข้าทะเบียนบริการ | host admin |
| material | สรุปวัสดุ | สรุปยอดใช้อุปกรณ์รายเดือน | host admin recorder |
| summary | สรุปตัวเลข | Dashboard สรุปมูลค่าทั้งหมด | host admin recorder viewer |
| closure | ปิดเดือน | ส่งข้อมูล และสรุปงานประจำเดือน | host recorder |
| port | port สาขาต่างจังหวัด | ลงข้อมูล Port ต่างจังหวัด | host |
| sync | Dashboard Sync | Dashboard Sync (คงเดิม) | host |
| users | จัดการผู้ใช้ | จัดการผู้ใช้ (คงเดิม) | host |
| settings | ตั้งค่า | ตั้งค่า (คงเดิม) | host |
| ~~customer~~ | รายละเอียดลูกค้า | **ลบออกจากเมนู** | — |

**การ wire role filter ในแต่ละหน้า (ต้องทำเพิ่มจาก v1):**
- หน้าที่มี `setRole(r)` อยู่แล้ว → ใน setRole เรียก `applyNavRole(r)` (แทน loop ซ่อนเมนูเดิมถ้ามี) และตอนโหลดหน้าเรียก `applyNavRole(<role เริ่มต้นของ roleSel>)` หนึ่งครั้ง
- หน้าที่ **ไม่มี** role selector (เช่น admin-add-customer ที่ fix เป็น host) → เรียก `applyNavRole('host')` ตอนโหลด (host เห็นครบอยู่แล้ว เมนูไม่หาย)
- `applyNavRole` อยู่ใน `shell.js` — คัดลอกมาด้วยตอนวาง JS (ดูหน้า prototype เป็นตัวอย่าง)

## ไฟล์ในโฟลเดอร์นี้ (แหล่งจริง — แก้ที่นี่ แล้วคัดลอกไปทุกหน้า)
| ไฟล์ | ใส่ตรงไหนของหน้า |
|---|---|
| `shell.css` | ใน `<style>` แทนที่ CSS เดิมของ `.topbar` `.logo` `.nav*` `.navtoggle` `.nav-backdrop` `.shell` และ media query ของเมนูมือถือ |
| `topbar-left.html` | ในต้น `<div class="topbar">` แทนที่ปุ่ม ☰ + `<div class="logo">…</div>` เดิม (ฝั่งขวา: เดือน/บทบาท/ธีม/avatar เป็นของหน้าเอง คงไว้) |
| `nav.html` | แทนที่ `<nav class="nav">…</nav>` + `.nav-backdrop` เดิมทั้งก้อน · **แก้อย่างเดียว:** ลิงก์ของหน้าตัวเองใส่ `class="active" aria-current="page"` (หน้า customer-detail ไม่มีเมนูของตัวเองแล้ว = ไม่ต้องใส่ active ที่ลิงก์ไหน) |
| `shell.js` | แทนที่ฟังก์ชัน `toggleNav` + listener ปุ่ม Esc + **`applyNavRole`** เดิมของหน้า (กลไกคือ `body.nav-open` ทุกหน้า) |

ค่า `data-nav` ของแต่ละลิงก์ = กุญแจหน้า: `todo service bait collect registry new material summary closure port sync users settings` (v2 เอา `customer` ออกแล้ว)

## เช็กลิสต์ต่อหน้า
1. มี `<meta charset="utf-8">` **และ `<meta name="viewport" content="width=device-width, initial-scale=1">`** (prototype กับ admin-add-customer เคยไม่มี viewport → มือถือวาดที่ 980px ทำให้ topbar แน่น)
2. ลบ CSS เดิมของ topbar/logo/nav/shell ให้หมด (รวม `.logo .mark`, `.soon`, `.soon-tag`, `.hide-sm` ที่เกี่ยวกับ topbar, rule มือถือที่ซ่อน `.logo .txt`) แล้ววาง `shell.css` ทีเดียว
3. แทน topbar ซ้าย + nav + JS ตามตารางด้านบน · ห้ามเหลือ `class="soon"` / "เร็วๆนี้" / ลิงก์ที่ไม่มี `href` / เมนู "นำเข้าสัญญาจาก Excel"
4. ถ้าหน้าเดิมใช้กลไกอื่น (เช่น `settings.html` ใช้ `.nav.open` + `.nav-backdrop.show`) ให้เปลี่ยนเป็น `body.nav-open` ให้หมด
5. ห้ามเพิ่ม hex ใหม่ — อ้าง CSS variable เท่านั้น (ใน `shell.css` มีแต่ `var(--…)` กับ rgba ของ `--scrim` / `--drawer-shadow`)
6. หน้า `admin-add-customer.html` ไม่มี topbar/nav เลย → ต้องเพิ่ม `.topbar` + `.shell` ครอบเนื้อหาเดิม (ระวังเนื้อหาเดิมกว้างเต็มจอ ตาราง 22 คอลัมน์)
7. เปิดเทสในเบราว์เซอร์: โหมดสว่าง/มืด · จอกว้าง + 375px · กด ☰ เปิดลิ้นชัก · กดลิงก์ทุกอันไปถูกหน้า · **ไม่มี console error** · ฟังก์ชันเดิมของหน้า (ปุ่ม/ฟอร์ม/modal) ยังใช้ได้

## avatar มุมขวาบน = ลิงก์ออกจากระบบ (10 พ.ย. 2026)
topbar ฝั่งขวายังเป็นของแต่ละหน้า แต่ทุกหน้าใช้ `<a class="avatar" href="login.html" title="ออกจากระบบ …" aria-label="ออกจากระบบ">` แทน `<div class="avatar">` · มี CSS `a.avatar{…}` วางก่อนกฎ `.avatar` เดิม · หน้าใหม่ให้ทำแบบเดียวกัน (login สำเร็จ → host/recorder ไป `aga-bait-registry-prototype.html#todo`, admin ไป `admin-add-customer.html`)

## หน้า `customer-detail.html` ไม่อยู่ใน sidebar แล้ว
เข้าได้จากการคลิกชื่อลูกค้า (ลิงก์ ↗) เท่านั้น: `customer-detail.html?c=<id>#tab=contracts` — ถ้าเพิ่มรายการลูกค้าในหน้าใหม่ ต้องใส่ลิงก์นี้ด้วย (ไม่งั้นหน้านี้เข้าไม่ถึง — เคยเป็นข้อบกพร่องมาแล้วหนึ่งครั้ง)

## ลิงก์ไปหน้า prototype
prototype เป็นหน้าเดียวหลายส่วน ใช้ hash: `aga-bait-registry-prototype.html#todo` (`todo service bait collect registry summary material`) — ตัว prototype อ่าน hash ตอนเปิด/เปลี่ยน และเขียน hash กลับตอนกดเมนู
