# แบบ: บันทึกหน้าเปิดงานเป็นก้อนเดียว + กันลูกค้าซ้ำ + ไฟล์ค้าง (หมวด 2 BE · 12 พ.ย. 2026)

อ่านแล้ว: `components/customers-new/save.ts`, `files.ts`, `uploadAfterSave.ts`, `data.ts` · migration `customers`, `rls_policies`, `admin_delete_policies`, `contract_files`, `contracts_job_opening_fields` · `vercel.json`

## ข้อเท็จจริงที่เจอ (มีผลต่อแบบ)
- `save.ts` ตอนนี้ **สร้างใหม่อย่างเดียว ไม่มีทางแก้แถว** (หน้าจอเรียกแค่ `saveDraft` กับ `deleteContract`)
- ลูกค้าเดิม: หาด้วย `name` ตรงตัว แล้ว **ใช้รายเดิมเงียบๆ** — "คุณสมชาย" 2 บ้านในสาขาเดียวจะถูกรวมเป็นลูกค้าคนเดียวโดยไม่ถาม (บั๊กอีกทิศ นอกจากซ้ำ)
- RLS `customers_select` ให้ host/admin/recorder **อ่านลูกค้าได้ทุกสาขา** (เขียนเท่านั้นที่ติดขอบเขต) → เฟส 1 ไม่มีลูกค้าที่ admin "มองไม่เห็น"
- policy ลบ object ใน bucket ต้องให้ `contract_files_writable(contract_id)` ผ่าน = ต้องมีแถวสัญญาอยู่ · policy อ่าน bucket ไม่ตรวจว่ายังมีแถว `contract_files` (พนักงานที่รู้ path สร้าง signed URL ของไฟล์ที่ลบแถวแล้วได้ — path สุ่ม เสี่ยงต่ำ แต่ควรปิด)

## 1) RPC บันทึกเป็นก้อนเดียว (ทางเดียวที่ถูก ไม่ต้องเลือก)
`public.save_job_opening(...)` → คืน `contract_id, customer_id, reused_customer`
- plpgsql · **SECURITY INVOKER** (RLS ของผู้เรียกทำงานทุกคำสั่ง ไม่ใช้ service role) · 1 การเรียก = 1 transaction → ล้มตรงไหนย้อนทั้งหมด
- พารามิเตอร์แยกชนิดชัด: `p_contract_id` (null = สร้าง · มีค่า = แก้) · `p_branch_id` · `p_customer_name` · `p_customer_type` · `p_customer_id` (เลือกรายเดิม) · `p_confirm_new_customer` · ช่องสัญญาทั้งหมดรวม M9 · `p_team_ids uuid[]`
- ลำดับ: ตรวจข้อมูล → หา/สร้างลูกค้า (ข้อ 2) → insert/update สัญญา → ทีม (แก้แถว = ลบทีมที่หาย + เพิ่มทีมใหม่)
- โหมดแก้: แก้ได้เฉพาะสัญญา + ทีม · ไม่แก้ชื่อลูกค้าผ่านหน้านี้ (กระทบสัญญาอื่นของลูกค้าคนเดียวกัน)
- คู่กัน: `public.delete_job_opening(p_contract_id)` (INVOKER) = ตรวจไม่มีผลบริการ → ลบสัญญา (CASCADE) → ลบลูกค้าที่ไม่เหลือสัญญา
- audit: trigger เดิมทำงานทุกคำสั่งข้างใน
- สิทธิ์: REVOKE จาก PUBLIC + anon · GRANT EXECUTE ให้ authenticated
- error ใหม่: `AG001` พบลูกค้าชื่อนี้ในสาขาแล้ว · `AG002` ลูกค้าที่เลือกไม่อยู่สาขานี้ · `AG003` ลบไม่ได้เพราะมีผลบริการ · เดิม: `23505` เลขสัญญาซ้ำ · `42501` นอกขอบเขต · `P0001` Renew คนละลูกค้า · `23514` ไม่ผ่านเงื่อนไข

