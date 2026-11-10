# Schema + RLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้าง PostgreSQL schema ครบทุกตารางของ AGA Bait Registry พร้อม Row Level Security ทุกตาราง, trigger (audit / ปิดเดือน / follow_up_no), และ master data seed — ผ่านเกณฑ์ยอมรับ SPEC §15 ข้อ 2–3

**Architecture:** migration แบบ idempotent-per-file ใน `supabase/migrations/` (ไฟล์ใหม่เสมอ ห้ามแก้เก่า). สิทธิ์บังคับที่ DB ด้วย RLS + helper function อ่าน role/division จาก `profiles` ของ `auth.uid()`. ตรรกะที่คำนวณได้ (follow_up_no, audit, ล็อกเดือนปิด) ทำที่ trigger ฝั่ง DB ไม่ใช่ฝั่งแอป. เกณฑ์ Tier อยู่ในตาราง `tier_rules` ไม่ hardcode.

**Tech Stack:** Supabase (PostgreSQL 15) · Supabase CLI (migration + `supabase test db` ด้วย pgTAP) · SQL ล้วน

**Spec:** [`SPEC.md`](../../SPEC.md) §4 (สาขา/เขต), §5 (บทบาท/สิทธิ์), §6 (data model), §7 (business rules), §15 (เกณฑ์ยอมรับ) · master data decisions ใน [`task.md`](../../task.md)

---

## ⚠️ ต้องยืนยันก่อน execute (ขัด SPEC / เป็นการตัดสินใจของเจ้าของ)

แผนนี้เขียนตาม **ค่าเริ่มต้นที่แนะนำ** ด้านล่าง แต่ 3 ข้อนี้กระทบ schema ควรให้เจ้าของเคาะก่อนลงมือ:

1. **ทีมต่อสัญญา — SPEC ขัดกับ mockup**
   - SPEC §6: `contracts.team_id` (ทีมเดียว) · §14 Q6 default "ทีมผูก 1 สาขา"
   - task.md (2 พ.ย.): เจ้าของเลือก **ติ๊กได้หลายทีม** (`data-teams="A,E,Z"`) เพราะงานใหญ่ส่งหลายทีมพร้อมกัน
   - **ค่าเริ่มต้นแผนนี้:** ตาราง join `contract_teams` (สัญญา ↔ ทีม แบบ many-to-many) แทน `contracts.team_id` · `visits.team_id` คงเป็นทีมเดียว (1 การเข้า = 1 ทีมบันทึก)
   - ทางเลือก: คงทีมเดียวตาม SPEC ถ้าเจ้าของยืนยัน

2. **ทดสอบ RLS ต้องใช้ Docker** — เจ้าของเลือก Supabase Cloud free เพื่อเลี่ยง Docker ตอน dev แต่การเทส schema/RLS ให้เชื่อถือได้ต้องรัน `supabase start` (local, Docker) + `supabase test db`
   - **ค่าเริ่มต้นแผนนี้:** ใช้ Docker **เฉพาะตอนรันเทส DB** (ไม่กระทบ dev ประจำวันที่ยังชี้ cloud)
   - ทางเลือก: เทส RLS บน cloud project แยกตัว (ช้ากว่า เสี่ยงลืม cleanup)

3. **term_years จำกัด 1/3 ปี** — SPEC §14 Q5 เฟส 1 รับเฉพาะ 1 และ 3 ปี · ของจริงมี 5 แถวระยะอื่น (ตกไปที่หน้านำเข้าว่า "ต้องแก้เอง")
   - **ค่าเริ่มต้นแผนนี้:** `check (term_years in (1,3))` ที่ DB
   - ทางเลือก: ไม่ล็อกที่ DB ปล่อยให้ validation ฝั่งนำเข้าจัดการ

