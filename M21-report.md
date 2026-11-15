# M21 report — ตำแหน่ง / ตำแหน่งผู้แก้ใน audit / แจ้งเตือน / division_scope อัตโนมัติ

รายงานตามแบบ 6.1 (sub ของหมวด 2 BE) · 15 พ.ย. 2026 · branch `claude/awesome-newton-46ff08`

## 1. ไฟล์ที่แตะ
| ไฟล์ | สิ่งที่ทำ |
|---|---|
| `supabase/migrations/20261115120000_positions_audit_notifications.sql` | ใหม่ — ทั้งหมดของ M21 |
| `supabase/tests/37_positions_audit_notifications.test.sql` | ใหม่ — 75 ข้อ |
| `supabase/tests/12_profiles_positions.test.sql` | **แก้ 2 จุด (BE อนุญาต)**: results_eq ของ positions (ชื่อใหม่ · กรอง `assignable`) และจำนวนตำแหน่ง 4 → 5 (เพิ่มเจ้าของ) |
| `M21-report.md` | รายงานนี้ |

ไม่ได้แตะ `components/**`, `app/(app)/**`, `lib/**` และเอกสารกลาง (`lib/admin/**` ยังไม่มีอยู่ — ยังไม่มีโค้ดสร้างผู้ใช้)

## 2. สิ่งที่ทำ
1. **positions**
   - ชื่อเต็ม `name_th` + คอลัมน์ใหม่ `short_name_th` (HQ ยืนยัน a6920c3): แอดมิน (Admin)/แอดมิน · หัวหน้างาน (Supervisor)/หัวหน้างาน · Project Manager (PM)/PM · Operation Manager (OM)/OM · เจ้าของ/เจ้าของ — code เดิมไม่เปลี่ยน · ไม่ใส่ชื่อสั้น → ใช้ชื่อเต็ม (trigger)
   - คอลัมน์ใหม่ `assignable` · ตำแหน่งใหม่ `owner` (role host, assignable = false)
   - **บังคับที่ DB:** "เส้นทาง API" (anon / authenticated / service_role / authenticator / supabase_auth_admin) ตั้ง/ถอดตำแหน่งเจ้าของไม่ได้ · แก้/ปิด/ลบบัญชีเจ้าของไม่ได้ (เจ้าของแก้แถวตัวเองได้ เช่น last_login) · แก้/ลบตำแหน่งที่ assignable = false หรือเปลี่ยนค่า assignable ไม่ได้ → error `PS001` (profiles) / `PS002` (positions)
   - ตั้งเจ้าของได้ทางเดียว: SQL Editor (role postgres) `UPDATE public.profiles SET position_code = 'owner' WHERE username = '...';`
2. **audit**: `audit_log.actor_position_code` (ไม่มี FK) · `audit_trigger` = เนื้อ M18 + จุดที่ติดป้าย M21 เท่านั้น · **เพิ่ม `audit_profiles`** (HQ ยืนยัน) เก็บเมื่อ position_code / role / is_active / division_scope / display_name / username เปลี่ยน — ไม่เก็บ last_login / must_change_password / onboarding · row_id = user_id
3. **`user_notifications`**: RLS อ่านเฉพาะของตัวเอง · ผู้ใช้ไม่มีสิทธิ์ INSERT/UPDATE/DELETE · อ่านแล้วผ่าน RPC `mark_notifications_read(p_ids uuid[] DEFAULT NULL)` (คืนจำนวนแถว · id คนอื่นไม่มีผล) · trigger แจ้ง `position_changed` เมื่อ position_code เปลี่ยน (payload: old/new code + ชื่อ) · การเปลี่ยน code ของตำแหน่ง (cascade) ไม่แจ้ง · anon ไม่มีสิทธิ์
4. **division_scope**: DEFAULT `{central,province}` + backfill ผู้ใช้เดิมทุกคน (HQ ยืนยัน · cloud มี 3 แถว)

## 3. ผลตรวจที่รันเองจริง (หลัง merge main c78270b = M22 + M23)
- `npx supabase db reset` + `npx supabase test db` → **All tests successful · Files=38, Tests=1400 · PASS**
- `npx tsc --noEmit` → exit 0
- `npx eslint . --ignore-pattern next-env.d.ts --ignore-pattern '.claude/**'` → 0 errors (7 warnings เดิม)
- `npx vitest run` → 34 files / 506 tests passed
- Security review (Opus, code-reviewer): รอบ 1 — ไม่มี Critical · High 1 ข้อ (Supabase Auth `deleteUser` cascade ลบบัญชีเจ้าของได้) **แก้แล้ว** · Low แก้ (grant service_role แบบระบุ verb, REVOKE function ครบ) · รอบ 2 (หลังแก้) — ไม่มี High/Medium ที่ DB · `audit_trigger` ต่างจาก M18 เฉพาะจุด M21 · เหลือ High ฝั่งแอป (`auth.admin.updateUserById` ดูข้อ 4) ที่ต้องใส่ใน brief route จัดการผู้ใช้

