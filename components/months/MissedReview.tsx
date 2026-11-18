"use client";

/**
 * รายการทบทวน "ตกบริการรอตัดสิน" ของเดือน (ขั้นทบทวนก่อนปิดส่วนกลาง)
 *
 * Logic summary:
 *   * อ่านผ่าน RPC list_pending_missed_services (สูตรตกบริการอยู่ที่ฐานข้อมูล · host/recorder อ่านได้ตาม RLS)
 *   * เป็น "รายการทบทวน" เท่านั้น — ไม่ใช่เกณฑ์ "ส่วนกลางพร้อมปิด" (เกณฑ์นั้น server ตัดสินตอนกดปิด · นับหมายเหตุตกบริการด้วย)
 *   * ชื่อลูกค้า/เลขสัญญาอ่านจาก contracts + customers เป็นชุดละ 100 (กัน URL ยาว)
 *   * อ่านไม่ได้ = แจ้งข้อความไทย ไม่ซ่อนเป็นรายการว่าง
 */
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

import { groupMissedByBranch, type MissedItem } from "./monthsLogic";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ok"; items: MissedItem[]; names: Map<string, string> };

const CHUNK = 100;
const PREVIEW = 15;

export function MissedReview({ month }: { month: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [all, setAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ kind: "loading" });
      try {
        const supabase = createClient();
        const pend = await supabase.rpc("list_pending_missed_services", { p_branch_id: null, p_month: `${month}-01` });
        if (pend.error) throw new Error("rpc");
        const rows = (pend.data ?? []) as { contract_id: string; branch_id: string }[];
        const ids = [...new Set(rows.map((r) => r.contract_id))];
        const info = new Map<string, { no: string; name: string }>();
        for (let i = 0; i < ids.length; i += CHUNK) {
          const res = await supabase
            .from("contracts")
            .select("id, contract_no, customers(name)")
            .in("id", ids.slice(i, i + CHUNK));
          if (res.error) throw new Error("contracts");
          for (const c of (res.data ?? []) as unknown as { id: string; contract_no: string; customers: { name: string } | { name: string }[] | null }[]) {
            const cust = Array.isArray(c.customers) ? c.customers[0] : c.customers;
            info.set(c.id, { no: c.contract_no, name: cust?.name ?? "—" });
          }
        }
        const br = await supabase.from("branches").select("id, name");
        if (br.error) throw new Error("branches");
        const names = new Map(((br.data ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
        const items: MissedItem[] = rows.map((r) => ({
          contractId: r.contract_id,
          branchId: r.branch_id,
          contractNo: info.get(r.contract_id)?.no ?? "—",
          customerName: info.get(r.contract_id)?.name ?? "—",
        }));
        if (!cancelled) setState({ kind: "ok", items, names });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month]);

  if (state.kind === "loading") return <p className="text-[13px] text-fg-muted" role="status">กำลังโหลดรายการตกบริการ…</p>;
  if (state.kind === "error") {
    return (
      <Alert variant="danger" title="อ่านรายการตกบริการไม่ได้">
        ลองรีเฟรชหน้า — ยังปิดเดือนได้ ระบบจะตรวจความพร้อมที่ฝั่ง server อีกครั้งตอนกดปิด
      </Alert>
    );
  }

  const groups = groupMissedByBranch(state.items, state.names);
  const shown = all ? state.items : state.items.slice(0, PREVIEW);
  if (state.items.length === 0) {
    return <Alert variant="ok" title="ไม่มีสัญญาตกบริการรอตัดสินในเดือนนี้">ตรวจความพร้อมปิดขั้นสุดท้ายที่ server ตอนกดปิดอีกครั้ง</Alert>;
  }
  return (
    <div>
      <Alert variant="warn" title={`ตกบริการรอตัดสิน ${state.items.length} ราย ใน ${groups.length} สาขา`}>
        เป็นรายการให้ทบทวน — ส่วนกลางจะ &quot;พร้อมปิด&quot; เมื่อทุกรายทำ/ชดเชย/ยกเว้นแล้ว หรือมีบันทึกเหตุตกบริการ (ระบบตัดสินตอนกดปิด)
      </Alert>
      <div className="my-3 flex flex-wrap gap-2">
        {groups.map((g) => (
          <span key={g.branchId} className="rounded-full bg-surface-3 px-2.5 py-1 text-[12px] text-fg">
            {g.name} <b className="tabular-nums">{g.count}</b>
          </span>
        ))}
      </div>
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full whitespace-nowrap text-[13px]">
          <thead>
            <tr className="bg-surface-2 text-left text-[12px] text-fg-muted">
              <th className="px-3 py-2">ลูกค้า</th>
              <th className="px-3 py-2">เลขที่สัญญา</th>
              <th className="px-3 py-2">สาขา</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.contractId} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{i.customerName}</td>
                <td className="px-3 py-2 tabular-nums">{i.contractNo}</td>
                <td className="px-3 py-2">{state.names.get(i.branchId) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.items.length > PREVIEW && !all ? (
        <button type="button" onClick={() => setAll(true)} className="mt-2 min-h-11 text-[13px] text-accent underline md:min-h-9">
          แสดงทั้งหมด {state.items.length} ราย
        </button>
      ) : null}
    </div>
  );
}
