"use client";

/**
 * DuplicateCustomerDialog — กล่องถามเมื่อพบลูกค้าชื่อซ้ำในสาขาเดียวกัน (RPC ตอบ AG001)
 *
 * Logic summary:
 *   * แสดงรายชื่อลูกค้าที่ซ้ำ (ชื่อ · ประเภท · เลขที่สัญญาล่าสุด) ให้ผู้ใช้เลือก
 *     - "ใช้ลูกค้ารายนี้" → สัญญาใหม่ผูกกับลูกค้ารายที่เลือก (ไม่สร้างลูกค้าใหม่)
 *     - "เป็นคนละราย" → สร้างลูกค้าใหม่ (ชื่อซ้ำกันได้ ลง audit)
 *   * ปิดกล่อง (✕ / Esc / กดฉากหลัง) = ยกเลิก — แถวนั้นยังไม่ถูกบันทึกและค้างไว้พร้อมข้อความ
 *   * ตัดสินใจครั้งเดียวต่อกล่อง (`done` กันส่งผลซ้ำจากเหตุการณ์ close ที่ตามมาหลังเลือก)
 */
import { useRef } from "react";

import { Button } from "@/components/ui";

import type { DuplicateChoice, DuplicateCustomerMatch } from "./duplicateCustomer";
import { Modal } from "./Modal";

export function DuplicateCustomerDialog({
  customerName,
  contractNo,
  matches,
  typeLabel,
  onChoose,
}: {
  customerName: string;
  contractNo: string;
  matches: DuplicateCustomerMatch[];
  /** แปลงรหัสประเภทลูกค้าเป็นชื่อ (ไม่เจอใช้รหัสเอง) */
  typeLabel: (code: string) => string;
  onChoose: (choice: DuplicateChoice) => void;
}) {
  const done = useRef(false);
  const choose = (choice: DuplicateChoice) => {
    if (done.current) return;
    done.current = true;
    onChoose(choice);
  };

  return (
    <Modal
      title="พบลูกค้าชื่อนี้ในสาขาแล้ว"
      subtitle={`สัญญา ${contractNo || "—"} · “${customerName}”`}
      onClose={() => choose({ kind: "cancel" })}
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="m-0 text-fg-muted">
          ในสาขานี้มีลูกค้าชื่อเดียวกัน {matches.length} ราย — เป็นรายเดียวกันหรือไม่? เลือกรายเดิมเพื่อไม่ให้นับลูกค้าซ้ำ
          หรือเลือก “เป็นคนละราย” ถ้าเป็นคนละคนที่ชื่อตรงกัน
        </p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {matches.map((m) => (
            <li
              key={m.customerId}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
            >
              <span className="min-w-0 flex-1 break-words">
                <span className="font-semibold">{m.name}</span>
                <span className="block text-[12px] text-fg-muted">
                  {m.customerType ? typeLabel(m.customerType) : "ยังไม่ระบุประเภท"} ·{" "}
                  {m.latestContractNo ? (
                    <>
                      สัญญาล่าสุด <span className="num">{m.latestContractNo}</span>
                    </>
                  ) : (
                    "ยังไม่มีสัญญา"
                  )}
                </span>
              </span>
              <Button
                size="sm"
                variant="primary"
                onClick={() => choose({ kind: "existing", customerId: m.customerId })}
              >
                ใช้ลูกค้ารายนี้
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          <Button size="sm" onClick={() => choose({ kind: "cancel" })}>
            ยกเลิก (ยังไม่บันทึกแถวนี้)
          </Button>
          <Button size="sm" onClick={() => choose({ kind: "new" })}>
            เป็นคนละราย · สร้างลูกค้าใหม่
          </Button>
        </div>
      </div>
    </Modal>
  );
}
