/**
 * ค้นสัญญาเก่าสำหรับ Renew ("ลูกค้าเดิม")
 *
 * Logic summary:
 *   * ค้นด้วยเลขที่สัญญา หรือชื่อลูกค้า (ไม่สนตัวพิมพ์) · อ่านผ่าน RLS ของผู้ใช้ (host/admin อ่านได้ทุกสาขา)
 *   * ผลลัพธ์ 1 แถว = 1 สัญญาเก่า → ใช้ลูกค้าของสัญญานั้นเป็นลูกค้าของสัญญาใหม่ (ไม่สร้างลูกค้าใหม่)
 *     UI จึงเลือกสัญญาเก่าของลูกค้าคนละคนไม่ได้ (DB บังคับซ้ำด้วย trigger — M9)
 *   * ตัดอักขระพิเศษของตัวกรอง PostgREST/LIKE (% , ( ) *) ออกจากคำค้น กันตัวกรองเพี้ยน
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RenewalLink } from "./types";

const MAX_RESULTS = 25;

/** คำค้นที่ปลอดภัยต่อ `ilike` + ตัวกรองของ PostgREST · สั้นกว่า 2 ตัว = ไม่ค้น */
export function sanitizeSearch(raw: string): string {
  return raw.replace(/[%_,()*\\]/g, " ").replace(/\s+/g, " ").trim();
}

type ContractWithCustomer = {
  id: string;
  contract_no: string;
  customer_id: string;
  customers: { name: string; branch_id: string } | null;
};

const COLUMNS = "id, contract_no, customer_id, customers ( name, branch_id )";

function toLink(r: ContractWithCustomer): RenewalLink | null {
  if (!r.customers) return null;
  return {
    contractId: r.id,
    contractNo: r.contract_no,
    customerId: r.customer_id,
    customerName: r.customers.name,
    branchId: r.customers.branch_id,
  };
}

export async function searchRenewalCandidates(
  supabase: SupabaseClient,
  rawQuery: string,
): Promise<{ results: RenewalLink[]; error: string | null }> {
  const q = sanitizeSearch(rawQuery);
  if (q.length < 2) return { results: [], error: null };

  const [byNo, byName] = await Promise.all([
    supabase
      .from("contracts")
      .select(COLUMNS)
      .ilike("contract_no", `%${q}%`)
      .order("start_date", { ascending: false })
      .limit(MAX_RESULTS),
    supabase.from("customers").select("id").ilike("name", `%${q}%`).limit(MAX_RESULTS),
  ]);
  if (byNo.error || byName.error) {
    return { results: [], error: "ค้นหาไม่สำเร็จ ลองอีกครั้ง" };
  }

  const customerIds = ((byName.data ?? []) as { id: string }[]).map((c) => c.id);
  let byCustomer: ContractWithCustomer[] = [];
  if (customerIds.length > 0) {
    const res = await supabase
      .from("contracts")
      .select(COLUMNS)
      .in("customer_id", customerIds)
      .order("start_date", { ascending: false })
      .limit(MAX_RESULTS);
    if (res.error) return { results: [], error: "ค้นหาไม่สำเร็จ ลองอีกครั้ง" };
    byCustomer = (res.data ?? []) as unknown as ContractWithCustomer[];
  }

  const seen = new Set<string>();
  const results: RenewalLink[] = [];
  for (const r of [...((byNo.data ?? []) as unknown as ContractWithCustomer[]), ...byCustomer]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const link = toLink(r);
    if (link) results.push(link);
    if (results.length >= MAX_RESULTS) break;
  }
  return { results, error: null };
}