**การตัดสินใจเล็ก (ทำเองแล้ว ไม่กระทบว่าจะสร้างอะไร):**
- `cust` นับ **ต่อสัญญา** (SPEC §14 Q4 default) — มีผลตอนทำ snapshot เฟสถัดไป ไม่ใช่ schema นี้
- เพิ่มคอลัมน์ `sale_name`, `am_name` (nullable) ใน `contracts` ไว้รองรับ Sale/AM ที่ task.md พูดถึง — ยังไม่บังคับ
- เงิน = `numeric(12,2)` · วันที่ = `date` · เวลา = `timestamptz` (เก็บ UTC แสดง Asia/Bangkok ที่แอป)

---

## Global Constraints

- **PostgreSQL 15** (Supabase) · ทุกตารางใน schema `public` · **RLS `enable` + `force` ทุกตาราง** (SPEC §5, CLAUDE.md ข้อ 1)
- ทุก migration = **ไฟล์ใหม่** ใน `supabase/migrations/` ชื่อ `<YYYYMMDDHHMMSS>_<name>.sql` ห้ามแก้ไฟล์เดิม (CLAUDE.md)
- **ห้าม hardcode เกณฑ์ Tier** — อ่านจาก `tier_rules` (CLAUDE.md ข้อ 3)
- **viewer = anon role** อ่านได้เฉพาะ `monthly_branch_snapshots` + view สรุป · ห้ามแตะตารางที่มี PII (`customers`, `contracts`, `stations`, `visits`, `station_checks`) — PDPA (SPEC §5, §15.2)
- ข้อมูลในเดือนที่ปิดแล้ว (`month_closures`) **แก้ไม่ได้** บังคับด้วย trigger/RLS (SPEC §7.7, §15.3)
- `follow_up_no` คำนวณอัตโนมัติด้วย trigger ห้ามให้ client กรอก (SPEC §7.5, CLAUDE.md ข้อ 6)
- ชื่อสาขาสะกด **ตรงกับ Dashboard ทุกตัวอักษร** (SPEC §4) · 13 เขต / 43 สาขา (central 24 + province 19)
- เขตเวลา `Asia/Bangkok` (SPEC §12) · ชื่อตาราง/คอลัมน์เป็นภาษาอังกฤษ (CLAUDE.md)
- `audit_log` เขียนด้วย trigger ทุก insert/update/delete บนตารางข้อมูล (SPEC §6, §12)

## Review Focus

1. **anon/viewer อ่านตาราง PII** → ต้องได้ 0 แถว ไม่ใช่ error (SPEC §15.2) — ครอบใน Task 9
2. **แก้ visit/station_check ในเดือนที่ปิดแล้ว** → DB ปฏิเสธ (insert/update/delete) (SPEC §15.3) — ครอบใน Task 10
3. **recorder แก้ข้อมูลสาขานอก `division_scope`** → ปฏิเสธ · ในขอบเขตแต่ต่างทีม → อนุญาต + ลง audit (SPEC §5) — ครอบใน Task 9
4. **`contract_no` ซ้ำ** (หลัง trim/uppercase) → unique violation (SPEC §11) — ครอบใน Task 5
5. **set `follow_up_no` เองจาก client** → ถูก trigger เขียนทับเสมอ ไม่ยึดค่าที่ส่งมา (SPEC §7.5) — ครอบใน Task 7

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `supabase/config.toml` | ตั้งค่า Supabase CLI (สร้างด้วย `supabase init`) |
| `supabase/migrations/<ts>_01_enums_and_reference.sql` | enum types + ตารางอ้างอิง (zones, branches, teams, customer_types, tier_rules) + seed |
| `supabase/migrations/<ts>_02_profiles_and_helpers.sql` | `profiles` + helper function (`current_role`, `current_division_scope`, `is_host`) |
| `supabase/migrations/<ts>_03_core_entities.sql` | customers, contracts, contract_teams, stations |
| `supabase/migrations/<ts>_04_service_records.sql` | visits, station_checks + trigger follow_up_no |
| `supabase/migrations/<ts>_05_ops_tables.sql` | month_closures, monthly_branch_snapshots |
| `supabase/migrations/<ts>_06_audit.sql` | audit_log + generic audit trigger ผูกทุกตารางข้อมูล |
| `supabase/migrations/<ts>_07_month_lock.sql` | trigger ล็อกการแก้ไขเดือนที่ปิดแล้ว |
| `supabase/migrations/<ts>_08_rls_policies.sql` | enable+force RLS + policy ทุกตาราง (host/admin/recorder/anon) |
| `supabase/migrations/<ts>_09_summary_view.sql` | view สรุป public สำหรับ viewer (ไม่มี PII) |
| `supabase/tests/*.sql` | pgTAP tests รันด้วย `supabase test db` |
| `supabase/seed.sql` | (ออปชัน) seed master data ซ้ำได้ตอน reset local |

