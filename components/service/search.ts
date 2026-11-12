/**
 * ค้นหารายชื่อสัญญา (ช่องเดียว: ชื่อลูกค้า หรือเลขที่สัญญา) — pure function (SPEC v1.8 §8.1 ค้นหาคำใกล้เคียง)
 *
 * Logic summary:
 *   1. ปรับคำก่อน: พิมพ์เล็ก ตัดช่องว่าง/จุด/ขีด
 *   2. หา substring ในชื่อหรือเลขสัญญา → เจอ = รายการตรงตัว
 *   3. ไม่เจอเลย → ให้คะแนนด้วย bigram (ที่ตรง ÷ bigram ของคำค้น) เทียบทั้งชื่อและเลขสัญญา
 *      เก็บคะแนน ≥ 0.5 สูงสุด 3 ราย เป็น "หมายถึงรายนี้ไหม"
 */

export interface Searchable {
  customerName: string;
  contractNo: string;
}

export const SUGGEST_MIN_SCORE = 0.5;
export const SUGGEST_MAX = 3;

export function normalizeQuery(raw: string): string {
  return raw.toLowerCase().replace(/[\s.\-_/]+/g, "");
}

function bigrams(s: string): string[] {
  if (s.length < 2) return s ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
  return out;
}

/** สัดส่วน bigram ของคำค้นที่พบในข้อความเป้าหมาย (0–1) */
export function similarity(query: string, target: string): number {
  const q = bigrams(query);
  if (q.length === 0) return 0;
  const pool = bigrams(target);
  let hit = 0;
  for (const g of q) {
    const i = pool.indexOf(g);
    if (i >= 0) {
      hit += 1;
      pool.splice(i, 1);
    }
  }
  return hit / q.length;
}

export interface SearchResult<T> {
  /** รายการตรงตัว */
  items: T[];
  /** คำแนะนำ (มีเฉพาะเมื่อไม่พบตรงตัว) */
  suggestions: T[];
  /** true = มีคำค้นอยู่ */
  searching: boolean;
}

export function searchContracts<T extends Searchable>(list: readonly T[], raw: string): SearchResult<T> {
  const q = normalizeQuery(raw);
  if (q === "") return { items: [...list], suggestions: [], searching: false };

  const exact = list.filter(
    (c) => normalizeQuery(c.customerName).includes(q) || normalizeQuery(c.contractNo).includes(q),
  );
  if (exact.length > 0) return { items: exact, suggestions: [], searching: true };

  const scored = list
    .map((c) => ({
      c,
      s: Math.max(similarity(q, normalizeQuery(c.customerName)), similarity(q, normalizeQuery(c.contractNo))),
    }))
    .filter((x) => x.s >= SUGGEST_MIN_SCORE)
    .sort((a, b) => b.s - a.s)
    .slice(0, SUGGEST_MAX)
    .map((x) => x.c);
  return { items: [], suggestions: scored, searching: true };
}
