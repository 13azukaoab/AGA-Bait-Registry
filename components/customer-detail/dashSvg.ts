/**
 * ตัวสร้าง SVG ของกราฟแท็บ "ภาพรวม" (ข้อความ SVG ล้วน — ทดสอบได้ · ใช้ทั้งบนหน้าและตอนบันทึกเป็นรูป PNG)
 *
 * Logic summary:
 *   * 2 ช่วงแกนเดือนเดียวกัน: บน "พบปลวก" = แท่งซ้อน สถานีภายนอก (IG+IC) + AG · ล่าง "เปลี่ยนไม้" = แท่งเดียว สเกลของตัวเอง
 *   * สีอ้าง CSS variable (--c-ext / --c-ag / --c-timber / --fg …) — ตอนส่งออก PNG ผู้เรียกแทน var(--x) เป็นสีจริงของธีมตอนนั้น
 *   * ทุกข้อความที่มาจากข้อมูล (หมายเลขสถานี) ผ่าน esc() — ใช้กับ innerHTML ได้อย่างปลอดภัย
 *   * ตัวอักษรไม่ต่ำกว่า 12px (กฎ UX)
 */
import { dashHasFind, dashPoints, daNiceMax, monthShortTh, monthTh, type DashFilter, type DashMonth } from "./logic";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function daCodes(a: readonly string[]): string {
  return a.length > 40 ? `${a.slice(0, 40).join(", ")} … +${a.length - 40}` : a.join(", ");
}

export interface DashHeader {
  t1: string;
  t2: string;
  foot: string;
}

