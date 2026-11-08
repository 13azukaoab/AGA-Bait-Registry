# AGA-SHELL v1 — ชุด topbar / โลโก้ / เมนูซ้าย มาตรฐาน

ใช้เหมือนกันทุกหน้า mockup (ยกเว้น `login.html`) · ทุกหน้ายังเป็น single-file HTML (คัดลอกบล็อกลงไฟล์ ไม่ได้ลิงก์ไฟล์นอก)
หน้าอ้างอิงที่ทำเสร็จและเทสแล้ว = `../aga-bait-registry-prototype.html` (ดูวิธีวางจริงที่นั่น)

## ไฟล์ในโฟลเดอร์นี้ (แหล่งจริง — แก้ที่นี่ แล้วคัดลอกไปทุกหน้า)
| ไฟล์ | ใส่ตรงไหนของหน้า |
|---|---|
| `shell.css` | ใน `<style>` แทนที่ CSS เดิมของ `.topbar` `.logo` `.nav*` `.navtoggle` `.nav-backdrop` `.shell` และ media query ของเมนูมือถือ |
| `topbar-left.html` | ในต้น `<div class="topbar">` แทนที่ปุ่ม ☰ + `<div class="logo">…</div>` เดิม (ฝั่งขวา: เดือน/บทบาท/ธีม/avatar เป็นของหน้าเอง คงไว้) |
| `nav.html` | แทนที่ `<nav class="nav">…</nav>` + `.nav-backdrop` เดิมทั้งก้อน · **แก้อย่างเดียว:** ลิงก์ของหน้าตัวเองใส่ `class="active" aria-current="page"` |
| `shell.js` | แทนที่ฟังก์ชัน `toggleNav` + listener ปุ่ม Esc เดิมของหน้า (กลไกคือ `body.nav-open` ทุกหน้า) |

ค่า `data-nav` ของแต่ละลิงก์ = กุญแจหน้า: `todo service bait collect registry customer new summary material closure port sync users settings`

## เช็กลิสต์ต่อหน้า
1. มี `<meta charset="utf-8">` **และ `<meta name="viewport" content="width=device-width, initial-scale=1">`** (prototype กับ admin-add-customer เคยไม่มี viewport → มือถือวาดที่ 980px ทำให้ topbar แน่น)
2. ลบ CSS เดิมของ topbar/logo/nav/shell ให้หมด (รวม `.logo .mark`, `.soon`, `.soon-tag`, `.hide-sm` ที่เกี่ยวกับ topbar, rule มือถือที่ซ่อน `.logo .txt`) แล้ววาง `shell.css` ทีเดียว
3. แทน topbar ซ้าย + nav + JS ตามตารางด้านบน · ห้ามเหลือ `class="soon"` / "เร็วๆนี้" / ลิงก์ที่ไม่มี `href` / เมนู "นำเข้าสัญญาจาก Excel"
4. ถ้าหน้าเดิมใช้กลไกอื่น (เช่น `settings.html` ใช้ `.nav.open` + `.nav-backdrop.show`) ให้เปลี่ยนเป็น `body.nav-open` ให้หมด
5. ห้ามเพิ่ม hex ใหม่ — อ้าง CSS variable เท่านั้น (ใน `shell.css` มีแต่ `var(--…)` กับ rgba ของ `--scrim` / `--drawer-shadow`)
6. หน้า `admin-add-customer.html` ไม่มี topbar/nav เลย → ต้องเพิ่ม `.topbar` + `.shell` ครอบเนื้อหาเดิม (ระวังเนื้อหาเดิมกว้างเต็มจอ ตาราง 22 คอลัมน์)
7. เปิดเทสในเบราว์เซอร์: โหมดสว่าง/มืด · จอกว้าง + 375px · กด ☰ เปิดลิ้นชัก · กดลิงก์ทุกอันไปถูกหน้า · **ไม่มี console error** · ฟังก์ชันเดิมของหน้า (ปุ่ม/ฟอร์ม/modal) ยังใช้ได้

## ลิงก์ไปหน้า prototype
prototype เป็นหน้าเดียวหลายส่วน ใช้ hash: `aga-bait-registry-prototype.html#todo` (`todo service bait collect registry summary material`) — ตัว prototype อ่าน hash ตอนเปิด/เปลี่ยน และเขียน hash กลับตอนกดเมนู
