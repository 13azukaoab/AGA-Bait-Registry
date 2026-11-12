"use client";

/**
 * RenewalDialog — เลือก "ลูกค้าเดิม" ให้งาน Renew: ค้นสัญญาเก่า (เลขที่สัญญา/ชื่อลูกค้า) แล้วเลือกใบที่จะผูก
 * เลือกแล้วสัญญาใหม่ใช้ลูกค้าคนเดียวกับสัญญาเก่า (ไม่สร้างลูกค้าใหม่) · ค้นแบบหน่วงเวลา 300 ms
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui";

import { Modal } from "./Modal";
import { searchRenewalCandidates } from "./renewal";
import type { RenewalLink } from "./types";

export function RenewalDialog({
  supabase,
  branchNameOf,
  onPick,
  onClose,
}: {
  supabase: SupabaseClient;
  branchNameOf: (branchId: string) => string;
  onPick: (link: RenewalLink) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RenewalLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const res = await searchRenewalCandidates(supabase, q);
      if (cancelled) return;
      setError(res.error);
      setResults(res.results);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, supabase]);

  return (
    <Modal
      title="ผูกลูกค้าเดิม (Renew)"
      subtitle="เลือกสัญญาเก่าของลูกค้ารายนี้ — สัญญาใหม่จะใช้ลูกค้าคนเดียวกัน ไม่สร้างลูกค้าใหม่"
      onClose={onClose}
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-fg-muted">ค้นหาชื่อลูกค้า / เลขที่สัญญาเดิม</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร"
            className="w-full rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-accent"
          />
        </label>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {results === null && !error ? (
          <p className="m-0 text-fg-muted">พิมพ์เพื่อค้นหาสัญญาเก่า</p>
        ) : null}
        {results && results.length === 0 ? (
          <p className="m-0 text-fg-muted">ไม่พบสัญญาที่ตรงกับ “{q.trim()}”</p>
        ) : null}
        {results && results.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {results.map((r) => (
              <li key={r.contractId}>
                <button
                  type="button"
                  onClick={() => onPick(r)}
                  className="flex w-full cursor-pointer flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="num font-semibold">{r.contractNo}</span>
                  <span className="min-w-0 flex-1 break-words">{r.customerName}</span>
                  <span className="text-fg-muted">{branchNameOf(r.branchId)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}