## 4. สิ่งที่ค้าง / ข้อที่รับไว้ (ไม่แก้)
- ⚠ **DB กันไม่ได้:** `auth.admin.updateUserById` (รีเซ็ตรหัส / แบน / เปลี่ยนอีเมล) ไม่แตะ `profiles` → **route ฝั่ง server ที่เรียก `auth.admin.*` กับผู้ใช้เป้าหมาย ต้องเช็ก `positions.assignable` ของผู้ใช้นั้นก่อน และปฏิเสธถ้าเป็น false**
- เทสจำลอง session ของ Supabase Auth ในเครื่องไม่ได้ (postgres ไม่มีสิทธิ์ SET SESSION AUTHORIZATION) → เทสที่เงื่อนไข `is_api_session_for()` แทน · เส้นทางจริง (Auth ลบเจ้าของ → cascade) จึงไม่มีเทสครอบ
- **ผลข้างเคียง:** ปุ่ม "Delete user" ใน Supabase Dashboard ก็ผ่าน Auth server → ลบบัญชีเจ้าของไม่ได้ (PS001) — ถ้าจำเป็นต้องลบจริง ให้ถอดตำแหน่งเจ้าของด้วย SQL ก่อน
- เปลี่ยน code ของตำแหน่ง → `audit_profiles` ลงแถว "position_code เปลี่ยน" ให้ผู้ถือทุกคน (ข้อมูลเปลี่ยนจริง) — หน้าประวัติควรเทียบ**ชื่อ**ตำแหน่ง ไม่ใช่ code ถ้าจะแสดง "เปลี่ยนตำแหน่ง"
- `actor_position_code` ของแถว profiles ที่ผู้ใช้แก้ตำแหน่งตัวเอง = ตำแหน่งหลังแก้ (AFTER trigger)
- backfill ทำให้ผู้ใช้เดิมที่เคยจำกัดเขต **อ่านและเขียน**ข้อมูลทุกเขตได้ (branch_in_scope คุมทั้งอ่าน-เขียน) — ตรงข้อ ก ที่ HQ อนุมัติ · DEFAULT แบบนี้เปิดกว้าง: ผู้ใช้ใหม่ที่ไม่ส่งค่าเห็นทุกเขต
- อัปเดตแบบหลายแถวที่โดนแถวเจ้าของ (เช่นสั่ง must_change_password ทั้งกลุ่ม) จะล้มทั้งคำสั่ง (PS001) — โค้ดต้องกรองเจ้าของออกก่อน
- การแก้ตาราง `positions` ไม่ลง audit_log (เหมือนเดิม)

## 5. กระทบ session อื่น
- **FE (หน้าจัดการผู้ใช้):**
  - `positions` SELECT ได้แถว `owner` ด้วย → dropdown ต้องกรอง `assignable = true` · ใช้ `short_name_th` ในแถบบน/ป้าย · `name_th` ในฟอร์ม
  - error `PS001` / `PS002` → ข้อความไทย "ตำแหน่งเจ้าของจัดการจากหน้านี้ไม่ได้"
  - แถบแจ้งหลัง login: `select * from user_notifications where read_at is null order by created_at desc` → กดปิด `rpc('mark_notifications_read', { p_ids: [...] })` · แสดง payload เป็นข้อความธรรมดา (ชื่อตำแหน่ง host แก้ได้ — ห้ามแสดงแบบ HTML)
  - "ตำแหน่งเดิม → ใหม่" อ่านจาก `audit_log` (table_name = 'profiles', row_id = user_id) old/new `position_code`
  - โค้ดสร้างผู้ใช้ **ห้ามส่ง `division_scope`** (ให้ได้ค่าเริ่มต้น)
- **lib/db/profiles.ts / types**: ยังไม่ได้เพิ่ม `short_name_th`, `assignable`, ตาราง `user_notifications` ใน type — FE เพิ่มตอนทำหน้าจอ
- **ทุก session ที่จะ CREATE OR REPLACE `audit_trigger`:** ต้องเริ่มจากเนื้อใน M21 (ไฟล์นี้) — เทส 37 มี GUARD 2 ข้อ ล้มทันทีถ้า `actor_position_code` หาย
- เทส 12 ถูกแก้ 2 บรรทัด (ดูข้อ 1)

## 6. Phase ที่ขยับ (ให้ coordinator ลงตาราง)
- Phase ฐานข้อมูล/สิทธิ์ (schema + RLS): **+3%** ประมาณการ — M21 ครบทั้ง 4 ข้อ ผ่าน test db ทั้งชุด
- Phase หน้าจอ (จัดการผู้ใช้/login): **+0%** — DB พร้อมให้ FE ต่อ ยังไม่มีหน้าจอ

## Commits
- `79e84d3` feat(db): M21 positions names + owner, audit actor position, user notifications, default division_scope
- `e4d689f` Merge main into M21
- `2828acc` fix(db): M21 testable API-session check, test fixes after DB run
