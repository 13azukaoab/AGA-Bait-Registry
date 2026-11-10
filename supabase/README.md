# supabase/

Schema, RLS และ migration ของฐานข้อมูล (Supabase / PostgreSQL)

## กฎ (CLAUDE.md)
- **ทุกการเปลี่ยน schema = migration ไฟล์ใหม่** ใน `migrations/` ห้ามแก้ไฟล์เก่า (rollback ได้ปลอดภัย)
- **RLS เปิดทุกตาราง** — สิทธิ์บังคับที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม (SPEC §5)
- `viewer` (anon) อ่านได้เฉพาะ `monthly_branch_snapshots` / view สรุป · ห้ามเข้าถึงตารางที่มีข้อมูลส่วนบุคคล (PDPA)

## สถานะ (10 พ.ย. 2026)
- `migrations/` — 16 ไฟล์: schema ตาม SPEC v1.1 (3–5 พ.ย.) + 6 ไฟล์ปรับให้ตรง SPEC v1.6 (10 พ.ย.: ยกเลิกล็อกเดือนปิด, `month_closures.scope`, ฟิลด์ต่างจังหวัดใน snapshot, `positions` + บัญชีผู้ใช้ใน `profiles`, บริบทใน `audit_log`, `pg_trgm`)
- `tests/` — เทส pgTAP รันด้วย `npm run db:test` (ต้องมี Docker + `npx supabase start`)
- month key ใน `month_closures` และ `audit_log` = ISO `YYYY-MM` · `monthly_branch_snapshots.month_key` ยังไม่กำหนดรูปแบบ (รอเจ้าของตัดสิน — ดู task.md 10 พ.ย.)

## ตั้งค่า (เมื่อเริ่มทำ schema)
เชื่อม Supabase CLI กับ cloud project:
```bash
npx supabase link --project-ref <project-ref>
npx supabase migration new <name>      # สร้าง migration ไฟล์ใหม่
npx supabase db push                    # ส่ง migration ขึ้น cloud
```
> `config.toml` จะถูกสร้างเมื่อรัน `npx supabase init` (ยังไม่ทำในขั้น scaffold)
