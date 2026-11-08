# Handoff — งานรวมหน้า mockup (integration) ของ AGA Bait Registry

> ไฟล์นี้ให้ session ใหม่หยิบไปทำต่อได้เร็ว — งาน "รวมหน้า" หลัง mockup ครบทุกหน้าแล้ว
> อ่าน `CLAUDE.md` + `SPEC.md` ก่อนเริ่ม · mockup ทั้งหมดอยู่ใน `docs/mockup/`
> **บทบาท:** session ใหม่ = ผู้ทำ · session หลัก (coordinator) เป็นคน `git push` ให้ — sub commit เองได้แต่อย่า push

## สถานะ ณ 8 พ.ย. 2026
mockup เสร็จครบ 8 หน้า (อยู่บน GitHub แล้ว) · หน้า #7 นำเข้า Excel ถูกตัดทิ้ง · ไฟล์ต่อหน้า:

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

## งานที่ต้องทำ (เรียงตามความสำคัญ)

### 1. รวม nav ให้ลิงก์ถึงกันทุกหน้า (สำคัญสุด)
ตอนนี้แต่ละหน้ามี sidebar ของตัวเองไม่ตรงกัน และมีเมนู "เร็วๆนี้" (`class="soon"` + `<span class="soon-tag">เร็วๆนี้</span>`) ที่จริงๆ มีหน้าทำแล้ว · ต้องแก้เป็นลิงก์จริง + เพิ่มเมนูที่ขาด

**เมนู "เร็วๆนี้" ที่ต้องเปลี่ยนเป็นลิงก์จริง (สแกน 8 พ.ย.):**
- `aga-bait-registry-prototype.html` ~บรรทัด 303–305: รายละเอียดลูกค้า → `customer-detail.html` · ปิดเดือน → `month-closure.html` · Dashboard Sync → `dashboard-sync.html`
- `customer-detail.html` ~306–307: ปิดเดือน · Dashboard Sync
- `settings.html` ~308–310: ปิดเดือน · Dashboard Sync · จัดการผู้ใช้ → `admin-user-management.html`
- `month-closure.html` ~243: Dashboard Sync → `dashboard-sync.html`

**เมนูที่ยัง "ไม่มีเลย" ในหลายหน้า — ต้องเพิ่ม:** ตั้งค่า (`settings.html`) · จัดการผู้ใช้ (`admin-user-management.html`) · อัพเดท port ต่างจังหวัด (`provincial-port-update.html`) · เปิดงาน (`admin-add-customer.html`)

**แนะนำ:** ทำ "ชุด nav มาตรฐาน" ชุดเดียว แบ่งกลุ่มเป็น งานประจำ (ต้องทำ/กรอกบริการ/เหยื่อ/เก็บสถานี) · ทะเบียน (รายละเอียดลูกค้า/เปิดงาน) · ดูแลระบบ host (ปิดเดือน/port ต่างจังหวัด/Dashboard Sync/จัดการผู้ใช้/ตั้งค่า) แล้ววางให้ทุกหน้าเหมือนกัน · หน้าที่เปิดอยู่ใส่ `class="active"`
**หมายเหตุ:** อย่าใส่เมนู "นำเข้าสัญญาจาก Excel" (ตัดทิ้งแล้ว — §8 หน้า 7)

### 2. ลงโลโก้จริงให้ทุกหน้า — ✅ สีแบรนด์ตัดสินแล้ว ทำได้เลย
- ไฟล์โลโก้: `docs/mockup/Logo Advance Group Asia.png` (เขียว `#084436` พื้นโปร่งใส track ใน git แล้ว)
- **เจ้าของตัดสิน (8 พ.ย. 2026): คง accent น้ำเงินทั้งระบบ** วางโลโก้เขียวบนพื้นขาว/เป็นกลาง · dark mode = โลโก้ขาว (ดูวิธี embed data URI + ฟิลเตอร์ขาวจาก `login.html` ที่ทำไว้แล้ว) · **ห้ามเปลี่ยน accent เป็นเขียว**
- ตอนนี้มีแค่ `login.html` ที่ฝังโลโก้จริง · หน้าอื่นใช้กล่องตัวอักษร "AGA" (`.logo .mark`) → เปลี่ยนให้เป็นโลโก้จริงทุกหน้าแบบเดียวกับ login

### 3. topbar บนมือถือ
ทุกหน้าใช้ topbar แบบเดียวกับ prototype · บนจอมือถือชื่อระบบถูกบีบแน่น (ชื่อ "ทะเบียนบริการ Bait" คำละบรรทัด) · เป็นปัญหาร่วม แก้ที่ชุด topbar มาตรฐานทีเดียว

### 4. CLAUDE.md: Tailwind CDN vs CSS ธรรมดา — ต้องถามเจ้าของก่อนแก้
`CLAUDE.md` (Dashboard Design) เขียนว่าให้ใช้ Tailwind CSS ผ่าน CDN แต่ mockup ทุกไฟล์เขียน CSS ธรรมดา + CSS variable (token) เอง (ไม่ใช้ Tailwind) · **อย่าแก้ CLAUDE.md เอง** (เป็นไฟล์กฎ) — เสนอเจ้าของว่าจะปรับกฎให้ตรงของจริง หรือจะ migrate ไป Tailwind ตอน build Next.js

---

## มาตรฐานที่ต้องรักษา (จาก CLAUDE.md)
- UI ไทยทั้งหมด · ฟอนต์ Noto Sans Thai · ทุกไฟล์มี `<meta charset="utf-8">` (ครบแล้ว อย่าให้หาย)
- สี Tier 8 แบบ อ้าง CSS variable เสมอ **ห้าม hardcode hex**
- แก้หลายไฟล์ = ระวังอย่าให้ JS/flow เดิมพัง เปิดเทสในเบราว์เซอร์ทุกไฟล์ที่แตะ (ไม่มี console error)
- แก้ `task.md` ให้เพิ่ม changelog entry ของงานนี้เท่านั้น (เลี่ยง merge conflict)
- เสร็จแต่ละชุดแล้วแจ้ง session หลัก (coordinator) ตรวจ + push

## เรื่องรอเจ้าของตัดสิน (เกี่ยวข้องกับงานนี้)
- ✅ **สีแบรนด์ตัดสินแล้ว** (8 พ.ย.) — คง accent น้ำเงิน วางโลโก้เขียวบนพื้นขาว → ข้อ 2 ทำได้เลย
- ✅ **naming ตัดสินแล้ว** — ใช้ "ห้างสรรพสินค้า / ร้านค้า" (mockup ปัจจุบันถูกอยู่แล้ว ไม่ต้องแก้)
- ⏳ เหลือ **Tailwind vs CSS** (ข้อ 4 — ต้องถามเจ้าของก่อนแก้ CLAUDE.md)
- SPEC §14 ข้อ 13–14 ปิดแล้ว (ดู SPEC §17 "8 พ.ย. 2026") · migration คอลัมน์ใหม่เป็นเรื่อง build ไม่บล็อก integration
