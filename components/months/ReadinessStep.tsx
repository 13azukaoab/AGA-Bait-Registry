"use client";

/**
 * ขั้น "ตรวจความครบ" ของการปิดส่วนกลาง (ขั้นที่ 1 ใน 3 ขั้น · mockup `docs/mockup/month-closure.html`)
 *
 * Logic summary:
 *   * อ่านผ่าน RPC get_central_readiness (M40) — ได้เฉพาะสาขาที่ยังไม่พร้อม · 0 แถว = พร้อมทุกสาขา
 *   * host และ recorder ส่วนกลางดูได้ · เป็นข้อมูลประกอบการตัดสินใจเท่านั้น — server ตัดสินซ้ำตอนกดปิด (409)
 *   * อ่านไม่ได้ = แจ้งข้อความไทย ไม่แสดงเหมือน "พร้อม" · ไม่แสดง/ไม่ log ข้อความดิบจาก DB
 */
import { useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

import { fetchCentralReadiness } from "./monthsRpc";
import { summarizeReadiness, type Perms, type ReadinessBranch } from "./monthsLogic";

type State = { kind: "loading" } | { kind: "error"; forbidden: boolean } | { kind: "ok"; rows: ReadinessBranch[] };

export function ReadinessStep({ month, perms }: { month: string; perms: Perms }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      const out = await fetchCentralReadiness(createClient(), month, perms);
      if (cancelled) return;
      setState(out.kind === "ok" ? { kind: "ok", rows: out.rows } : { kind: "error", forbidden: out.code === "forbidden" });
    })();
    return () => {
      cancelled = true;
    };
  }, [month, perms]);

  const summary = useMemo(() => (state.kind === "ok" ? summarizeReadiness(state.rows) : null), [state]);

  if (state.kind === "loading") return <p className="text-[13px] text-fg-muted" role="status">กำลังตรวจความครบของ 24 สาขาส่วนกลาง…</p>;
  if (state.kind === "error") {
    return (
      <Alert variant="danger" title={state.forbidden ? "คุณไม่มีสิทธิ์ดูความครบของส่วนกลาง" : "ตรวจความครบไม่ได้"}>
        {state.forbidden ? "ดูได้เฉพาะ OM/PM หรือหัวหน้างานส่วนกลาง" : "ลองรีเฟรชหน้า — ยังปิดเดือนได้ ระบบจะตรวจความพร้อมที่ฝั่ง server อีกครั้งตอนกดปิด"}
      </Alert>
    );
  }
  if (!summary || summary.ready) {
    return (
      <Alert variant="ok" title="ทุกสาขาส่วนกลางบันทึกบริการครบแล้ว">
        พร้อมปิดเดือนนี้ — ระบบตรวจความพร้อมขั้นสุดท้ายที่ server ตอนกดปิดอีกครั้ง
      </Alert>
    );
  }
  return (
    <div>
      <Alert variant="warn" title={`ยังมี ${summary.branchCount} สาขาที่บันทึกบริการไม่ครบ · ค้างรวม ${summary.pendingTotal} ราย`}>
        &quot;พร้อมปิด&quot; = ทุกสัญญาที่ตกบริการ ทำ/ชดเชย/ยกเว้นแล้ว หรือมีบันทึกเหตุตกบริการ · ให้สาขากรอกให้ครบ
        {perms.isHost ? " หรือ OM/PM ปิดข้ามพร้อมเหตุผลได้ในขั้นยืนยันปิด" : " หรือแจ้ง OM/PM ให้ปิดข้ามพร้อมเหตุผล (หัวหน้างานปิดข้ามไม่ได้)"}
      </Alert>
      <div className="mt-3 overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-surface-2 text-left text-[12px] text-fg-muted">
              <th className="px-3 py-2">สาขา</th>
              <th className="px-3 py-2 text-right">ค้าง (ราย)</th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((r) => (
              <tr key={r.branchId} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 text-right tabular-nums text-danger">{r.pending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
