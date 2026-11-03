/**
 * โครงหน้าจอชั่วคราว (scaffold) — ใช้ยึดเส้นทาง (route) ให้ครบตาม SPEC §8
 * ก่อนลงมือทำฟีเจอร์จริง จะถูกแทนด้วยหน้าจริงทีละหน้า
 */
export function ScreenStub({
  no,
  title,
  note,
}: {
  no: number;
  title: string;
  note?: string;
}) {
  return (
    <main className="stub">
      <span className="stub-badge">จอ {no}</span>
      <h1>{title}</h1>
      {note ? <p>{note}</p> : null}
      <p className="stub-tag">โครงหน้าจอ — ยังไม่ลงมือทำฟีเจอร์ (scaffold)</p>
    </main>
  );
}