## 2) กันลูกค้าซ้ำ — ให้เจ้าของเลือก
ทุกทาง: คอลัมน์ `customers.name_key` = ชื่อจัดรูป (function IMMUTABLE) + index (`branch_id`, `name_key`)
จัดรูป: ตัดช่องว่างหัวท้าย · ช่องว่างซ้ำเหลือช่องเดียว · ลบอักขระมองไม่เห็น (U+200B, NBSP) · อังกฤษพิมพ์เล็ก · **ไม่ตัดคำนำหน้า** (คุณ / บริษัท / บจก.)
- (ก) UNIQUE (`branch_id`, `name_key`) — ซ้ำไม่ได้แน่นอน · แต่คนชื่อเดียวกันจริงในสาขาเดียวบันทึกไม่ได้ ต้องแต่งชื่อให้ต่าง · นำเข้าข้อมูลเก่าที่ชื่อซ้ำไม่ผ่าน
- (ข) เตือน + ต้องยืนยัน (แนะนำ) — ตรงกัน → `AG001` + รายชื่อที่ตรง → ผู้ใช้เลือก "ใช้รายเดิม / คนละราย" · กันกดพร้อมกันด้วย `pg_advisory_xact_lock(สาขา+name_key)` · ไม่บล็อกคนชื่อซ้ำจริง แก้บั๊กรวมคนเงียบๆ ไปด้วย · ถ้าผู้ใช้กดผิดก็ซ้ำได้ (ลง audit)
- (ค) (ข) + เตือนชื่อคล้าย (`pg_trgm` ≥ 0.8 ในสาขา) — จับได้มากสุด แต่ถามบ่อย ต้องจูนเกณฑ์กับข้อมูลจริง
- อนาคตถ้าจำกัดการอ่านลูกค้า: function SECURITY DEFINER คืนแค่ มี/ไม่มี + จำนวน ไม่คืน PII

## 3) ไฟล์ค้างใน Storage
- ฐานข้อมูลเป็นตัวตั้ง แอปเลิกลบ object เอง
- ตาราง `storage_deletion_queue` (bucket, path, enqueued_at, attempts, last_error, done_at) · RLS เปิด · ไม่ GRANT ให้ anon/authenticated · service_role เท่านั้น
- trigger SECURITY DEFINER บน `contract_files`: AFTER DELETE ลงคิว path (ครอบ CASCADE) · AFTER UPDATE OF storage_path ลงคิว path เก่า
- งานลบฝั่ง server (service role key ใน env Vercel + `CRON_SECRET`): ดึงคิว ≤100 → ตรวจว่าไม่มีแถวใช้ path แล้ว → remove → list ยืนยันว่าหายจริง → ปิดงาน / +attempts (≤5 แล้วค้างให้ host เห็น) · ลบเฉพาะ path ในคิว
- แก้ policy อ่าน bucket: เปิดได้เฉพาะ object ที่ยังมีแถว `contract_files`
- cron: (3ก) route BE ใหม่ `app/api/cron/storage-cleanup` + cron ตัวที่ 2 ใน `vercel.json` (ของหมวด 3 · เช็กโควตาแผน Vercel) — แนะนำ · (3ข) ต่อท้าย `/api/cron/sync` ของหมวด 4

## 4) ผลต่อหน้าจอ (หมวด 1 · BE ไม่แตะ `components/**`, `app/(app)/**`)
- `save.ts` → `rpc('save_job_opening')` / `rpc('delete_job_opening')` ลบโค้ด rollback ฝั่ง client
- กล่องถาม "ใช้รายเดิม / คนละราย" เมื่อได้ `AG001`
- `files.ts`: ลบไฟล์ = ลบแถวอย่างเดียว · เปลี่ยน PDF ไม่ต้องลบ object เก่า
- `describeDbError`: ข้อความไทยของ `AG001`–`AG003`

## 5) ขั้นที่ 2 (หลังอนุมัติ)
migration ใหม่ 2 ไฟล์ + pgTAP เขียนเทสก่อน (ก้อนเดียวจริง · 42501 นอกขอบเขต · anon เรียกไม่ได้ · กดพร้อมกันไม่ซ้ำ · ลบสัญญาแล้วเข้าคิว · ลบไม่ผ่านไม่เข้าคิว · authenticated แตะคิวไม่ได้) + route ลบไฟล์ + unit test · ไม่ส่ง cloud · ใช้ DB local แจ้งศูนย์กลางก่อน/หลัง

## ต้องให้เจ้าของเลือก
1. กันลูกค้าซ้ำ ก / ข / ค (แนะนำ ข)
2. งานลบไฟล์ 3ก / 3ข (แนะนำ 3ก)
3. ต้องมี "แก้แถวที่บันทึกแล้ว" รอบนี้ไหม (หน้าจอยังไม่มี)

## ผลตัดสิน (เจ้าของ 12 พ.ย. 2026: "เอาตามที่แนะนำ")
- กันลูกค้าซ้ำ = **(ข)** เตือน + ต้องยืนยัน "ใช้รายเดิม / คนละราย" + advisory lock
- งานลบไฟล์ = **(3ก)** route ของ BE `app/api/cron/storage-cleanup` + cron ตัวที่ 2 ใน `vercel.json` (หมวด 3 เพิ่มหลังรวม)
- RPC รองรับโหมดแก้แถวด้วย

