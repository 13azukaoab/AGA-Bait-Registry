/**
 * แปลงเลขสถานีที่หัวหน้างานพิมพ์ ("3, 5, 8-12") เป็นรายการเลข และกลับกัน
 * ใช้ร่วมกันระหว่างหน้ากรอกข้อมูลทำบริการ (แสดงจำนวนสด) กับข้อมูลที่ส่งเข้า RPC `save_service_visit`
 * (ฐานข้อมูลตรวจซ้ำอีกชั้นเสมอ — SPEC v1.8 §8.1 "งานซ่อม / ฝังเพิ่ม")
 *
 * กติกา:
 *   * คั่นด้วยจุลภาคหรือช่องว่าง · ช่วงใช้ "-" (รับ "–", "—", "~" ด้วย เพราะพิมพ์จากมือถือ/คัดลอกมา)
 *   * เลขต้องเป็นจำนวนเต็มบวก · ช่วงต้องเรียงจากน้อยไปมาก
 *   * ผลลัพธ์เรียงจากน้อยไปมาก ตัดเลขซ้ำ
 *   * กันพิมพ์ผิด: ทั้งรายการไม่เกิน `MAX_STATIONS_PER_ENTRY` เลข
 *
 * pure function ไม่แตะ DB — ทดสอบที่ `stationNumbers.test.ts`
 */

/** จำนวนเลขสูงสุดต่อ 1 รายการ (ลูกค้าใหญ่มีสถานีหลักร้อย — เผื่อพอ แต่กัน "1-10000") */
export const MAX_STATIONS_PER_ENTRY = 500;

export type ParseResult = { ok: true; numbers: number[] } | { ok: false; error: string };

const RANGE_DASH = /[–—~]/g;

export function parseStationNumbers(input: string): ParseResult {
  const tokens = input
    .replace(RANGE_DASH, "-")
    .replace(/\s*-\s*/g, "-")
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const numbers = new Set<number>();

  for (const token of tokens) {
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from <= 0 || to <= 0) return { ok: false, error: `เลขสถานีต้องมากกว่า 0 (${token})` };
      if (from > to) return { ok: false, error: `ช่วงเลขต้องเรียงจากน้อยไปมาก (${token})` };
      if (to - from + 1 > MAX_STATIONS_PER_ENTRY) {
        return { ok: false, error: `ช่วงเลขใหญ่เกินไป (${token}) ไม่เกิน ${MAX_STATIONS_PER_ENTRY} สถานีต่อรายการ` };
      }
      for (let n = from; n <= to; n += 1) numbers.add(n);
    } else if (/^\d+$/.test(token)) {
      const n = Number(token);
      if (n <= 0) return { ok: false, error: `เลขสถานีต้องมากกว่า 0 (${token})` };
      numbers.add(n);
    } else {
      return { ok: false, error: `อ่านเลขสถานีไม่ได้: "${token}" (ตัวอย่าง: 3, 5, 8-12)` };
    }
    if (numbers.size > MAX_STATIONS_PER_ENTRY) {
      return { ok: false, error: `เลขสถานีมากเกินไป ไม่เกิน ${MAX_STATIONS_PER_ENTRY} สถานีต่อรายการ` };
    }
  }

  return { ok: true, numbers: [...numbers].sort((a, b) => a - b) };
}

/** ย่อรายการเลขเป็นข้อความ เช่น [3, 5, 8, 9, 10] → "3, 5, 8-10" */
export function formatStationNumbers(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i] as number;
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
      i += 1;
      end = sorted[i] as number;
    }
    parts.push(start === end ? String(start) : `${start}-${end}`);
    i += 1;
  }
  return parts.join(", ");
}
