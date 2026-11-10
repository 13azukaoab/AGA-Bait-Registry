"use client";

/**
 * กราฟเส้น "มูลค่ารายเดือน · ส่วนกลาง vs ต่างจังหวัด" — SVG เขียนเอง (ไม่พึ่งไลบรารีกราฟ)
 *
 * - วัดความกว้างจริงด้วย ResizeObserver แล้ววาดเป็นพิกเซล → ตัวหนังสือไม่ถูกย่อบนมือถือ 375px
 * - สี: ส่วนกลาง = --accent (น้ำเงิน) · ต่างจังหวัด = --warn (เหลือง) เหมือนการ์ดสรุปด้านบน
 *   ใช้ var() ล้วน ไม่มี hex · เส้นต่างจังหวัดเป็นเส้นประ + จุดคนละรูปทรง เพื่อไม่พึ่งสีอย่างเดียว
 * - เลื่อนเมาส์/แตะ/ใช้ลูกศรซ้ายขวา เพื่อดูตัวเลขของเดือนนั้น · มีตารางข้อมูลสำรองสำหรับ screen reader
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { TrendPoint } from "./calc";
import { formatBahtShort } from "./format";

type Props = { points: readonly TrendPoint[] };

const HEIGHT = 280;
const M = { top: 12, right: 26, bottom: 30, left: 56 };
const SERIES = [
  { id: "central", label: "ส่วนกลาง", color: "var(--accent)", dash: undefined },
  { id: "province", label: "ต่างจังหวัด", color: "var(--warn)", dash: "5 4" },
] as const;

/** ค่าสูงสุดของแกน Y ปัดขึ้นเป็นเลขกลม */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const f = max / pow;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return step * pow;
}

export function TrendChart({ points }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const plotW = Math.max(width - M.left - M.right, 10);
  const plotH = HEIGHT - M.top - M.bottom;
  const yMax = niceMax(Math.max(...points.map((p) => Math.max(p.central, p.province)), 0));
  const x = (i: number) => M.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => M.top + plotH - (v / yMax) * plotH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);
  // ป้ายแกน X: เว้นช่วงให้ไม่ชนกัน (ป้ายละ ~52px)
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 52))));

  const pathOf = (id: "central" | "province") =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[id]).toFixed(1)}`).join(" ");

  const pickIndex = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left;
    if (n <= 1) return 0;
    const i = Math.round(((px - M.left) / plotW) * (n - 1));
    return Math.min(n - 1, Math.max(0, i));
  };
  const onPointer = (e: PointerEvent<SVGSVGElement>) =>
    setActive(pickIndex(e.clientX, e.currentTarget.getBoundingClientRect()));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActive((a) => Math.max(0, (a ?? n) - 1));
    } else if (e.key === "Escape") {
      setActive(null);
    }
  };

  const activePoint = active !== null ? points[active] : undefined;
  const tipLeft = activePoint && active !== null ? x(active) : 0;
  const flip = tipLeft > width * 0.6;

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-fg-muted">
        {SERIES.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="22" y2="4" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dash} />
            </svg>
            {s.label}
          </span>
        ))}
      </div>

      <div ref={wrapRef} className="relative" style={{ height: HEIGHT }}>
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`กราฟเส้นมูลค่ารายเดือน ส่วนกลางเทียบต่างจังหวัด ${n} เดือน (ใช้ลูกศรซ้ายขวาเพื่อดูแต่ละเดือน)`}
            tabIndex={0}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            className="touch-pan-y rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {/* เส้นกริด + ป้ายแกน Y */}
            {yTicks.map((t) => (
              <g key={t}>
                <line
                  x1={M.left}
                  x2={M.left + plotW}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <text
                  x={M.left - 8}
                  y={y(t)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize="11"
                  fill="var(--fg-muted)"
                >
                  {formatBahtShort(t)}
                </text>
              </g>
            ))}

            {/* ป้ายแกน X */}
            {points.map((p, i) =>
              // นับจากเดือนล่าสุดย้อนไป → เดือนล่าสุดมีป้ายเสมอ และป้ายไม่ชนกัน
              (n - 1 - i) % labelEvery === 0 ? (
                <text
                  key={p.ym}
                  x={x(i)}
                  y={HEIGHT - 10}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--fg-muted)"
                >
                  {p.key}
                </text>
              ) : null,
            )}

            {/* เส้นนำสายตาของเดือนที่ชี้ */}
            {active !== null && (
              <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} stroke="var(--border-strong)" strokeWidth="1" />
            )}

            {/* เส้นข้อมูล */}
            {SERIES.map((s) => (
              <g key={s.id}>
                {n > 1 && (
                  <path
                    d={pathOf(s.id)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2.5"
                    strokeDasharray={s.dash}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {points.map((p, i) =>
                  n <= 24 || i === n - 1 || i === active ? (
                    s.id === "central" ? (
                      <circle key={p.ym} cx={x(i)} cy={y(p.central)} r={i === active ? 5 : 3} fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />
                    ) : (
                      <rect
                        key={p.ym}
                        x={x(i) - (i === active ? 4.5 : 3)}
                        y={y(p.province) - (i === active ? 4.5 : 3)}
                        width={i === active ? 9 : 6}
                        height={i === active ? 9 : 6}
                        fill={s.color}
                        stroke="var(--surface)"
                        strokeWidth="1.5"
                      />
                    )
                  ) : null,
                )}
              </g>
            ))}
          </svg>
        )}

        {activePoint && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-10 min-w-[150px] rounded-lg border border-border-strong bg-surface px-3 py-2 text-xs text-fg shadow-lg"
            style={flip ? { right: width - tipLeft + 10 } : { left: tipLeft + 10 }}
          >
            <b className="block text-[12.5px]">{activePoint.key}</b>
            <span className="mt-1 flex items-center justify-between gap-4">
              <span className="text-fg-muted">ส่วนกลาง</span>
              <b className="num">{formatBahtShort(activePoint.central)}</b>
            </span>
            <span className="flex items-center justify-between gap-4">
              <span className="text-fg-muted">ต่างจังหวัด</span>
              <b className="num">{formatBahtShort(activePoint.province)}</b>
            </span>
          </div>
        )}
      </div>

      {/* ข้อมูลสำรองสำหรับ screen reader */}
      <table className="sr-only">
        <caption>มูลค่ารายเดือน ส่วนกลางและต่างจังหวัด</caption>
        <thead>
          <tr>
            <th scope="col">เดือน</th>
            <th scope="col">ส่วนกลาง</th>
            <th scope="col">ต่างจังหวัด</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.ym}>
              <th scope="row">{p.key}</th>
              <td>{formatBahtShort(p.central)}</td>
              <td>{formatBahtShort(p.province)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
