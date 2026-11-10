# lib/rules

Core business logic ของ AGA Bait Registry เป็น **pure function** ล้วน แยกจาก UI/DB เพื่อทดสอบง่ายและนำไปใช้ซ้ำ

- รับ input เป็น primitive/plain object · คืนค่าใหม่ · ไม่มี side-effect · ไม่แตะ DB/`Date.now`
- วันที่ส่งเป็น string `YYYY-MM-DD` (TZ-safe กว่า `Date` object)
- เกณฑ์ Tier รับเป็น parameter เสมอ (อ่านจาก `tier_rules` ตอน runtime — **ห้าม hardcode**, CLAUDE.md ข้อ 3)

ฟังก์ชันที่จะเขียน (ตาม CLAUDE.md "ตรรกะหลัก" + SPEC §7):
`annualValue` · `tierOf` · `serviceMonths` · `defaultEndDate` · `isMissedService` · `buildBranchSnapshot` · `monthKey`

**✅ เขียนแล้ว (3 พ.ย. 2026)** ตามแผน TDD [`docs/plans/2026-10-15-lib-rules.md`](../../docs/plans/2026-10-15-lib-rules.md) — 16 เทสผ่าน (ครบกรณีบังคับใน SPEC)
- `date.ts` util · `tier.ts` (annualValue/tierOf) · `monthKey.ts` · `serviceMonths.ts` (serviceMonths/defaultEndDate) · `missedService.ts` · `snapshot.ts` (buildBranchSnapshot) · `index.ts` barrel · `types.ts` · `__fixtures__/tierRules.ts`

**ค้าง:** เกณฑ์ยอมรับเขต 1 (SPEC §15) — ต้องได้ไฟล์ `fixtures/zone1_registry.*` ก่อนจึงเขียนเทสเทียบตัวเลขจริง (นครปฐม 30/1,737,860 · หัวหิน 76/5,770,484 · พุทธมณฑล 241/13,084,342)

รันเทส: `npm test` (Vitest — include `lib/**/*.test.ts`)
