"use client";

/**
 * HistoryDialog — ประวัติการแก้ไขของสัญญา 1 ใบ (เฉพาะ host · อ่านจาก audit_log ซึ่ง RLS ให้ host อ่านได้คนเดียว)
 * เวอร์ชันย่อสำหรับหน้าเปิดงาน: แสดงรายการล่าสุดเรียงใหม่→เก่า
 * (ลิ้นชักประวัติเต็มรูปแบบเป็นงานของหมวด BE `components/history/**` — เมื่อพร้อมให้สลับมาใช้แทนไฟล์นี้)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui";

import { Modal } from "./Modal";

type AuditRow = { id: string; table_name: string; action: string; changed_at: string };

const ACTION_TH: Record<string, string> = { insert: "เพิ่ม", update: "แก้ไข", delete: "ลบ" };
const TABLE_TH: Record<string, string> = {
  contracts: "สัญญา",
  customers: "ลูกค้า",
  contract_teams: "ทีมที่ดูแล",
  contract_files: "ไฟล์แนบ",
  stations: "สถานี",
  visits: "ผลบริการ",
  station_checks: "ผลตรวจสถานี",
};

const LIMIT = 100;

export function HistoryDialog({
  supabase,
  contractId,
  contractNo,
  onClose,
}: {
  supabase: SupabaseClient;
  contractId: string;
  contractNo: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: err } = await supabase
        .from("audit_log")
        .select("id, table_name, action, changed_at")
        .eq("contract_id", contractId)
        .order("changed_at", { ascending: false })
        .limit(LIMIT);
      if (cancelled) return;
      if (err) setError("อ่านประวัติไม่ได้ (ดูประวัติได้เฉพาะ host)");
      else setRows((data ?? []) as AuditRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, contractId]);

  return (
    <Modal title={`ประวัติการแก้ไข · ${contractNo}`} subtitle="เรียงจากล่าสุด" onClose={onClose}>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {!error && rows === null ? <p className="m-0 text-fg-muted">กำลังโหลด…</p> : null}
      {rows && rows.length === 0 ? <p className="m-0 text-fg-muted">ยังไม่มีประวัติ</p> : null}
      {rows && rows.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-2 border-b border-border py-1">
              <span className="num text-fg-muted">
                {new Date(r.changed_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}
              </span>
              <span>
                {ACTION_TH[r.action] ?? r.action} · {TABLE_TH[r.table_name] ?? r.table_name}
              </span>
            </li>
          ))}
          {rows.length >= LIMIT ? (
            <li className="pt-1 text-[12px] text-fg-muted">แสดง {LIMIT} รายการล่าสุด</li>
          ) : null}
        </ul>
      ) : null}
    </Modal>
  );
}