> หนึ่ง migration = หนึ่ง Task เพื่อให้ reviewer อนุมัติ/ปฏิเสธแยกกันได้ · ชื่อไฟล์ใส่ลำดับ `01..09` กันสลับลำดับ

---

## Task 1: ตั้ง Supabase CLI + โครงเทส

**Files:**
- Create: `supabase/config.toml` (ผ่าน `supabase init`), `supabase/tests/00_smoke.test.sql`
- Modify: `package.json` (เพิ่ม script `db:test`, `db:reset`)

- [ ] **Step 1:** รัน `npx supabase init` (สร้าง `supabase/config.toml`) — ถ้ามี `supabase/` อยู่แล้วให้ตอบรวมเข้าของเดิม (คง `migrations/`, `README.md`)
- [ ] **Step 2:** เพิ่ม scripts ใน `package.json`: `"db:reset": "supabase db reset"`, `"db:test": "supabase test db"`
- [ ] **Step 3:** เขียน smoke test `supabase/tests/00_smoke.test.sql` (pgTAP): `SELECT plan(1); SELECT has_schema('public'); SELECT * FROM finish();`
- [ ] **Step 4:** รัน `npx supabase start && npm run db:test` — ต้องรันผ่าน (ยืนยัน Docker + pgTAP ทำงาน)
- [ ] **Step 5:** Commit
```bash
git add supabase/config.toml supabase/tests/00_smoke.test.sql package.json
git commit -m "chore: init Supabase CLI and pgTAP test harness"
```

---

## Task 2: enum types + ตารางอ้างอิง + master data seed

**Files:**
- Create: `supabase/migrations/<ts>_01_enums_and_reference.sql`, `supabase/tests/01_reference.test.sql`

**Interfaces:**
- Produces: enum `division`,`user_role`,`sale_type`,`contract_status`,`station_type`,`station_status`,`visit_type`,`termite_caste`,`snapshot_source`,`audit_action` · ตาราง `zones(id,name,sort_order)`, `branches(id,zone_id,name,division,is_active)`, `teams(id,branch_id,code,name)`, `customer_types(code,label,group_label,sort_order)`, `tier_rules(tier,min_annual,max_annual)`

- [ ] **Step 1: เขียนเทสที่ fail** `supabase/tests/01_reference.test.sql` (pgTAP) — assert:
  - `SELECT is(count(*)::int, 13) FROM zones;`
  - `SELECT is(count(*)::int, 43) FROM branches;`
  - `SELECT is(count(*)::int, 24) FROM branches WHERE division='central';`
  - `SELECT is(count(*)::int, 19) FROM branches WHERE division='province';`
  - สาขา zone 9 แยก division: `ปากช่อง`,`สระบุรี`=central · `ลพบุรี`=province (SPEC §4)
  - `tier_rules` 4 แถว: S min 0, M min 30000, L min 50000, XL min 100000
  - `customer_types` ครบ 14 ค่า 4 หมวด (task.md 2 พ.ย.)
