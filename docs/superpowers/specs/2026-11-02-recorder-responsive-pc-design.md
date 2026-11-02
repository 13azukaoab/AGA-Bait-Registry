# Design — Recorder mockup responsive PC layout (แบบ B)

> วันที่ 2 พ.ย. 2026 · เจ้าของ: oab · ไฟล์เป้าหมาย: `docs/mockup/aga-bait-registry-prototype.html`
> สถานะ: design (รออนุมัติก่อนลงโค้ด)

## 1. เจตนา (Intent / Why)

mockup ฝั่งหัวหน้างาน (role `recorder`) ถูกออกแบบมาแบบคอลัมน์แคบ พอเปิดบน PC จอกว้าง
**layout ไม่ขยายใช้พื้นที่จอ** — โดยเฉพาะหน้า "กรอกผลบริการ (IG/IC)" ที่ฟอร์มกรอกถูกบีบเหลือครึ่งจอ
ทำให้ตารางสถานี (หมายเลขสถานี / ชนิดปลวก / เหยื่อ) ต้อง **scroll แนวนอน** ทั้งที่จอยังว่างอีกมาก

หัวหน้างานกรอกข้อมูลบนจอ **ปนกัน** (โน้ตบุ๊ก 14", จอ PC ตั้งโต๊ะ, เปิดเต็ม/ครึ่งจอ) → layout ต้องยืดได้จริงทุกจอ
มีเพดานกันยืดเว่อร์บนจอ ultrawide (SPEC §8: หน้าจอหลักออกแบบสำหรับคอมพิวเตอร์ หน้ามือถือแยกอยู่เฟส 2)

## 2. เป้าหมาย (Goals)

1. จอ PC ปกติ (1366 / 1920) ใช้ความกว้างได้เต็ม ฟอร์ม entry ไม่ scroll แนวนอน
2. จอ ultrawide ไม่ยืดจนบรรทัดยาวอ่านยาก (มี max-width cap)
3. จอแคบ (โน้ตบุ๊ก / ครึ่งจอ / มือถือ) ยังยุบเป็นคอลัมน์เดียวทำงานได้เหมือนเดิม
4. ครอบคลุมทุกหน้าในเมนู recorder (เปลี่ยน CSS ส่วนกลาง + เฉพาะ 2 หน้า entry)

## 3. ไม่ทำ (Non-goals) / ห้ามพลาด (Anti-goals)

**Non-goals (รอบนี้ไม่ทำ):**
- ไม่ยกเครื่องเป็น layout 3 คอลัมน์ (แบบ C) — เก็บไว้เฟสหลังถ้าต้องการ
- ไม่แตะ JS, logic, ตัวเลข mock, สี Tier, เนื้อหา
- ไม่ทำหน้ามือถือเฉพาะ (การ์ดทีละลูกค้า ปุ่มใหญ่) — อยู่เฟส 2 ตาม SPEC §13

**Anti-goals (ถือว่าล้มเหลวถ้าเกิด):**
- ตาราง/ฟอร์มหน้า entry ยัง scroll แนวนอนบนจอ PC ปกติ
- จอแคบแล้วของล้น/ซ้อนกันจนกดไม่ได้
- hardcode ค่าสีใหม่ลงโค้ด (ผิดกฎ CLAUDE.md)

## 4. ข้อจำกัด (Constraints)

- ไฟล์เดียว HTML (CSS inline) — ส่งต่อง่าย (CLAUDE.md UI rule)
- ห้าม hardcode hex — อ้าง CSS variable เสมอ (รอบนี้ไม่เพิ่มสีอยู่แล้ว)
- สี Tier / ธีม light-dark ต้องไม่เพี้ยน
- ไม่มี PII ใหม่ (งาน CSS ล้วน)
- `.split` ปัจจุบันใช้ 2 ที่เท่านั้น: service (บรรทัด ~386) + bait AG (~593) — ทั้งคู่โครง `list | form`

## 5. การออกแบบที่ตัดสินแล้ว (แบบ B)

### 5.1 Cap ความกว้างจอ (global)
`.shell` (nav + main) เพิ่ม `max-width:1760px; margin-inline:auto`
- จอ ≤1760 เต็มพอดี · จอ >1760 (ultrawide) มีขอบว่างสองข้างเท่ากัน
- `.topbar` ยังเต็มความกว้าง (header เต็มจอเป็น pattern ปกติ) — ไม่แตะ

### 5.2 หน้า entry → list แคบ + form เต็ม
เพิ่ม modifier class `entry` ที่ `<div class="split">` ของ service และ bait → `class="split entry"`

```css
.split.entry{grid-template-columns:minmax(300px,340px) minmax(0,1fr)}
```
- list column แคบ 300–340px · form column กินที่เหลือ (`minmax(0,1fr)` กันตารางด้านในดันคอลัมน์บวม)
- form ได้ ~65–70% ของพื้นที่ → ตารางสถานี IG/IC + การ์ด F (`.pt .grid` 3 ช่อง) พอดีจอ ไม่ scroll

### 5.3 Breakpoints
- **≤860px:** ยุบ `.split` และ `.split.entry` เป็น 1 คอลัมน์ (list บน · form ล่าง)
  → ต้องเพิ่ม `.split.entry{grid-template-columns:1fr}` ใน media query เดิม (เพราะ `.split.entry` specificity สูงกว่า `.split` จะทับ media query ถ้าไม่ระบุ)
- **จอกว้าง ≥1400px:** `.stats` / `.cards` ใช้ `auto-fit` อยู่แล้ว เมื่อมี cap จะกระจายใบต่อแถวพอดีเอง — ไม่ต้องเพิ่ม breakpoint ใหม่

### 5.4 ตารางรายชื่อ (ซ้ายของ service)
left panel ของ service เป็น `<table>` 4 คอลัมน์ ที่ global `table{white-space:nowrap}` บังคับไม่ตัดบรรทัด
→ ในคอลัมน์แคบจะ scroll แนวนอน แก้โดยให้ตารางใน panel แรกของ `.split.entry` ตัดบรรทัดได้:
```css
.split.entry > .panel:first-child td,
.split.entry > .panel:first-child th{white-space:normal}
```
(bait ใช้ `.rowlist` อยู่แล้ว ยืดหยุ่นในคอลัมน์แคบ ไม่ต้องแก้)

## 6. สิ่งที่เหลือให้ผู้สร้าง (Builder)

1. เติม `max-width` + `margin-inline:auto` ที่ `.shell` (บรรทัด ~70)
2. เพิ่ม CSS `.split.entry` (วางใกล้ `.split` บรรทัด ~159)
3. เพิ่ม CSS ตารางซ้ายตัดบรรทัด (§5.4)
4. ปรับ media query `@media (max-width:860px)` (บรรทัด ~216) ให้ reset `.split.entry` ด้วย
5. เติม class `entry` ที่ `<div class="split">` 2 จุด (service ~386, bait ~593)
6. ไม่แตะส่วนอื่น

## 7. แผนทดสอบ (Test plan)

เปิดไฟล์ในแผง browser สั่ง `go('service')` / `go('bait')` แล้วตรวจที่ความกว้าง:
- **1920px** — form เต็ม ตารางสถานีไม่ scroll แนวนอน · ของไม่ยืดเกิน 1760
- **1366px** — โน้ตบุ๊ก: list + form พอดี ไม่ scroll
- **~1000px** — list 300 + form ~640 ยังอ่านได้
- **≤860px (เช่น 700)** — ยุบคอลัมน์เดียว list บน form ล่าง กดได้ครบ
- ตรวจหน้า todo / summary / material ว่า cap ไม่ทำพัง
- สลับ light/dark ยังปกติ

## 8. ไฟล์ที่แตะ

- `docs/mockup/aga-bait-registry-prototype.html` (CSS ~4 จุด + class `entry` 2 จุด)
- `task.md` (บันทึก changelog)
