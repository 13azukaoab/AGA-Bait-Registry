# Handoff — งานรวมหน้า mockup (integration) ของ AGA Bait Registry

> **อัปเดต 8 พ.ย. 2026 (ค่ำ): งานข้อ 1–3 เสร็จแล้ว push ขึ้น GitHub แล้ว (commit `cbb9efc..4437d4b`)**
> เหลือข้อ 4 (Tailwind vs CSS) รอเจ้าของตอบ + พบปัญหาตารางมือถือเพิ่ม (ดูท้ายไฟล์) — session ใหม่อ่านไฟล์นี้เพื่อสานงานต่อจุดที่ค้างได้เลย
> อ่าน `CLAUDE.md` + `SPEC.md` ก่อนเริ่ม · mockup ทั้งหมดอยู่ใน `docs/mockup/` · ชุด nav/topbar/โลโก้มาตรฐานอยู่ที่ `docs/mockup/_shell/` (README ในนั้นมีเช็กลิสต์การใช้งาน)
> **บทบาท:** session ใหม่ = ผู้ทำ · session หลัก (coordinator) เป็นคน `git push` ให้ — sub commit เองได้แต่อย่า push

## สถานะ ณ 8 พ.ย. 2026
mockup เสร็จครบ 8 หน้า + รวม nav/topbar/โลโก้มาตรฐานเสร็จแล้วทุกหน้า (อยู่บน GitHub แล้ว) · หน้า #7 นำเข้า Excel ถูกตัดทิ้ง · ไฟล์ต่อหน้า:

