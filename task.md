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

## 🔜 ทำต่อได้เลย (resume จุดที่ค้าง ณ 15 ต.ค. 2026)

**เริ่มงานถัดไป:**
1. **เขียนโค้ด `lib/rules`** ตามแผน TDD → [docs/plans/2026-10-15-lib-rules.md](docs/plans/2026-10-15-lib-rules.md) (Task 0 ตั้งโครง TS+Vitest → ไล่ทีละ task)
2. **ชุดงาน mockup/SPEC ที่ค้าง:** สรุปการใช้วัสดุแยกสาขา/ช่วงเวลา (เหยื่อ NEMESIS + เคมีผง + ไม้ล่อ มี filter) · เคมีผง summary

**ตัดสินใจก่อนลงข้อมูลจริง:**
- "ไม่พบปลวก" ใน dropdown สัดส่วนปลวก → ใช้ null หรือเพิ่มเป็นตัวเลือก
- ตารางหน้ารอเก็บสถานี → แยกคอลัมน์ IG/IC ไหม
- `cust` นับต่อสัญญา/ต่อลูกค้า (SPEC §14 ข้อ 4)
- ต้องได้ไฟล์ `fixtures/zone1_registry.*` เพื่อเทสเกณฑ์ยอมรับ §15

**a11y/security (เก็บไว้ตอน build Next.js):** nav/row ต้องคีย์บอร์ดได้ · aria-label ช่องตาราง · contrast `--fg-faint` · viewer public ล็อก RLS anon (PDPA)

**ลิงก์อ้างอิง:**
- mockup prototype (Artifact): https://claude.ai/artifact/KKDbURTPNifT9d3kHfPKZG
- dashboard ปลายทางจริง: https://aga-bait-dashboard.netlify.app/?m=SEP.26

> **วิธีทำต่อพรุ่งนี้:** เปิด session เดิมนี้จาก sidebar ของแอป (context ครบ ทำต่อได้ทันที) · หรือถ้าเปิด session ใหม่ ให้อ่าน `CLAUDE.md` → `SPEC.md` → `task.md` (ไฟล์นี้) → แผน lib/rules แล้วเริ่มได้เลย

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

### 2026-10-15 (รอบบ่าย — mockup + SPEC v1.1)
- ✅ ทำ prototype 6 หน้าจอ (Artifact) ผ่านหลายรอบ feedback: หน้าต้องทำ+แดชบอร์ดสถานะงาน, กรอกผล IG/IC (exception + สรุปสถานี), กล่องเหยื่อ AG (S/F/รอถอด/ถอด + สรุปเหยื่อ), รอเก็บสถานี (หมดสัญญา), ทะเบียน, สรุป viewer
- ✅ ช่องค้นหากลางบน header (ชื่อ/เลขสัญญา, fuzzy) + filter มาตรฐาน เขต/สาขา/ทีม ทุกหน้า
- ✅ ทำ flow การทำงาน 5 บทบาท (ยืนยันทีมบริการอยู่นอกระบบ, viewer public)
- ✅ **อัปเดต SPEC → v1.1**: เหยื่อ step 50, สัดส่วนปลวก 6 ค่า, exception entry, AG workflow, lifecycle เก็บสถานีก่อนปิดสัญญา, viewer public, สัญญาใกล้หมด 90 วัน (ดู SPEC §17)
- **ไฟล์ที่แตะ:** `SPEC.md` (v1.1), `task.md` · mockup = Artifact (ไม่อยู่ใน repo)
- **ค้าง:** ตัดสินใจเพิ่ม "ไม่พบปลวก" ใน dropdown สัดส่วนหรือใช้ null · แล้วเริ่มเขียนโค้ด lib/rules

### 2026-10-15
- ✅ ทำ flow chart ระบบ 5 ขั้น + จัดลำดับงานที่ควรสร้าง (เริ่มจาก lib/rules)
- ✅ ทำ prototype/mockup 4 หน้าจอหลัก (ต้องทำ, กรอกผลบริการ+ตรวจสถานี, ทะเบียน, สรุป viewer) เป็น HTML ไฟล์เดียว (Artifact) ให้รีวิวทิศทาง UI ก่อน code
- ✅ ปรับหน้าตรวจสถานี รองรับลูกค้าที่มีสถานีจำนวนมาก (เช่น AG 100 กล่อง): ตารางกะทัดรัด + bulk action + สรุป + แบ่งหน้า
- ✅ สร้าง `README.md`: ภาพรวมโปรเจกต์, 13 เขต/43 สาขา, ชนิดสถานี (IG/IC ตรวจทุกเดือน · AG แก้ปัญหาปลวก), เกณฑ์ Tier
- **ไฟล์ที่แตะ:** `README.md` (ใหม่), `task.md`
- **ค้าง:** งานเขียนโค้ด `lib/rules` + unit test พักไว้ รอปิดรีวิว mockup ก่อน

### 2026-10-14
- ✅ อ่าน SPEC.md v1.0 ครบ + ตรวจสถานะโปรเจกต์ (พบว่าเป็นโปรเจกต์เปล่า มีแค่ CLAUDE.md, SPEC.md)
- ✅ `git init` (branch `main`), ตั้ง identity repo-local (`13azukaoab` / oab_oabza@hotmail.com)
- ✅ สร้าง `.gitignore` (กัน fixtures ข้อมูลจริง, secrets, build output)
- ✅ เชื่อม remote + push commit แรกขึ้น `github.com/13azukaoab/AGA-Bait-Registry`
- ✅ สร้าง `task.md` (ไฟล์นี้)
- ✅ ปรับ `CLAUDE.md` ให้ตรง project (เดิมบน disk เป็นกฎบอท LINE คนละ project) — รวมฐาน registry + กฎ generic ดีๆ (commit discipline, Vercel deploy, root-cause debug, team handoff, UI mockup)
- **ไฟล์ที่แตะ:** `.gitignore`, `task.md`, `CLAUDE.md`
- **ถัดไป:** รอเจ้าของเลือกเริ่มจาก (ก) โครง Next.js (ข) lib/rules+test (ค) DB schema+RLS

---

## ไอเดีย commit message (ไว้ใช้อ้างอิง)
- `chore: initial project docs (SPEC + CLAUDE guidelines)` — commit แรก
