# CLAUDE.md — AGA Bait Registry

ระบบทะเบียนบริการ Bait ของ AGA (ส่วนกลาง 24 สาขา, รองรับ 43 สาขา) แทน Excel ทะเบียนรายสาขา และป้อนข้อมูลให้ AGA Bait Dashboard

**อ่าน `SPEC.md` ก่อนเริ่มงานทุกครั้ง** — เป็นแหล่งข้อมูลหลักของข้อกำหนด ถ้าโค้ดกับ SPEC ขัดกัน ให้ถามเจ้าของก่อนแก้ ห้ามเดาเอง

## Stack
- Next.js (App Router) + TypeScript (strict) · PWA
- Supabase: PostgreSQL + RLS + Auth + Storage
- Deploy: Vercel · Scheduled job: Vercel Cron
- Dashboard ปลายทาง: repo `13azukaoab/AGA-Bait-Dashboard` บน Netlify (อย่าแก้ repo นั้น นอกจากไฟล์ข้อมูลตาม SPEC §9)

## ภาษาและการสื่อสาร
- UI ภาษาไทยทั้งหมด ฟอนต์ **Noto Sans Thai**
- ชื่อตาราง/ฟิลด์/ตัวแปร/commit message ใช้ภาษาอังกฤษ
- อธิบายงานกับเจ้าของเป็นภาษาไทย กระชับ ศัพท์เทคนิคใช้อังกฤษได้
- ถ้าไม่แน่ใจความต้องการ ให้เสนอตัวเลือกให้เจ้าของเลือก อย่าตัดสินใจเรื่องใหญ่เอง
- ก่อนแก้ไขขนาดใหญ่ (schema, สิทธิ์, สูตรคำนวณ) ให้สรุปสิ่งที่จะทำให้เจ้าของยืนยันก่อน

## กฎที่ห้ามละเมิด
1. **RLS เปิดทุกตาราง** สิทธิ์บังคับที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม (SPEC §5)
2. **role `viewer` ห้ามอ่านตาราง `customers`, `contracts`, `stations`, `visits`, `station_checks`** (PDPA) ให้อ่านได้เฉพาะ `monthly_branch_snapshots` / view สรุป
3. **ห้าม hardcode เกณฑ์ Tier** — อ่านจาก `tier_rules` เสมอ
4. **รูปแบบ `dashboard_data.json` ห้ามเปลี่ยน** (key เดือน `MMM.YY`, 16 ฟิลด์ต่อแถว, ครบ 43 สาขาทุกเดือน, ชื่อสาขาสะกดตรงกับ Dashboard)
5. **เดือนบริการ = เดือนเริ่ม + (ปี × 12) เดือน** ไม่คำนวณจากวันสิ้นสุด (SPEC §7.2)
6. **F1–F10 นับต่อสถานี** ไม่ใช่ต่อลูกค้า และคำนวณอัตโนมัติ ไม่ให้ผู้ใช้กรอก (SPEC §7.5)
7. ข้อมูลในเดือนที่ปิดแล้ว (`month_closures`) แก้ไม่ได้ — บังคับด้วย RLS/trigger
8. ห้าม commit secret (Supabase service key, GitHub token) — ใช้ env ของ Vercel เท่านั้น
9. เขตเวลา `Asia/Bangkok` · cron เขียนเป็น UTC (06:00 ไทย = `0 23 * * *`)

## ตรรกะหลักที่ต้องมี unit test
อยู่ใน `lib/rules/` เป็น pure function แยกจาก UI/DB เพื่อทดสอบได้ง่าย
- `annualValue(valueTotal, termYears)`
- `tierOf(annualValue, rules)` → `S | M | L | XL`
- `serviceMonths(startDate, termYears)` → รายการ `YYYY-MM`
- `defaultEndDate(startDate, termYears)` = วันเริ่ม + N ปี − 1 วัน
- `isMissedService(contract, month, visits)` (SPEC §7.4)
- `buildBranchSnapshot(contracts, month, rules)` → แถวรูปแบบ Dashboard
- `monthKey(date)` → `SEP.26`

กรณีทดสอบบังคับ (จาก SPEC):
- 50,000 / 3 ปี → S3 · 150,000 / 1 ปี → XL1 · 150,000 / 3 ปี → L3 · 29,999.50 / 1 ปี → S1
- 15/01/2026, 1 ปี → Jan 2026 – Dec 2026
- 03/04/2026, 1 ปี → Apr 2026 – Mar 2027
- 01/01/2026, 3 ปี → Jan 2026 – Dec 2028 (36 เดือน)
- สถานี A ติด ม.ค., สถานี B ติด มี.ค. → ตรวจเดือน พ.ค. ได้ F ของแต่ละสถานีแยกกัน

## ข้อมูลอ้างอิง (fixtures)
- `fixtures/dashboard_data.json` — ข้อมูล Dashboard เดิม JAN.25–SEP.26 ใช้นำเข้า legacy และเทียบรูปแบบ
- `fixtures/zone1_registry.*` — ทะเบียนเขต 1 ใช้ทดสอบเกณฑ์ยอมรับ SPEC §15 (นครปฐม 30 ราย / 1,737,860 · หัวหิน 76 ราย / 5,770,484)
- ไฟล์ fixtures มีข้อมูลลูกค้าจริง — **ห้าม commit ขึ้น repo สาธารณะ** ใส่ใน `.gitignore`

## Workflow
- Migration ของ Supabase เก็บใน `supabase/migrations/` ทุกการเปลี่ยน schema ต้องเป็น migration ใหม่ ห้ามแก้ไฟล์เก่า
- รัน type check + lint + test ก่อนบอกว่างานเสร็จ
- แจ้งเจ้าของเมื่อเจอข้อขัดแย้งกับ SPEC หรือคำถามใน SPEC §14 ที่ต้องตอบก่อนทำต่อ