export function dashSvg(rows: readonly DashMonth[], f: DashFilter, opts: { hdr?: DashHeader; tall?: number } = {}): string {
  const { hdr } = opts;
  const n = rows.length;
  const showA = dashHasFind(f);
  const showB = f.timber;
  const st = n <= 12 ? 54 : n <= 24 ? 38 : 26;
  const bw = n <= 12 ? 30 : n <= 24 ? 24 : 18;
  const fs = 12;
  const L = 40;
  const R = 10;
  const W = L + n * st + R;
  const total = opts.tall ?? (showA && showB ? 390 : 300);
  const hA = showA && showB ? Math.round(total * 0.5) : total;
  const hB = showA && showB ? total - hA : total;
  const maxA = Math.max(4, ...rows.map((r) => dashPoints(r, f)));
  const gsA = maxA > 20 ? 5 : maxA > 10 ? 2 : 1;
  const maxT = Math.max(0, ...rows.map((r) => r.t));
  const gsB = maxT > 40 ? 10 : maxT > 20 ? 5 : 2;
  const maxB = daNiceMax(Math.max(maxT, 1), gsB);
  const off = hdr ? 58 : 0;
  const extra = hdr ? 46 : 0;
  let out = "";

  const grid = (top: number, h: number, max: number, gs: number, label: string) => {
    let o = `<text x="2" y="${top - 10}" font-size="${fs + 1}" font-weight="600" fill="var(--fg)">${esc(label)}</text>`;
    for (let g = 0; g <= max; g += gs) {
      const yy = top + h - (g * h) / max;
      o += `<line x1="${L}" x2="${W - R + 6}" y1="${yy}" y2="${yy}" stroke="var(--border)" stroke-width="0.5"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="${fs}" fill="var(--fg-muted)">${g}</text>`;
    }
    return o;
  };

  const tA = 26;
  if (showA) out += grid(tA, hA, maxA, gsA, "พบปลวก (จุด)");
  const tB = showA ? tA + hA + 44 : 26;
  if (showB) out += grid(tB, hB, maxB, gsB, "เปลี่ยนไม้ (จุด)");
  const bottom = showB ? tB + hB : tA + hA;

  rows.forEach((r, i) => {
    const x = L + i * st + (st - bw) / 2;
    const mo = Number(r.month.slice(5, 7));
    const fut = r.state === "fut";
    const cx = x + bw / 2;
    if (showA) {
      const e = f.ext ? r.ext : 0;
      const a = f.ag ? r.ag : 0;
      let yy = tA + hA;
      const he = (e * hA) / maxA;
      const ha = (a * hA) / maxA;
      if (e > 0) {
        yy -= he;
        out += `<rect x="${x}" y="${yy}" width="${bw}" height="${he}" fill="var(--c-ext)"${a > 0 ? "" : ' rx="3"'} stroke="var(--surface-2)" stroke-width="2"><title>${esc(monthTh(r.month))} · สถานีภายนอก: ${e} จุด (IG ${r.ig} · IC ${r.ic})\n${esc(daCodes([...r.igL, ...r.icL]))}</title></rect>`;
      }
      if (a > 0) {
        yy -= ha;
        out += `<rect x="${x}" y="${yy}" width="${bw}" height="${ha}" rx="3" fill="var(--c-ag)" stroke="var(--surface-2)" stroke-width="2"><title>${esc(monthTh(r.month))} · AG: ${a} จุด\n${esc(daCodes(r.agL))}</title></rect>`;
      }
      if (e + a > 0) out += `<text x="${cx}" y="${yy - 5}" text-anchor="middle" font-size="${fs}" font-weight="600" fill="var(--fg)">${e + a}</text>`;
      else if (fut) out += `<rect x="${x}" y="${tA + hA - 3}" width="${bw}" height="3" rx="1.5" fill="var(--border-strong)"/>`;
    }
    if (showB) {
      const v = r.t;
      const h3 = (v * hB) / maxB;
      if (v > 0)
        out += `<rect x="${x}" y="${tB + hB - h3}" width="${bw}" height="${h3}" rx="3" fill="var(--c-timber)"><title>${esc(monthTh(r.month))} · เปลี่ยนไม้: ${v} จุด\n${esc(daCodes(r.tL))}</title></rect><text x="${cx}" y="${tB + hB - h3 - 5}" text-anchor="middle" font-size="${fs}" font-weight="600" fill="var(--fg)">${v}</text>`;
      else if (fut) out += `<rect x="${x}" y="${tB + hB - 3}" width="${bw}" height="3" rx="1.5" fill="var(--border-strong)"/>`;
    }
    out += `<text x="${cx}" y="${bottom + 18}" text-anchor="middle" font-size="${fs}" fill="${r.state === "miss" ? "var(--danger)" : fut ? "var(--fg-faint)" : "var(--fg-muted)"}">${esc(monthShortTh(r.month))}</text>`;
    if (r.state === "miss") out += `<text x="${cx}" y="${bottom + 32}" text-anchor="middle" font-size="${fs}" fill="var(--danger)">ตก</text>`;
    else if (mo === 1 || i === 0) out += `<text x="${cx}" y="${bottom + 32}" text-anchor="middle" font-size="${fs}" fill="var(--fg-faint)">${esc(r.month.slice(2, 4))}</text>`;
  });

  const TH = bottom + 42 + off + extra;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${TH}" width="${W}" height="${TH}" role="img" aria-label="กราฟจำนวนจุดรายเดือนบริการ แยกช่วงพบปลวกและเปลี่ยนไม้" font-family="'Noto Sans Thai',Tahoma,sans-serif"><title>จำนวนจุดรายเดือนบริการ</title>`;
  if (hdr) s += `<rect width="100%" height="100%" fill="var(--surface)"/><text x="12" y="26" font-size="17" font-weight="600" fill="var(--fg)">${esc(hdr.t1)}</text><text x="12" y="46" font-size="12" fill="var(--fg-muted)">${esc(hdr.t2)}</text>`;
  s += `<g transform="translate(0,${off})">${out}</g>`;
  if (hdr) {
    const ly = bottom + 42 + off + 16;
    let lx = 12;
    const items: [string, string][] = [];
    if (f.ext) items.push(["var(--c-ext)", "สถานีภายนอก (IG+IC)"]);
    if (f.ag) items.push(["var(--c-ag)", "AG"]);
    if (f.timber) items.push(["var(--c-timber)", "เปลี่ยนไม้"]);
    for (const it of items) {
      s += `<rect x="${lx}" y="${ly - 9}" width="10" height="10" rx="2" fill="${it[0]}"/><text x="${lx + 16}" y="${ly}" font-size="12" fill="var(--fg-muted)">${esc(it[1])}</text>`;
      lx += 16 + it[1].length * 7 + 20;
    }
    s += `<text x="12" y="${ly + 22}" font-size="12" fill="var(--fg-faint)">${esc(hdr.foot)}</text>`;
  }
  return `${s}</svg>`;
}
