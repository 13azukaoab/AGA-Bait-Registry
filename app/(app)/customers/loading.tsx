/** สถานะกำลังโหลดของ /customers — ข้อความภาษาไทย + โครงเปล่าให้หน้าไม่กระโดด */
export default function CustomersLoading() {
  return (
    <div className="mx-auto max-w-[1280px] p-4 max-[767px]:p-3" role="status" aria-live="polite">
      <h1 className="m-0 text-[22px] font-bold max-[767px]:text-xl">ทะเบียนลูกค้า / สัญญา</h1>
      <p className="mb-3.5 mt-0.5 text-[13px] text-fg-muted">กำลังโหลดทะเบียน…</p>
      <div className="h-[72px] animate-pulse rounded-xl border border-border bg-surface-2" aria-hidden="true" />
      <div className="mt-3 flex flex-col gap-2" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[56px] animate-pulse rounded-lg border border-border bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
