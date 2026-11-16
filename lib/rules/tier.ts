import type { Tier, TierRule } from "./types";
import { monthOf } from "./date";

/**
 * มูลค่าต่อปี = มูลค่าสัญญา ÷ จำนวนปี (SPEC §7.1)
 * @deprecated M30 — รับ "ปี" (1/3) ตามผู้เรียกเดิมใน components/** · ใช้ `annualValueForTerm(value, termMonths)`
 *   (สัญญาสั้น < 12 เดือนใช้มูลค่าจริง ไม่ขยายเป็นต่อปี — ฟังก์ชันนี้ไม่รู้จัก)
 */
export function annualValue(valueTotal: number, termYears: number): number {
  return valueTotal / termYears;
}

/**
 * M20 (DECISIONS 2.31): เลือกชุดเกณฑ์ที่ใช้กับเดือน `month`
 * = ชุดที่ effectiveMonth ล่าสุดที่ไม่เกินเดือนนั้น (เดือนที่ปิดแล้วจึงคงเกณฑ์เดิม)
 *
 * - แถวไม่มี effectiveMonth ทั้งหมด = ชุดเดียวแบบเดิม ใช้ได้ทุกเดือน
 * - ไม่ส่ง month แต่มีมากกว่า 1 ชุด → throw (กันใช้เกณฑ์ปนกัน)
 * - เดือนก่อนชุดแรก / แถวมีเดือนปนกับไม่มีเดือน / tier ซ้ำในชุด → throw (ห้ามเดาเกณฑ์)
 * คืนชุดที่เลือก เรียงตาม minAnnual
 */
export function rulesForMonth(rules: TierRule[], month?: string): TierRule[] {
  const dated = rules.filter((r) => r.effectiveMonth !== undefined);
  if (dated.length > 0 && dated.length < rules.length) {
    throw new Error("rulesForMonth: แถวเกณฑ์มีเดือนเริ่มใช้ปนกับไม่มีเดือน — อ่าน effective_month มาให้ครบทุกแถว");
  }

  let picked: TierRule[];
  if (dated.length === 0) {
    picked = rules;
  } else {
    const months = [...new Set(dated.map((r) => monthOf(r.effectiveMonth as string)))].sort();
    let target: string | undefined;
    if (month === undefined) {
      if (months.length > 1) {
        throw new Error("rulesForMonth: เกณฑ์มีหลายชุด ต้องระบุเดือนที่คำนวณ");
      }
      target = months[0];
    } else {
      const m = monthOf(month);
      target = months.filter((x) => x <= m).pop();
      if (target === undefined) {
        throw new Error(`rulesForMonth: ไม่มีเกณฑ์ Tier ที่ใช้ได้กับเดือน ${m}`);
      }
    }
    picked = dated.filter((r) => monthOf(r.effectiveMonth as string) === target);
  }

  const tiers = picked.map((r) => r.tier);
  if (new Set(tiers).size !== tiers.length) {
    throw new Error("rulesForMonth: tier ซ้ำในชุดเกณฑ์ — อาจอ่านมาหลายชุดโดยไม่มี effective_month");
  }
  return [...picked].sort((a, b) => a.minAnnual - b.minAnnual);
}

/**
 * เลือก tier ที่ minAnnual <= annual สูงสุด (เกณฑ์มาจาก tier_rules เท่านั้น ห้าม hardcode)
 * M20: ส่ง `month` ('YYYY-MM') เพื่อใช้ชุดเกณฑ์ของเดือนนั้น — ดู `rulesForMonth`
 */
export function tierOf(annual: number, rules: TierRule[], month?: string): Tier {
  const sorted = rulesForMonth(rules, month);
  const first = sorted[0];
  if (!first) throw new Error("tierOf: rules ว่าง (ต้องมีอย่างน้อย 1 เกณฑ์)");
  let picked: Tier = first.tier;
  for (const r of sorted) {
    if (annual >= r.minAnnual) picked = r.tier;
    else break;
  }
  return picked;
}
