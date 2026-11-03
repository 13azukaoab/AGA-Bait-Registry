# supabase/

Schema, RLS และ migration ของฐานข้อมูล (Supabase / PostgreSQL)

## กฎ (CLAUDE.md)
- **ทุกการเปลี่ยน schema = migration ไฟล์ใหม่** ใน `migrations/` ห้ามแก้ไฟล์เก่า (rollback ได้ปลอดภัย)
- **RLS เปิดทุกตาราง** — สิทธิ์บังคับที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม (SPEC §5)
- `viewer` (anon) อ่านได้เฉพาะ `monthly_branch_snapshots` / view สรุป · ห้ามเข้าถึงตารางที่มีข้อมูลส่วนบุคคล (PDPA)

## ยังไม่เริ่ม
Data model เต็มอยู่ใน SPEC §6 · บทบาท/สิทธิ์ SPEC §5 — จะเขียน migration แรก (เขต/สาขา/ทีม/ประเภทลูกค้า + RLS) ในเฟสถัดไป

## ตั้งค่า (เมื่อเริ่มทำ schema)
เชื่อม Supabase CLI กับ cloud project:
```bash
npx supabase link --project-ref <project-ref>
npx supabase migration new <name>      # สร้าง migration ไฟล์ใหม่
npx supabase db push                    # ส่ง migration ขึ้น cloud
```
> `config.toml` จะถูกสร้างเมื่อรัน `npx supabase init` (ยังไม่ทำในขั้น scaffold)
