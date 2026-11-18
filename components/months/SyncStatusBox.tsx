/**
 * กล่อง "สถานะส่ง Dashboard" — ดูอย่างเดียว (ไม่มีปุ่มสั่งส่ง) · ใช้แทนหน้า /admin/sync สำหรับ recorder (DECISIONS 2.72)
 *
 * Logic summary: แสดงรอบส่งล่าสุดต่อช่องทางจาก RPC get_sync_status (เวลา/ผล/รหัสผิดพลาดเท่านั้น)
 *   แปลงข้อความด้วย describeSyncRows · config_missing = "ยังไม่ได้ตั้งค่าการเชื่อมต่อ" (โทนกลาง ไม่ใช่ error)
 */
import { Chip, cx } from "@/components/ui";

import { describeSyncRows, formatBangkok, type SyncStatusRow } from "./monthsLogic";

const TONE_CHIP = { ok: "ok", warn: "pend", danger: "miss", na: "na" } as const;

export function SyncStatusBox({ rows }: { rows: SyncStatusRow[] }) {
  const views = describeSyncRows(rows);
  return (
    <section aria-label="สถานะส่ง Dashboard" className="rounded-[10px] border border-border bg-surface p-3">
      <h2 className="m-0 mb-2 text-[13px] font-semibold">สถานะส่ง Dashboard</h2>
      {views.length === 0 ? (
        <p className="m-0 text-[12.5px] text-fg-muted">ยังไม่เคยส่งข้อมูลไป Dashboard</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {views.map((v) => (
            <li key={v.source} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-t border-border py-1.5 first:border-t-0 first:pt-0">
              <span className="text-[12.5px]">
                {v.label}
                <span className="ml-1.5 tabular-nums text-fg-muted">{formatBangkok(v.at)}</span>
                {v.detail ? <span className={cx("block text-[12px] text-danger")}>{v.detail}</span> : null}
              </span>
              <Chip tone={TONE_CHIP[v.tone]}>{v.status}</Chip>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