| หน้าจอ (SPEC §8) | ไฟล์ |
|---|---|
| prototype (ต้องทำ/บริการ/เหยื่อ/เก็บสถานี/ทะเบียน/สรุป/วัสดุ) | `aga-bait-registry-prototype.html` |
| เปิดงาน (admin) | `admin-add-customer.html` |
| รายละเอียดลูกค้า (#4) | `customer-detail.html` |
| ตั้งค่า (#12) | `settings.html` |
| เข้าสู่ระบบ (#1) | `login.html` |
| จัดการผู้ใช้ (#11) | `admin-user-management.html` |
| ปิดเดือน (#8 · ปิดแยกส่วนกลาง/ต่างจังหวัด) | `month-closure.html` |
| Dashboard Sync (#10) | `dashboard-sync.html` |
| อัพเดท port สาขาต่างจังหวัด (#9) | `provincial-port-update.html` |

---

## งานที่ทำแล้ว (1–3) — เสร็จ 8 พ.ย. 2026

### 1. รวม nav ให้ลิงก์ถึงกันทุกหน้า — ✅ เสร็จ
ทุกหน้าใช้เมนูซ้ายชุดเดียวกันจาก `docs/mockup/_shell/nav.html` แบ่ง 3 กลุ่ม: งานประจำวัน / ทะเบียนและสรุป / ดูแลระบบ (host) · ลิงก์จริงทุกอัน ไม่มี `class="soon"`/"เร็วๆนี้"เหลือเลย · หน้าที่เปิดอยู่มี `class="active" aria-current="page"` · prototype รองรับ hash route (`#todo #service #bait #collect #registry #summary #material`) ให้หน้าอื่นลิงก์เข้าส่วนในได้
**ไม่มี**เมนู "นำเข้าสัญญาจาก Excel" ตามที่ตัดทิ้งแล้ว (§8 หน้า 7)

### 2. ลงโลโก้จริงให้ทุกหน้า — ✅ เสร็จ
ทุกหน้าใช้โลโก้จริง (data URI ฝังในไฟล์ ก็อปจาก `login.html`) แทนกล่องตัวอักษร "AGA" เดิม · accent คงน้ำเงินทั้งระบบตามที่เจ้าของตัดสิน · dark mode = โลโก้สีขาว (CSS filter)

### 3. topbar บนมือถือ — ✅ เสร็จ
เติม `<meta name="viewport">` ที่ขาด (prototype, admin-add-customer) · topbar ย่อที่ ≤600px/≤420px ไม่บีบชื่อระบบแน่นแล้ว · ลิ้นชัก ☰ กลไกเดียวกันทุกหน้า (`body.nav-open`)

**ชุดมาตรฐานที่ใช้ทำข้อ 1–3:** `docs/mockup/_shell/` (`shell.css`, `topbar-left.html`, `nav.html`, `shell.js`, `README.md`) — หน้าใหม่ในอนาคตให้ copy จากที่นี่แทนการออกแบบ nav/topbar/โลโก้เอง

---

## งานที่ยังค้าง

### 4. CLAUDE.md: Tailwind CDN vs CSS ธรรมดา — ต้องถามเจ้าของก่อนแก้
`CLAUDE.md` (Dashboard Design) เขียนว่าให้ใช้ Tailwind CSS ผ่าน CDN แต่ mockup ทุกไฟล์เขียน CSS ธรรมดา + CSS variable (token) เอง (ไม่ใช้ Tailwind) · **อย่าแก้ CLAUDE.md เอง** (เป็นไฟล์กฎ) — เสนอเจ้าของว่าจะปรับกฎให้ตรงของจริง หรือจะ migrate ไป Tailwind ตอน build Next.js

### 5. (พบใหม่ 8 พ.ย. — ไม่ใช่ของเดิมในข้อ 1–4) ตารางล้นจอมือถือ 3 จุด
เจอตอนเทส ≤375px หลังรวม nav เสร็จ — เป็นปัญหาที่ **มีอยู่ก่อนงานรวม mockup แล้ว** (ยืนยันด้วย `git show` ว่าอยู่ในไฟล์มาก่อน commit รอบนี้) ไม่เกี่ยวกับ nav/topbar/โลโก้ แต่เป็นตารางที่ไม่มี wrapper `overflow-x:auto` ทำให้ทั้งหน้า scroll แนวนอนเบี้ยว:
- `admin-user-management.html` — ตารางรายชื่อผู้ใช้ (ล้นขวา ~297px)
- `dashboard-sync.html` — ตาราง log การ sync (ล้นขวา ~276px)
- `admin-add-customer.html` — ตาราง `.mini-t` (สรุปวัสดุในการ์ดเล็ก ล้นขวา ~76px) — **ตาราง 22 คอลัมน์หลักมี wrapper scroll อยู่แล้ว ไม่กระทบ**

วิธีแก้ที่คาดว่าใช้ได้ (ยังไม่ได้ทำ): ห่อแต่ละตารางด้วย `<div style="overflow-x:auto">` หรือ class `.tablewrap` แบบเดียวกับที่ `admin-add-customer.html` ใช้กับตาราง 22 คอลัมน์อยู่แล้ว (ดูตัวอย่างจาก class `tablewrap` ในไฟล์นั้น)

---

## มาตรฐานที่ต้องรักษา (จาก CLAUDE.md)
- UI ไทยทั้งหมด · ฟอนต์ Noto Sans Thai · ทุกไฟล์มี `<meta charset="utf-8">` (ครบแล้ว อย่าให้หาย)
- สี Tier 8 แบบ อ้าง CSS variable เสมอ **ห้าม hardcode hex**
- แก้หลายไฟล์ = ระวังอย่าให้ JS/flow เดิมพัง เปิดเทสในเบราว์เซอร์ทุกไฟล์ที่แตะ (ไม่มี console error)
- แก้ `task.md` ให้เพิ่ม changelog entry ของงานนี้เท่านั้น (เลี่ยง merge conflict)
- เสร็จแต่ละชุดแล้วแจ้ง session หลัก (coordinator) ตรวจ + push

## เรื่องรอเจ้าของตัดสิน (เกี่ยวข้องกับงานนี้)
- ✅ **สีแบรนด์ตัดสินแล้ว** (8 พ.ย.) — คง accent น้ำเงิน วางโลโก้เขียวบนพื้นขาว → ข้อ 2 ทำเสร็จแล้ว
- ✅ **naming ตัดสินแล้ว** — ใช้ "ห้างสรรพสินค้า / ร้านค้า" (mockup ปัจจุบันถูกอยู่แล้ว ไม่ต้องแก้)
- ⏳ **Tailwind vs CSS** (ข้อ 4 — ต้องถามเจ้าของก่อนแก้ CLAUDE.md)
- ⏳ **ตารางล้นจอมือถือ 3 จุด** (ข้อ 5 — จะแก้รอบนี้เลยหรือพักไว้เป็นงานแยก)
- SPEC §14 ข้อ 13–14 ปิดแล้ว (ดู SPEC §17 "8 พ.ย. 2026") · migration คอลัมน์ใหม่เป็นเรื่อง build ไม่บล็อก integration

## บันทึกการทำงานละเอียด
ดู `task.md` หัวข้อ **"2026-11-08 (รวมหน้า mockup — nav/topbar/โลโก้มาตรฐานทุกหน้า)"** — รายชื่อ commit, ไฟล์ที่แตะ, บั๊กที่เจอ+แก้แล้ว (`toggleNav` scope ใน `customer-detail.html`)