- [ ] **Step 2:** รัน `npm run db:test` → FAIL (ตารางไม่มี)
- [ ] **Step 3:** เขียน migration: สร้าง enum ทั้งหมด, ตารางอ้างอิง, แล้ว `insert` seed
  - `zones`: เขต 1–13 (`name` = `'เขต 1'`…`'เขต 13'`, `sort_order` 1–13)
  - `branches`: 43 แถวจาก **SPEC §4 ตาราง** (ชื่อสะกดตรง Dashboard, `division` ต่อแถว, `is_active=true`)
  - `teams`: A–O, Z (ติดตั้งงานใหม่), Sup (task.md) — เฟส 1 ผูกสาขา = null ได้ (ทีมส่วนกลาง) หรือกำหนดภายหลัง
  - `customer_types`: 14 ค่า 4 หมวด (task.md: ที่พักอาศัย/ธุรกิจ-อุตสาหกรรม/บริการ-สาธารณะ/อื่นๆ) — `code` สั้นภาษาอังกฤษ, `label` ไทย
  - `tier_rules`: 4 แถว (min/max annual ตาม SPEC §7.1)
- [ ] **Step 4:** รัน `npm run db:test` → PASS
- [ ] **Step 5:** Commit `feat: add enums, reference tables and master data seed`

---

## Task 3: profiles + helper functions

**Files:**
- Create: `supabase/migrations/<ts>_02_profiles_and_helpers.sql`, `supabase/tests/02_profiles.test.sql`

**Interfaces:**
- Consumes: enum `user_role`, `division` (Task 2)
- Produces: ตาราง `profiles(user_id PK → auth.users, display_name, role user_role, division_scope division[], team_id → teams)` · function `public.current_role() returns user_role`, `public.current_division_scope() returns division[]`, `public.is_host() returns boolean` (ทั้งหมด `security definer`, อ่านจาก `profiles` ของ `auth.uid()`)

- [ ] **Step 1: เขียนเทสที่ fail** — assert `profiles` มีคอลัมน์ครบ, function `is_host()` คืน boolean, `current_division_scope()` คืน `division[]`
- [ ] **Step 2:** รัน → FAIL
- [ ] **Step 3:** เขียน migration: ตาราง `profiles` (`division_scope` เป็น `division[]` รองรับหลายหน่วยงาน, เฟส 1 = `{central}`) + helper functions `security definer` (ใช้ใน RLS policy ภายหลัง เลี่ยง recursion)
- [ ] **Step 4:** รัน → PASS
- [ ] **Step 5:** Commit `feat: add profiles table and role/division helper functions`

---

## Task 4: customers

**Files:**
- Create: `supabase/migrations/<ts>_03_core_entities.sql` (ส่วน customers), `supabase/tests/03_customers.test.sql`

**Interfaces:**
- Consumes: `branches` (Task 2), `customer_types` (Task 2)
- Produces: ตาราง `customers(id, branch_id → branches, name, address, phone, contact_name, customer_type → customer_types.code, created_at, updated_at)`

- [ ] **Step 1: เขียนเทสที่ fail** — assert คอลัมน์ครบ + FK `branch_id`, `customer_type` ถูกต้อง
- [ ] **Step 2:** รัน → FAIL
- [ ] **Step 3:** เขียน DDL `customers` (ข้อมูล PII — RLS Task 9 จะล็อก viewer)
- [ ] **Step 4:** รัน → PASS
- [ ] **Step 5:** Commit `feat: add customers table`

---

## Task 5: contracts + contract_teams + stations

**Files:**
- Modify: `supabase/migrations/<ts>_03_core_entities.sql` (ต่อจาก Task 4 — ไฟล์เดียวกัน รวมใน migration เดียว)
- Create: `supabase/tests/04_contracts_stations.test.sql`

