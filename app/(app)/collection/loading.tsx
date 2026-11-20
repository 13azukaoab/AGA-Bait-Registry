/** สถานะกำลังโหลดของ /collection — ข้อความภาษาไทย + โครงเปล่าให้หน้าไม่กระโดด */
export default function CollectionLoading() {
  return (
    <div className="mx-auto max-w-[1200px] p-4 max-[767px]:p-3" role="status" aria-live="polite">
      <h1 className="m-0 text-[22px] font-bold max-[767px]:text-xl">ลูกค้ารอเก็บสถานี</h1>
      <p className="mb-3.5 mt-0.5 text-[13px] text-fg-muted">กำลังโหลดรายการ…</p>
      <div className="grid grid-cols-2 gap-3 max-[767px]:grid-cols-1" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="h-[120px] animate-pulse rounded-[10px] border border-border bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
