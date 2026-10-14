# task.md — บันทึกการทำงาน AGA Bait Registry

> ไฟล์นี้ใช้บันทึกความคืบหน้างาน เพื่อให้ทีม (นัท, Jane, Toon) และเจ้าของตามงานได้ และใช้เป็นฐานอัปเดตเอกสาร Doc อื่นๆ
> **อัปเดตทุกครั้งที่จบ task** — ลงวันที่, สิ่งที่ทำ, ไฟล์ที่แก้
> อ้างอิงข้อกำหนด: [SPEC.md](SPEC.md) · กฎการทำงาน: [CLAUDE.md](CLAUDE.md)

---

## สถานะภาพรวม

| ด้าน | สถานะ | หมายเหตุ |
|---|---|---|
| เอกสาร (SPEC/CLAUDE) | ✅ มีแล้ว | SPEC v1.0 |
| Git + GitHub | ✅ เชื่อมแล้ว | `13azukaoab/AGA-Bait-Registry` branch `main` |
| โครงNext.js + TS | ⬜ ยังไม่เริ่ม | |
| lib/rules + unit test | ⬜ ยังไม่เริ่ม | core logic ตาม CLAUDE.md |
| DB schema + RLS (Supabase) | ⬜ ยังไม่เริ่ม | |
| นำเข้าสัญญา (หน้าจอ 7) | ⬜ ยังไม่เริ่ม | |
| Snapshot + Dashboard Sync | ⬜ ยังไม่เริ่ม | |
| fixtures (ข้อมูลทดสอบจริง) | ⚠️ ยังไม่มีไฟล์ | รอเจ้าของส่ง `zone1_registry.*`, `dashboard_data.json` |

**ความหมายสัญลักษณ์:** ✅ เสร็จ · 🔄 กำลังทำ · ⬜ ยังไม่เริ่ม · ⚠️ ติด/รอข้อมูล

---

## สิ่งที่ยังติด / รอการยืนยัน

- [ ] **ไฟล์ fixtures** — SPEC §15 ใช้ตรวจเกณฑ์ยอมรับ (นครปฐม 30 ราย/1,737,860 · หัวหิน 76 ราย/5,770,484 · พุทธมณฑล 241 ราย/13,084,342) ยังไม่มีในโปรเจกต์ ต้องได้ก่อนจึงเขียน test เทียบตัวเลขจริงได้
- [ ] **SPEC §14 คำถามเปิด** — มี default ครบทุกข้อ เริ่มงานโครงสร้างได้ แต่ควรยืนยันข้อ 4 (`cust` นับต่อสัญญา), ข้อ 6 (รายชื่อทีมส่วนกลาง), ข้อ 7 (master ประเภทลูกค้า) ก่อนนำเข้าข้อมูลจริง

---

## แผนงาน (จาก SPEC §16)

### ต.ค. สัปดาห์ 3–4 — ตั้งระบบ
- [ ] ตั้งโปรเจกต์ Next.js (App Router) + TS strict + PWA + Noto Sans Thai
- [ ] `lib/rules/` core logic เป็น pure function + unit test (ดู CLAUDE.md "ตรรกะหลัก")
- [ ] Supabase schema + RLS ทุกตาราง (SPEC §6, §5)
- [ ] Auth / สิทธิ์ตาม role (host/admin/recorder/viewer)
- [ ] Master data: 13 เขต / 43 สาขา / ทีม / ประเภทลูกค้า
- [ ] นำเข้าสัญญาจาก Excel (หน้าจอ 7)

### พ.ย. สัปดาห์ 1–2 — กรอกข้อมูล
- [ ] ทะเบียนลูกค้า (ตารางแบบ Excel), สถานี, กรอกผลบริการ, ปุ่ม "เหมือนครั้งก่อน", หน้า "ต้องทำ"

### พ.ย. สัปดาห์ 3–4 — คำนวณ + เชื่อม Dashboard
- [ ] คำนวณ snapshot, นำเข้า legacy, Export + Auto Sync (Vercel Cron), ปิดเดือน
- [ ] ตรวจตัวเลขเขต 1 ตาม §15

### ธ.ค. — UAT + go-live
- [ ] UAT เขต 1 → นำเข้าทั้งส่วนกลาง → อบรม → go-live ธ.ค.2026/ม.ค.2027

---

## บันทึกประจำวัน (Changelog)

### 2026-10-14
- ✅ อ่าน SPEC.md v1.0 ครบ + ตรวจสถานะโปรเจกต์ (พบว่าเป็นโปรเจกต์เปล่า มีแค่ CLAUDE.md, SPEC.md)
- ✅ `git init` (branch `main`), ตั้ง identity repo-local (`13azukaoab` / oab_oabza@hotmail.com)
- ✅ สร้าง `.gitignore` (กัน fixtures ข้อมูลจริง, secrets, build output)
- ✅ เชื่อม remote + push commit แรกขึ้น `github.com/13azukaoab/AGA-Bait-Registry`
- ✅ สร้าง `task.md` (ไฟล์นี้)
- **ไฟล์ที่แตะ:** `.gitignore`, `task.md`
- **ถัดไป:** รอเจ้าของเลือกเริ่มจาก (ก) โครง Next.js (ข) lib/rules+test (ค) DB schema+RLS

---

## ไอเดีย commit message (ไว้ใช้อ้างอิง)
- `chore: initial project docs (SPEC + CLAUDE guidelines)` — commit แรก