**Interfaces:**
- Consumes: `customers` (Task 4), `teams` (Task 2), enum `sale_type`,`contract_status`,`station_type`,`station_status`
- Produces: `contracts(id, customer_id → customers, contract_no unique, start_date, end_date, term_years smallint, value_total numeric(12,2), sale_type, site_plan_ig, site_plan_ic, status contract_status default 'active', sale_name, am_name, cancelled_at, closed_at, created_at, updated_at)` · `contract_teams(contract_id → contracts, team_id → teams, primary key(contract_id,team_id))` · `stations(id, contract_id → contracts, code, type station_type, installed_at, status station_status default 'active', removed_at, collected_at, created_at, updated_at)`

- [ ] **Step 1: เขียนเทสที่ fail** — assert:
  - `contract_no` มี unique constraint
  - `check (term_years in (1,3))` (ดู ยืนยันข้อ 3)
  - insert สัญญา `contract_no` ซ้ำ → error (Review Focus #4): `SELECT throws_ok($$ insert ... duplicate contract_no $$);`
  - `contract_teams` เป็น many-to-many (PK คู่)
- [ ] **Step 2:** รัน → FAIL
- [ ] **Step 3:** เขียน DDL `contracts`, `contract_teams`, `stations` (FK on delete restrict — ไม่ลบลูกค้า/สัญญาอัตโนมัติ, SPEC §7.8)
- [ ] **Step 4:** รัน → PASS
- [ ] **Step 5:** Commit `feat: add contracts, contract_teams and stations tables`

---

## Task 6: visits + station_checks + follow_up_no trigger

**Files:**
- Create: `supabase/migrations/<ts>_04_service_records.sql`, `supabase/tests/05_service_records.test.sql`

**Interfaces:**
- Consumes: `contracts`,`stations`,`teams`, enum `visit_type`,`termite_caste`
- Produces: `visits(id, contract_id, visit_date, visit_type, team_id → teams, duration_min, internal_inspection bool, signed_by_proxy bool, timber_pcs, bait_ig_ic_g, bait_ag_g, powder_chemical, first_install bool, note, created_by → auth.users, created_at)` · `station_checks(id, visit_id → visits, station_id → stations, follow_up_no int, termite_caste termite_caste null, bait_added_g int check (bait_added_g % 50 = 0), note)` · trigger `set_follow_up_no` (before insert → คำนวณลำดับการตรวจของ station นั้นเรียงตาม visit_date, SPEC §7.5)

- [ ] **Step 1: เขียนเทสที่ fail** (SPEC §15.6 + Review Focus #5):
  - สถานี A ตรวจ 2 ครั้ง → `follow_up_no` = 1,2 ตามลำดับวัน
  - สถานี A (ติด ม.ค.) กับ B (ติด มี.ค.) ตรวจเดือน พ.ค. → F ของแต่ละสถานีนับแยกถูกต้อง
  - ส่ง `follow_up_no=99` จาก insert → trigger เขียนทับเป็นค่าที่ถูก (ไม่ยึด 99)
  - `bait_added_g=75` → check violation (ต้อง step 50)
- [ ] **Step 2:** รัน → FAIL
- [ ] **Step 3:** เขียน DDL + trigger `set_follow_up_no` (นับ `count(*)+1` ของ station_checks ของ station เดียวกันที่ visit_date ก่อนหน้า)
- [ ] **Step 4:** รัน → PASS
- [ ] **Step 5:** Commit `feat: add visits, station_checks and auto follow_up_no trigger`

---

## Task 7: month_closures + monthly_branch_snapshots

**Files:**
- Create: `supabase/migrations/<ts>_05_ops_tables.sql`, `supabase/tests/06_ops.test.sql`

**Interfaces:**
- Consumes: `branches`, enum `snapshot_source`
- Produces: `month_closures(month_key text PK, closed_by → auth.users, closed_at, reopened_by, reopened_at)` · `monthly_branch_snapshots(month_key, branch_id → branches, source snapshot_source, s1,s3,m1,m3,l1,l3,xl1,xl3 int, cust int, vS,vM,vL,vXL numeric(14,2), value numeric(14,2), value_annual numeric(14,2), primary key(month_key, branch_id))`

- [ ] **Step 1: เขียนเทสที่ fail** — assert คอลัมน์ 16 ฟิลด์ตรง SPEC §9.1 + `value_annual`, PK คู่ `(month_key,branch_id)`
- [ ] **Step 2:** รัน → FAIL
- [ ] **Step 3:** เขียน DDL (รูปแบบตรง SPEC §9.1 — ห้ามเปลี่ยน key/ฟิลด์)
- [ ] **Step 4:** รัน → PASS
- [ ] **Step 5:** Commit `feat: add month_closures and monthly_branch_snapshots tables`

---

## Task 8: audit_log + generic audit trigger

**Files:**
- Create: `supabase/migrations/<ts>_06_audit.sql`, `supabase/tests/07_audit.test.sql`

**Interfaces:**
- Consumes: enum `audit_action`
- Produces: `audit_log(id, table_name, row_id, action audit_action, old_data jsonb, new_data jsonb, changed_by → auth.users, changed_at)` · function `public.audit_trigger()` ผูกเป็น `after insert/update/delete` กับ `customers,contracts,stations,visits,station_checks,contract_teams`

- [ ] **Step 1: เขียนเทสที่ fail** — insert/update/delete 1 ลูกค้า → มี 3 แถวใน `audit_log` action ตรง, `changed_by` = `auth.uid()`
- [ ] **Step 2:** รัน → FAIL
- [ ] **Step 3:** เขียน function `audit_trigger()` (`security definer`, อ่าน `auth.uid()`) + attach trigger ทุกตารางข้อมูล
- [ ] **Step 4:** รัน → PASS
- [ ] **Step 5:** Commit `feat: add audit_log and generic audit trigger`

---

## Task 9: RLS enable + policies ทุกตาราง

**Files:**
- Create: `supabase/migrations/<ts>_08_rls_policies.sql`, `supabase/migrations/<ts>_09_summary_view.sql`, `supabase/tests/08_rls.test.sql`

**Interfaces:**
- Consumes: helper `is_host()`,`current_role()`,`current_division_scope()` (Task 3) · ทุกตาราง (Task 2–8)
- Produces: `enable row level security` + `force` ทุกตาราง + policy ตาม role · view `public.v_branch_summary` (ไม่มี PII) grant ให้ `anon`

- [ ] **Step 1: เขียนเทสที่ fail** (SPEC §15.2 + Review Focus #1,#3):
  - ตั้ง role `anon` → `select` จาก `customers`/`contracts`/`stations`/`visits`/`station_checks` ได้ **0 แถว**
  - `anon` → `select` จาก `monthly_branch_snapshots` / `v_branch_summary` ได้ข้อมูล
  - recorder (`division_scope={central}`) แก้ visit ของสาขา central = ได้ · ของสาขา province = ปฏิเสธ
  - admin เพิ่มลูกค้าในสาขานอก scope = ปฏิเสธ · host = ได้ทุกอย่าง
- [ ] **Step 2:** รัน → FAIL
- [ ] **Step 3:** เขียน policy ต่อ role (SPEC §5):
  - **host:** ทุกตาราง ทุก action (`is_host()`)
  - **admin:** read ทุกสาขา · write (`customers`,`contracts`,`contract_teams`,`stations`) เฉพาะ branch ใน `division_scope`
  - **recorder:** read ทุกสาขา · write (`visits`,`station_checks`) เฉพาะ branch ใน `division_scope`
  - **anon (viewer):** select เฉพาะ `monthly_branch_snapshots` + `v_branch_summary` · ไม่มี policy บนตาราง PII (= 0 แถว)
  - `tier_rules`,`customer_types`,`teams`,`zones`,`branches`: read ให้ authenticated · write เฉพาะ host
- [ ] **Step 4:** รัน → PASS
- [ ] **Step 5:** Commit `feat: enable RLS and add per-role policies + public summary view`

---

## Task 10: บังคับล็อกเดือนที่ปิดแล้ว

**Files:**
- Create: `supabase/migrations/<ts>_07_month_lock.sql`, `supabase/tests/09_month_lock.test.sql`

> หมายเหตุลำดับไฟล์: migration นี้ตั้งชื่อ `07_` ให้รันก่อน `08_rls` แต่พัฒนา/เทสหลัง RLS เพื่อทดสอบรวมกับสิทธิ์จริง

**Interfaces:**
- Consumes: `month_closures`, `visits`, `station_checks`
- Produces: trigger `block_closed_month()` (before insert/update/delete บน `visits`,`station_checks`) — ถ้าเดือนของแถว (`visit_date`) อยู่ใน `month_closures` ที่ยังไม่ `reopened` → `raise exception` · ยกเว้น host

- [ ] **Step 1: เขียนเทสที่ fail** (SPEC §15.3 + Review Focus #2):
  - ปิดเดือน `2026-09` แล้ว insert/update/delete visit ที่ `visit_date` ในเดือนนั้น → ปฏิเสธทั้ง 3
  - เปิดเดือนใหม่ (`reopened_at`) → แก้ได้อีกครั้ง
  - เดือนที่ยังไม่ปิด → แก้ได้ปกติ
- [ ] **Step 2:** รัน → FAIL
- [ ] **Step 3:** เขียน trigger `block_closed_month()` (เช็ค `month_closures` ที่ `reopened_at is null`)
- [ ] **Step 4:** รัน `npm run db:test` ทั้งชุด → PASS ทุกไฟล์
- [ ] **Step 5:** Commit `feat: block edits to closed months via trigger (SPEC 7.7)`

---

## Self-review (ทำแล้ว)

1. **Spec coverage:** §4 สาขา/เขต (Task 2) ✓ · §5 บทบาท/สิทธิ์ (Task 3,9) ✓ · §6 ทุกตาราง (Task 2–8) ✓ · §7.5 follow_up_no (Task 6) ✓ · §7.7 ปิดเดือน (Task 10) ✓ · §7.8 lifecycle คอลัมน์ `collected_at`/`status` (Task 5) ✓ · §9.1 snapshot 16 ฟิลด์ (Task 7) ✓ · §15.2 (Task 9) ✓ · §15.3 (Task 10) ✓ · §15.6 F แยกสถานี (Task 6) ✓ · snapshot **คำนวณ** (buildBranchSnapshot) = lib/rules + เฟสถัดไป ไม่อยู่ในแผน schema นี้
2. **Step scan:** ทุก step มีผลตรวจได้ (เทส/DDL/คำสั่ง) — DDL ใส่เฉพาะ decision (type/constraint/FK) ที่ SPEC ไม่ได้ pin
3. **Type consistency:** enum + ชื่อตาราง/คอลัมน์/helper (`is_host`,`current_division_scope`) ใช้ตรงกันทุก task · `contract_teams` แทน `team_id` สอดคล้องทั้ง Task 5 และ 9
4. **Review Focus:** 5 ข้อมี task เจ้าของเทสครบ (#1,#3→T9 · #2→T10 · #4→T5 · #5→T6)
5. **Proportion:** แผนสั้นกว่าการ transcribe DDL ทั้งหมด — อ้าง SPEC §4/§6 สำหรับรายการ field, ใส่เฉพาะ decision

**เบี่ยงจาก SPEC (ยกไปหัวข้อ "ต้องยืนยัน"):** `contract_teams` แทน `contracts.team_id` · เทส RLS ต้อง Docker · `check term_years in (1,3)`
