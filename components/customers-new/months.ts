/**
 * เดือนเปิดงาน (ตัวเลือกเดือนของหน้าเปิดงาน) — ใช้ของกลางที่ `lib/service/months.ts`
 * (เดิมไฟล์นี้กับ components/service/months.ts เป็นโค้ดเดียวกัน 2 ที่ จึงรวมเป็นที่เดียว · คงไฟล์นี้ไว้เป็นทางผ่านเพื่อไม่ให้ผู้ใช้ไฟล์เดิมต้องแก้ import)
 */
export {
  currentBangkokMonth,
  isMonthKey,
  monthChoices,
  monthLabel,
  monthRange,
  resolveMonth,
  todayBangkok,
} from "@/lib/service/months";
