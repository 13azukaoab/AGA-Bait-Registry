/**
 * DataTable — ตารางข้อมูลกลาง (ยังไม่มี sort/filter)
 *  - columns: กำหนดหัวคอลัมน์ + วิธีแสดงค่าในเซลล์ (cell) + การจัดชิด (align: left/right/center)
 *  - หัวตารางติดบน (sticky) — จะติดจริงเมื่อ wrapper มีความสูงจำกัด
 *    เช่นส่ง className="max-h-[70vh]" (ถ้าไม่จำกัดความสูง หัวตารางเลื่อนไปกับหน้าตามปกติ)
 *  - จอแคบ: wrapper เลื่อนแนวนอนได้ (overflow-x) ตารางไม่ดันหน้าจอล้น
 *  - ไม่มีแถว: แสดงข้อความ emptyMessage แทนตารางเปล่า
 *  - caption: คำอธิบายตารางสำหรับ screen reader (ซ่อนบนจอ)
 * สีทั้งหมดอ้าง token ใน app/globals.css ห้ามใส่ hex
 */
import type { ReactNode } from "react";
import { cx } from "./cx";

export type DataTableAlign = "left" | "right" | "center";

export type DataTableColumn<Row> = {
  /** คีย์เฉพาะของคอลัมน์ (ใช้เป็น React key) */
  key: string;
  /** ข้อความหัวคอลัมน์ */
  header: ReactNode;
  /** วิธีแสดงค่าในเซลล์ของแถวนั้น */
  cell: (row: Row) => ReactNode;
  align?: DataTableAlign;
  /** class เพิ่มของเซลล์ในคอลัมน์นี้ (เช่น ความกว้าง) */
  className?: string;
};

export type DataTableProps<Row> = {
  columns: ReadonlyArray<DataTableColumn<Row>>;
  rows: ReadonlyArray<Row>;
  /** คืนค่า key ที่ไม่ซ้ำของแถว (เช่น id) */
  getRowKey: (row: Row) => string;
  /** ข้อความเมื่อไม่มีแถว (ค่าเริ่มต้น: "ไม่พบรายการ") */
  emptyMessage?: ReactNode;
  /** คำอธิบายตารางสำหรับ screen reader */
  caption?: string;
  /** class ของกรอบตาราง (ใช้จำกัดความสูงให้ sticky header ทำงาน) */
  className?: string;
};

const ALIGN_CLASS: Record<DataTableAlign, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

const WRAPPER_CLASS =
  "overflow-auto rounded-card border border-border bg-surface shadow-[var(--shadow)]";

export function DataTable<Row>({
  columns,
  rows,
  getRowKey,
  emptyMessage = "ไม่พบรายการ",
  caption,
  className,
}: DataTableProps<Row>) {
  if (rows.length === 0) {
    return (
      <div
        className={cx(
          WRAPPER_CLASS,
          "px-3.5 py-6 text-center text-[13px] text-fg-muted",
          className,
        )}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={cx(WRAPPER_CLASS, className)}>
      <table className="w-full whitespace-nowrap border-collapse text-[13px]">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cx(
                  "sticky top-0 z-10 border-b border-border bg-surface-2 px-3 py-2.5",
                  "text-[11.5px] font-semibold text-fg-muted",
                  ALIGN_CLASS[col.align ?? "left"],
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)} className="group hover:bg-surface-2">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cx(
                    "border-b border-border px-3 py-2 group-last:border-b-0",
                    ALIGN_CLASS[col.align ?? "left"],
                    col.className,
                  )}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
