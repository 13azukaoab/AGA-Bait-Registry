import Link from "next/link";

// หน้าแรก (scaffold) — รวมลิงก์ไปหน้าจอต่างๆ ตาม SPEC §8 ไว้ตรวจว่าโครงเดินได้
export default function Home() {
  return (
    <main className="stub">
      <span className="stub-badge">AGA Bait Registry</span>
      <h1>ระบบทะเบียนบริการ Bait</h1>
      <p>
        โครงโปรเจกต์เฟสแรก (Next.js + TypeScript + PWA) — หน้าจอด้านล่างยังเป็นโครง
        รอลงมือทำฟีเจอร์จริงตาม SPEC §8
      </p>
      <nav className="stub-nav">
        <Link href="/login">เข้าสู่ระบบ</Link>
        <Link href="/todo">ต้องทำ</Link>
        <Link href="/customers">ทะเบียนลูกค้า</Link>
        <Link href="/service">กรอกผล IG/IC</Link>
        <Link href="/bait">กล่องเหยื่อ AG</Link>
        <Link href="/collection">รอเก็บสถานี</Link>
        <Link href="/admin">ผู้ดูแลระบบ</Link>
        <Link href="/summary">สรุปตัวเลข (public)</Link>
      </nav>
    </main>
  );
}
