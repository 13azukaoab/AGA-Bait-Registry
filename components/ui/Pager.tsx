/**
 * Pager — แถบแบ่งหน้า: "แสดง n–m จาก N รายการ" + ปุ่มก่อนหน้า/ถัดไป
 *  - page เริ่มนับที่ 1 · pageSize = จำนวนแถวต่อหน้า · total = จำนวนรายการทั้งหมด
 *  - ปุ่มก่อนหน้าปิดเมื่ออยู่หน้าแรก · ปุ่มถัดไปปิดเมื่ออยู่หน้าสุดท้าย
 *  - total = 0 แสดง "ไม่มีรายการ" และปิดทั้งสองปุ่ม
 *  - ไม่เก็บ state เอง: หน้าที่เรียกใช้ถือค่า page แล้วรับ onPageChange
 */
import { Button } from "./Button";
import { cx } from "./cx";

export type PagerProps = {
  /** หน้าปัจจุบัน (เริ่มที่ 1) */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (nextPage: number) => void;
  className?: string;
};

/** จัดรูปตัวเลขแบบคั่นหลักพัน — ระบุ locale ตายตัวเพื่อไม่ให้ server/client แสดงต่างกัน */
function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function Pager({ page, pageSize, total, onPageChange, className }: PagerProps) {
  const lastPage = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const current = Math.min(Math.max(1, page), lastPage);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  return (
    <nav
      aria-label="แบ่งหน้า"
      className={cx(
        "flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-fg-muted",
        className,
      )}
    >
      <p className="m-0 num" aria-live="polite">
        {total === 0
          ? "ไม่มีรายการ"
          : `แสดง ${formatCount(from)}–${formatCount(to)} จาก ${formatCount(total)} รายการ`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={total === 0 || current <= 1}
          onClick={() => onPageChange(current - 1)}
        >
          ก่อนหน้า
        </Button>
        <span className="num">
          หน้า {formatCount(current)}/{formatCount(lastPage)}
        </span>
        <Button
          size="sm"
          disabled={total === 0 || current >= lastPage}
          onClick={() => onPageChange(current + 1)}
        >
          ถัดไป
        </Button>
      </div>
    </nav>
  );
}
