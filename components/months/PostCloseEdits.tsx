"use client";

/**
 * รายการ "แก้หลังปิด" ของส่วนที่ปิดแล้ว (หน้ารายละเอียดส่วน · mockup FINAL)
 *
 * Logic summary:
 *   * อ่านผ่าน RPC list_post_close_edits (M40) — host ได้ทั้ง 2 ส่วน · recorder ได้ส่วนกลางเท่านั้น (ไม่ยิง RPC ถ้าไม่มีสิทธิ์)
 *   * แสดง: เวลา · ตาราง (ไทย) · เพิ่ม/แก้ไข/ลบ · สาขา · ผู้แก้ (ตำแหน่ง) — ไม่มีค่าเก่า/ใหม่ ไม่มีข้อมูลลูกค้า
 *   * ตัวเลข N = จำนวนแถวที่ server ส่งมา · version เปลี่ยน (เช่น หลังคำนวณ snapshot ใหม่) → โหลดใหม่
 *   * อ่านไม่ได้ = แจ้งข้อความไทย ไม่แสดงเหมือน "ไม่มีการแก้"
 */
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

import { fetchPostCloseEdits } from "./monthsRpc";
import { countPostCloseEdits, describePostCloseEdit, type Perms, type PostCloseEdit, type Scope } from "./monthsLogic";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ok"; rows: PostCloseEdit[] };

const PREVIEW = 20;

export function PostCloseEdits(props: { month: string; scope: Scope; perms: Perms; version: string }) {
  const { month, scope, perms, version } = props;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [all, setAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    setAll(false);
    (async () => {
      const out = await fetchPostCloseEdits(createClient(), month, scope, perms);
      if (!cancelled) setState(out.kind === "ok" ? { kind: "ok", rows: out.rows } : { kind: "error" });
    })();
    return () => {
      cancelled = true;
    };
  }, [month, scope, perms, version]);

  if (state.kind === "loading") return <p className="text-[13px] text-fg-muted" role="status">กำลังโหลดรายการแก้หลังปิด…</p>;
  if (state.kind === "error") {
    return (
      <Alert variant="danger" title="อ่านรายการแก้หลังปิดไม่ได้">
        ลองรีเฟรชหน้า — การปิดเดือนและตัวเลขบน Dashboard ไม่ได้รับผลกระทบ
      </Alert>
    );
  }

  const n = countPostCloseEdits(state.rows);
  const shown = all ? state.rows : state.rows.slice(0, PREVIEW);
  return (
    <div>
      <h4 className="m-0 mb-2 text-[13px] font-semibold">
        แก้หลังปิด <span className="ml-1 rounded-full bg-surface-3 px-1.5 py-0.5 text-xs tabular-nums text-fg-muted">{n}</span>
      </h4>
      {n === 0 ? (
        <p className="m-0 text-[12.5px] text-fg-muted">ยังไม่มีการแก้ข้อมูลหลังปิด (นับจากเวลาปิด หรือคำนวณ snapshot ใหม่ครั้งล่าสุด)</p>
      ) : (
        <ul className="m-0 list-none p-0 text-[12.5px]">
          {shown.map((r, i) => {
            const v = describePostCloseEdit(r);
            return (
              <li key={`${r.changedAt}-${i}`} className="flex flex-col gap-0.5 border-t border-border py-2 sm:flex-row sm:gap-3">
                <span className="flex-none tabular-nums text-fg-muted sm:w-36">{v.when}</span>
                <span className="min-w-0">
                  <b>{v.what}</b> · {v.actionText} · {v.branch} · {v.by}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {n > PREVIEW && !all ? (
        <button type="button" onClick={() => setAll(true)} className="mt-2 min-h-11 text-[13px] text-accent underline md:min-h-9">
          แสดงทั้งหมด {n} รายการ
        </button>
      ) : null}
    </div>
  );
}
