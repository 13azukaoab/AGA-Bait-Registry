/** สถานะกำลังโหลดของ /sales — ข้อความภาษาไทย + โครงเปล่าให้หน้าไม่กระโดด */
export default function SalesLoading() {
  return (
    <div className="mx-auto max-w-[1200px] p-4 max-[767px]:p-3" role="status" aria-live="polite">
      <h1 className="m-0 text-[22px] font-bold max-[767px]:text-xl">Dashboard งานขาย (New/Renew)</h1>
      <p className="mb-3.5 mt-0.5 text-[13px] text-fg-muted">กำลังโหลดข้อมูลงานขาย…</p>
      <div className="grid grid-cols-4 gap-3 max-[1000px]:grid-cols-2" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[96px] animate-pulse rounded-[10px] border border-border bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
