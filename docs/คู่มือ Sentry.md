# คู่มือ Sentry — เก็บ error ของแอป (M32 · แผนฟรี)

## Sentry ทำอะไร
เมื่อแอปบน **Production** เกิด error (ทั้งฝั่งเซิร์ฟเวอร์และบนมือถือ/เบราว์เซอร์ของพนักงาน) Sentry จะเก็บไว้ + ส่งอีเมลแจ้งเรา (org ตั้งกฎ "error ใหม่ทุกตัวแจ้งเตือน" ไว้แล้ว)

**ข้อมูลลูกค้าไม่ถูกส่ง (PDPA)** — ตัวกรองในโค้ดตัดทิ้งก่อนส่งทุกครั้ง: ข้อมูลที่ส่งมา/กรอก (body) · query ท้าย URL · คุกกี้ · headers · ข้อมูลผู้ใช้ (เหลือแค่ id) · ค่าตัวแปรใน stack · ข้อความ console · ไม่เปิด Session Replay (อัดหน้าจอ) · ไม่เปิดช่องรับ feedback
ส่งเฉพาะ **Production** — เครื่อง dev / test / Preview ไม่ส่ง · เก็บเฉพาะ error (ปิด tracing เพื่อไม่กินโควตาฟรี)

ไฟล์ที่เกี่ยวข้อง: `instrumentation.ts` · `instrumentation-client.ts` · `app/global-error.tsx` · `lib/sentry/` · `next.config.ts`
> หมายเหตุสำหรับทีม: `@sentry/nextjs` v11 ไม่มีตัวเลือก `sendDefaultPii` แล้ว (เปลี่ยนเป็น `dataCollection` ที่ค่าเริ่มต้นคือ "เก็บทุกอย่าง") โค้ดเราจึงปิดทุกหมวดชัดเจนที่ `DATA_COLLECTION_OFF` ใน `lib/sentry/options.ts` — ห้ามผ่อนโดยไม่ถามเจ้าของ

## 1. ตั้งค่าใน Vercel (ทำครั้งเดียว — **ห้ามวางค่าในแชต**)
Vercel → โปรเจกต์ → **Settings** → **Environment Variables** → เพิ่มทีละตัว **ติ๊กเฉพาะ Production** (เอา Preview / Development ออก)

| ชื่อ | ค่าอะไร | เอาจากไหนใน Sentry |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | ที่อยู่รับ error (ขึ้นต้น `https://…ingest.de.sentry.io/…`) | **Settings** → **Projects** → `aga-bait-registry` → **Client Keys (DSN)** → คัดลอก DSN |
| `SENTRY_ORG` | `advance-group-asia` | ชื่อย่อ (slug) ขององค์กร — เห็นใน URL ของ Sentry |
| `SENTRY_PROJECT` | `aga-bait-registry` | ชื่อย่อ (slug) ของโปรเจกต์ |
| `SENTRY_AUTH_TOKEN` | กุญแจใช้ตอน build เพื่ออัปโหลด source map (ทำให้ error อ่านออกว่าอยู่บรรทัดไหน) | **Settings** → **Developer Settings** → **Organization Tokens** → **Create New Token** (ชื่อเช่น `vercel-build`) · สิทธิ์ให้เลือกแค่ที่ Sentry ตั้งให้อัตโนมัติสำหรับ build (อย่าเพิ่มสิทธิ์อื่น) · token แสดงครั้งเดียว คัดลอกวางใน Vercel ทันที |

- `SENTRY_AUTH_TOKEN`: ติ๊ก **Sensitive** ใน Vercel ด้วย · ห้ามใส่ชื่อขึ้นต้น `NEXT_PUBLIC_` · ห้ามส่งใครทางแชต/อีเมล
- ไม่ใส่ `SENTRY_AUTH_TOKEN` ก็ได้ — แอปทำงานปกติ แค่ error ที่เห็นใน Sentry จะเป็นโค้ดที่ย่อไว้อ่านยากกว่า

## 2. กด Redeploy (จำเป็น)
ค่าตัวแปรมีผลหลัง build ใหม่เท่านั้น → Vercel → **Deployments** → deploy ล่าสุดของ Production → **⋯** → **Redeploy** (ปิด "Use existing Build Cache" เพื่อความชัวร์)

## 3. วิธีทดสอบว่าใช้งานได้
**ไม่มีหน้าทดสอบสาธารณะในแอป** (กันคนนอกยิง error รัวๆ กินโควตา) ให้ทีมงาน (นัท/Jane/Toon) ทดสอบแบบชั่วคราว:
1. สร้างไฟล์ `app/api/cron/sentry-test/route.ts` **ในเครื่อง/branch ชั่วคราว ห้าม merge เข้า main**:
   ```ts
   import * as Sentry from "@sentry/nextjs";
   import { NextResponse } from "next/server";

   export const dynamic = "force-dynamic";

   // ชั่วคราว — ต้องมี CRON_SECRET จึงเรียกได้ · ลบไฟล์นี้ทันทีหลังทดสอบ
   export async function GET(request: Request) {
     if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
       return NextResponse.json({ ok: false }, { status: 401 });
     }
     Sentry.captureException(new Error("Sentry test M32 (ทดสอบ ลบได้)"));
     await Sentry.flush(2000);
     return NextResponse.json({ ok: true });
   }
   ```
   > ใช้โฟลเดอร์ `api/cron/` เพราะ middleware ข้ามอยู่แล้ว ไม่ต้องแก้ `middleware.ts`
2. deploy ขึ้น Production → เรียกด้วย `curl -H "Authorization: Bearer <CRON_SECRET>" https://<โดเมน>/api/cron/sentry-test`
3. เปิด Sentry → **Issues** → ภายในไม่กี่นาทีต้องเห็น `Sentry test M32` และเปิดดู event ต้อง **ไม่มี** cookies / headers / ข้อมูลผู้ใช้ นอกจาก id
4. **ลบไฟล์ทดสอบแล้ว deploy ใหม่ทันที** · กด Resolve/ลบ issue ทดสอบใน Sentry

## 4. ปิด Sentry ชั่วคราว
Vercel → Environment Variables → **ลบ `NEXT_PUBLIC_SENTRY_DSN`** (ตัวเดียวพอ) → Redeploy
แอปจะไม่ส่งอะไรออกไปเลย ไม่มี error ไม่มี warning · เปิดกลับ = ใส่ DSN คืนแล้ว Redeploy

## 5. ข้อควรรู้
- ส่ง error ตรงจากเบราว์เซอร์ไป Sentry (ไม่ผ่านเซิร์ฟเวอร์เรา) — พนักงานที่ติดตัวบล็อกโฆษณาบางตัวจะไม่ส่ง ยอมรับได้สำหรับแอปภายใน ฝั่งเซิร์ฟเวอร์ส่งปกติ
- แผนฟรีมีโควตาจำกัดต่อเดือน (error ราว 5,000 ครั้ง) ถ้าเต็ม Sentry จะหยุดรับจนเดือนถัดไป — ถ้าเจอ error ซ้ำรัวๆ ให้แก้ต้นเหตุ/ปิดชั่วคราวตามข้อ 4
- ถ้าเจอ error ที่ข้อความมีข้อมูลลูกค้าหลุดมาใน Sentry → แจ้งเจ้าของทันที แล้วลบ event นั้นใน Sentry และแจ้งทีมให้เพิ่มกฎใน `lib/sentry/scrub.ts`
- ห้ามเขียนโค้ดที่แนบข้อมูลลูกค้าเข้า Sentry (`Sentry.setContext` / `setExtra` / `setUser` ด้วยชื่อ เบอร์ ที่อยู่)
