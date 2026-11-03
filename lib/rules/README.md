# lib/rules

Core business logic ของ AGA Bait Registry เป็น **pure function** ล้วน แยกจาก UI/DB เพื่อทดสอบง่ายและนำไปใช้ซ้ำ

- รับ input เป็น primitive/plain object · คืนค่าใหม่ · ไม่มี side-effect · ไม่แตะ DB/`Date.now`
- วันที่ส่งเป็น string `YYYY-MM-DD` (TZ-safe กว่า `Date` object)
- เกณฑ์ Tier รับเป็น parameter เสมอ (อ่านจาก `tier_rules` ตอน runtime — **ห้าม hardcode**, CLAUDE.md ข้อ 3)

ฟังก์ชันที่จะเขียน (ตาม CLAUDE.md "ตรรกะหลัก" + SPEC §7):
`annualValue` · `tierOf` · `serviceMonths` · `defaultEndDate` · `isMissedService` · `buildBranchSnapshot` · `monthKey`

**ยังไม่ลงมือ** — ทำตามแผน TDD (เขียนเทสก่อน): [`docs/plans/2026-10-15-lib-rules.md`](../../docs/plans/2026-10-15-lib-rules.md)

รันเทส: `npm test` (Vitest — include `lib/**/*.test.ts`)