## สิ่งที่ทำจริง (ขั้นที่ 2 · branch `be/job-opening-save`)
- migration `20261112110000_job_opening_save_rpc.sql` · `20261112110100_storage_deletion_queue.sql`
- pgTAP `22_job_opening_save_rpc` (47) · `23_storage_deletion_queue` (18) · แก้ `17_contract_files` 1 ข้อ (กฎอ่าน bucket ที่ตั้งใจปิด)
- `lib/storage/cleanup.ts` (+ test) · `lib/storage/supabasePorts.ts` · `lib/supabase/admin.ts` · `app/api/cron/storage-cleanup/route.ts`

### ต่างจากแบบข้างบน (เจอตอนทดสอบกับ Storage จริง)
1. policy อ่าน bucket มีข้อยกเว้น: **ผู้อัปโหลดเห็นไฟล์ของตัวเองที่อัปโหลดไม่เกิน 1 ชั่วโมง** แม้ยังไม่มีแถว — ถ้ามองไม่เห็น `remove()` คืน `[]` เงียบๆ แอปจะลบไฟล์ที่อัปโหลดแล้วเขียนแถวไม่สำเร็จไม่ได้
2. `delete_job_opening` ตรวจตาม round 1.1 ของหน้าจอ: สัญญาปิด/ยกเลิก → `AG005` · มี visits หรือ station_checks → `AG003` · ไม่พบ → `AG004`
3. RPC คืน `existing_customer_type` เมื่อใช้ลูกค้าเดิม (หน้าจอใช้ `customerTypeMismatch()` เดิมต่อ) · ไม่เขียนทับประเภทลูกค้า
4. แก้แถวแล้วเปลี่ยนไปใช้ลูกค้ารายอื่น → ลูกค้าเดิมที่ไม่เหลือสัญญาถูกลบ (ไม่ปล่อย PII ค้าง)
5. `p_term_years` เป็น `integer` (คอลัมน์เป็น smallint — แปลงตอนบันทึก) เพื่อให้เรียกด้วยตัวเลขธรรมดาได้

### การเรียกจากหน้าจอ (หมวด 1)
- `supabase.rpc('save_job_opening', { p_branch_id, p_customer_name, p_customer_type, p_contract_no, p_start_date, p_end_date, p_term_years, p_value_total, p_sale_type, p_team_ids, p_contract_id?, p_customer_id?, p_confirm_new_customer?, p_sale_name?, p_am_name?, p_is_urgent?, p_renewed_from_contract_id?, p_mail_received_date?, p_first_service_date?, p_first_service_time?, p_note? })` → `[{ contract_id, customer_id, reused_customer, existing_customer_type }]`
- `AG001` → HTTP 400 · `details` = JSON string รายชื่อที่ตรง `[{ customer_id, name, customer_type, latest_contract_no }]`
- `supabase.rpc('delete_job_opening', { p_contract_id })`

### แก้ตามผลตรวจของศูนย์กลาง (12 พ.ย. 2026 · commit 7048600)
- คิวลบไฟล์: path เดิมที่ปิดงานแล้ว ถูกใช้ซ้ำแล้วลบอีก → เปิดงานใหม่ในคิว (ไม่ค้าง)
- โหมดแก้: `p_branch_id` ต้องเท่ากับสาขาของลูกค้าเดิม ไม่งั้น `AG006` (ห้ามย้ายสัญญาข้ามสาขา) — หน้าจอต้องแปล `AG006` ด้วย
- ล้มเร็ว `42501` เมื่อผู้ที่ไม่ใช่ host บันทึกนอก `division_scope` (host ไม่ถูกบล็อก)
- อักขระมองไม่เห็นใน `customer_name_key` เขียนเป็น `U&'B…'` · route `maxDuration = 60`
- ไม่ได้เพิ่ม `import "server-only"` — แพ็กเกจไม่มีในโปรเจกต์ (ไม่ติดตั้งเพิ่มตามที่สั่ง) · `createAdminClient()` โยน error ถ้าถูกเรียกใน browser แทน

### ยังค้าง
- ขึ้น cloud (ศูนย์กลางจัดลำดับ — ต้องก่อนหน้าจอที่เรียก RPC)
- หมวด 3: cron ตัวที่ 2 (เสนอ `30 23 * * *` = 06:30 ไทย) + `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` ใน env ของ Vercel + เช็กโควตา cron
- ไฟล์กำพร้าจาก "อัปโหลดแล้วเบราว์เซอร์ปิดก่อนเขียนแถว" — ทำรายงานให้ host ภายหลัง
