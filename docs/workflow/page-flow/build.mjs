/**
 * build.mjs — สร้างหน้า page flow แยกตามตำแหน่ง จาก flow-data.mjs + ภาพ thumbnail ใน page-flow/
 *
 *   node docs/workflow/page-flow/build.mjs              → docs/workflow/page-flow-by-role.html (ฉบับเต็ม)
 *   node docs/workflow/page-flow/build.mjs --preview    → docs/workflow/page-flow-preview.html (เฉพาะ lane ตัวอย่าง ไว้ขอ OK)
 *
 * ผลลัพธ์เป็นไฟล์ HTML เดียว (ฝังภาพเป็น data URI) · สีทั้งหมดอยู่ในบล็อก token ด้านบน (สว่าง/มืด) ห้ามใส่ hex ที่อื่น
 * ลำดับ: รัน capture.mjs thumbs (ถ้าภาพเปลี่ยน) → build.mjs → capture.mjs export (ได้ .png + .pdf)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LANES } from "./flow-data.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "..");
const PREVIEW = process.argv.includes("--preview");
const PREVIEW_LANES = ["start", "supervisor"];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cache = new Map();
const img = (key) => {
  if (!cache.has(key)) cache.set(key, "data:image/png;base64," + readFileSync(join(HERE, `${key}.png`)).toString("base64"));
  return cache.get(key);
};

const ARROW = `<svg class="arr" viewBox="0 0 80 14" aria-hidden="true" focusable="false"><path d="M2 7h72M66 1.5 74 7l-8 5.5"/></svg>`;
// ลูกศรลง (ใช้บนจอแคบที่ลำดับเรียงเป็นแนวตั้ง)
const ARROW_V = `<svg class="arrv" viewBox="0 0 14 34" aria-hidden="true" focusable="false"><path d="M7 2v28M1.5 24 7 32l5.5-8"/></svg>`;

function stepHtml(s, n) {
  const cls = ["step", s.opt ? "opt" : "", s.soon ? "soon" : ""].filter(Boolean).join(" ");
  const shots = s.fan
    ? `<div class="fan" role="img" aria-label="ภาพหน้าแรกของแต่ละตำแหน่ง">${s.fan.map((k) => `<img src="${img(k)}" alt="" loading="lazy">`).join("")}</div>`
    : `<img src="${img(s.shot)}" alt="ภาพตัวอย่างหน้า ${esc(s.title)}" loading="lazy" data-zoom>`;
  return `<li class="${cls}">
  <figure class="shot">${shots}<span class="num">${n}</span>${s.soon ? '<span class="tag">กำลังสร้าง</span>' : ""}</figure>
  <div class="txt"><h3>${esc(s.title)}</h3><p>${esc(s.does)}</p></div>
</li>`;
}

function linkHtml(label) {
  return `<li class="link" aria-hidden="false"><div class="lk">${ARROW}${ARROW_V}<span>${esc(label)}</span></div></li>`;
}

function rowHtml(row) {
  const items = [];
  row.steps.forEach((s, i) => {
    items.push(stepHtml(s, i + 1));
    if (i < row.steps.length - 1) items.push(linkHtml(s.next || "ถัดไป"));
  });
  return `${row.label ? `<h3 class="rowlabel">${esc(row.label)}</h3>` : ""}<ol class="flow">${items.join("\n")}</ol>`;
}

function laneHtml(l) {
  return `<section class="lane" id="lane-${l.id}" aria-labelledby="h-${l.id}">
  <header class="lh"><h2 id="h-${l.id}">${esc(l.title)}</h2><p class="who">${esc(l.who)}</p><p class="note">${esc(l.note)}</p></header>
  ${l.rows.map(rowHtml).join("\n")}
</section>`;
}

const lanes = PREVIEW ? LANES.filter((l) => PREVIEW_LANES.includes(l.id)) : LANES;

const CSS = `
:root{
  --bg:#f4f6f8; --card:#ffffff; --fg:#1c2733; --muted:#55657a; --line:#c9d3dd; --lane:#eceff3;
  --brand:#11695f; --brand-soft:#e6f2f0; --arrow:#5b6b80;
  --warn-ink:#976106; --warn-soft:#fbf0db; --shadow:rgba(28,39,51,.12); --scrim:rgba(0,0,0,.6);
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0f1720; --card:#16212d; --fg:#e6edf3; --muted:#9fb0c0; --line:#2a3a4a; --lane:#121c26;
  --brand:#4bbfae; --brand-soft:#15302d; --arrow:#8aa0b5;
  --warn-ink:#d99b3e; --warn-soft:#332713; --shadow:rgba(0,0,0,.5);
}}
:root[data-theme="dark"]{
  --bg:#0f1720; --card:#16212d; --fg:#e6edf3; --muted:#9fb0c0; --line:#2a3a4a; --lane:#121c26;
  --brand:#4bbfae; --brand-soft:#15302d; --arrow:#8aa0b5;
  --warn-ink:#d99b3e; --warn-soft:#332713; --shadow:rgba(0,0,0,.5);
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:'Noto Sans Thai',system-ui,sans-serif;font-size:14px;line-height:1.55}
.page{max-width:1600px;margin:0 auto;padding:28px 24px 36px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap;margin-bottom:18px}
.brand{font-size:12.5px;font-weight:600;color:var(--brand);letter-spacing:.02em;margin:0 0 2px}
h1{margin:0;font-size:30px;line-height:1.25;color:var(--brand);font-weight:700}
.sub{margin:8px 0 0;color:var(--muted);max-width:880px}
.tools{display:flex;gap:8px;align-items:center}
.btn{font:inherit;font-size:13px;min-height:44px;padding:0 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--fg);cursor:pointer}
.btn:focus-visible,a:focus-visible,img[data-zoom]:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.legend{display:flex;flex-wrap:wrap;gap:8px 22px;align-items:center;margin:0 0 18px;padding:12px 16px;border:1px solid var(--line);border-radius:12px;background:var(--card);font-size:12.5px;color:var(--muted)}
.legend .k{display:inline-flex;align-items:center;gap:8px}
.sw{display:inline-block;width:28px;height:18px;border-radius:5px;border:1.5px solid var(--line);background:var(--card)}
.sw.dash{border-style:dashed}
.sw.arrow{border:0;background:none;color:var(--arrow);width:32px;height:14px}
.sw.arrow svg{width:32px;height:14px;display:block}
.pv{margin:0 0 16px;padding:10px 14px;border-radius:10px;background:var(--warn-soft);color:var(--warn-ink);font-weight:600}
.lane{background:var(--lane);border-radius:14px;padding:16px 18px 18px;margin:0 0 16px}
.lh h2{margin:0;font-size:20px;line-height:1.3}
.who{margin:2px 0 0;font-weight:600;color:var(--fg);font-size:13.5px}
.note{margin:2px 0 12px;color:var(--muted);font-size:13px}
.rowlabel{margin:12px 0 6px;font-size:13px;color:var(--brand);font-weight:700}
ol.flow{list-style:none;margin:0;padding:0 0 4px;display:flex;align-items:flex-start;flex-wrap:nowrap;overflow-x:auto}
.step{flex:0 0 168px;width:168px;margin:0}
.shot{position:relative;margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--card);box-shadow:0 1px 3px var(--shadow)}
.step.opt .shot{border-style:dashed;border-width:2px}
.shot img{display:block;width:100%;aspect-ratio:8/5;object-fit:cover;object-position:top}
.shot img[data-zoom]{cursor:zoom-in}
.num{position:absolute;top:6px;left:6px;min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:var(--brand);color:var(--card);font-size:12px;font-weight:700;line-height:22px;text-align:center}
.tag{position:absolute;top:6px;right:6px;padding:1px 8px;border-radius:9px;background:var(--warn-soft);color:var(--warn-ink);font-size:12px;font-weight:600;line-height:1.6;border:1px solid var(--warn-ink);white-space:nowrap}
.txt{padding:7px 2px 0}
.txt h3{margin:0;font-size:13.5px;line-height:1.35;font-weight:600}
.txt p{margin:2px 0 0;color:var(--muted);font-size:12.5px;line-height:1.5}
.link{flex:1 1 100px;min-width:92px;max-width:150px;padding-top:47px;list-style:none}
.lk{display:flex;flex-direction:column;align-items:center;gap:4px;padding:0 6px;color:var(--arrow)}
.arr,.arrv{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.arr{width:100%;max-width:84px;height:14px}
.arrv{display:none;width:14px;height:34px;flex:none}
.lk span{font-size:12px;line-height:1.4;color:var(--fg);text-align:center;text-wrap:balance;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:3px 7px}
.fan{position:relative;aspect-ratio:8/5;background:var(--card)}
.fan img{position:absolute;width:68%;aspect-ratio:8/5;object-fit:cover;object-position:top;border:1px solid var(--line);border-radius:6px;box-shadow:0 1px 3px var(--shadow)}
.fan img:nth-child(1){left:3%;top:4%}
.fan img:nth-child(2){left:16%;top:22%}
.fan img:nth-child(3){left:29%;top:40%}
footer{margin-top:14px;color:var(--muted);font-size:12px}
dialog{border:0;padding:0;background:none;max-width:min(96vw,1000px);width:100%}
dialog::backdrop{background:var(--scrim)}
dialog img{width:100%;height:auto;border-radius:10px;display:block}
dialog p{margin:8px 0 0;color:var(--card);text-align:center;font-weight:600}
@media (max-width:760px){
  .page{padding:18px 16px 28px}
  h1{font-size:23px}
  ol.flow{flex-direction:column;align-items:stretch;overflow-x:visible}
  .step{flex:none;width:100%;display:grid;grid-template-columns:132px 1fr;gap:12px;align-items:start}
  .txt{padding:0}
  .link{flex:none;max-width:none;min-width:0;padding:6px 0 6px 40px}
  .lk{flex-direction:row;align-items:center;gap:10px;padding:0}
  .arr{display:none}
  .arrv{display:block}
  .lk span{text-align:left}
}
@media print{
  body{background:var(--card)}
  .tools{display:none}
}
`;

const JS = `
(function(){
  var root=document.documentElement;
  try{var t=localStorage.getItem('aga-theme'); if(t) root.setAttribute('data-theme',t);}catch(e){}
  var b=document.getElementById('themeBtn');
  if(b) b.addEventListener('click',function(){
    var cur=root.getAttribute('data-theme');
    var dark=cur?cur==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
    var next=dark?'light':'dark';
    root.setAttribute('data-theme',next);
    try{localStorage.setItem('aga-theme',next)}catch(e){}
  });
  if(location.search.indexOf('export=1')>=0){var tl=document.querySelector('.tools'); if(tl) tl.hidden=true;}
  var dlg=document.getElementById('zoom'), zi=dlg.querySelector('img'), zc=dlg.querySelector('p');
  document.querySelectorAll('img[data-zoom]').forEach(function(im){
    im.tabIndex=0;
    var open=function(){ zi.src=im.src; zc.textContent=im.alt.replace('ภาพตัวอย่างหน้า ',''); if(dlg.showModal) dlg.showModal(); };
    im.addEventListener('click',open);
    im.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){e.preventDefault();open();} });
  });
  dlg.addEventListener('click',function(){ dlg.close(); });
})();
`;

const title = PREVIEW ? "ตัวอย่าง page flow (ขอ OK) — AGA Bait Registry" : "Page flow แยกตามตำแหน่ง — AGA Bait Registry";
const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<!--
  Page flow แยกตามตำแหน่ง — ภาพหน้าจอย่อ + ลูกศร (ปุ่ม/เมนูที่กดไปหน้าถัดไป) หนึ่งแถวต่อหนึ่งตำแหน่ง
  ไฟล์นี้สร้างอัตโนมัติ ห้ามแก้มือ: แก้ข้อความที่ page-flow/flow-data.mjs · ภาพที่ page-flow/capture.mjs · แล้วรัน page-flow/build.mjs
  ที่มา: SPEC §5 §5.1 §8 · components/shell/nav-items.ts · docs/mockup (FINAL, ข้อมูลสมมติ) · docs/คู่มือผู้ใช้
-->
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<div class="page">
  <div class="top">
    <div>
      <p class="brand">Advance Group Asia (AGA) · AGA Bait Registry</p>
      <h1>Page flow แยกตามตำแหน่ง</h1>
      <p class="sub">แต่ละตำแหน่งเข้าระบบแล้วไปหน้าไหนต่อ — ภาพคือหน้าจอตัวอย่าง (ข้อมูลสมมติ) ลูกศรบอกว่ากดปุ่มหรือเมนูอะไรเพื่อไปหน้าถัดไป · กดที่ภาพเพื่อดูภาพใหญ่</p>
    </div>
    <div class="tools"><button class="btn" id="themeBtn" type="button">สลับโหมดสว่าง / มืด</button></div>
  </div>
  ${PREVIEW ? '<p class="pv">ตัวอย่างขอ OK — แสดงเฉพาะ 2 แถว (เริ่มใช้งานครั้งแรก + หัวหน้างาน) ยังไม่ใช่ฉบับสุดท้าย</p>' : ""}
  <div class="legend" role="group" aria-label="คำอธิบายสัญลักษณ์">
    <span class="k"><i class="sw"></i> กรอบทึบ = ทำทุกเดือน</span>
    <span class="k"><i class="sw dash"></i> กรอบประ = ทำเมื่อมีงาน</span>
    <span class="k"><span class="tag" style="position:static">กำลังสร้าง</span> หน้านี้ยังไม่เปิดใช้ในระบบจริง (ภาพคือแบบที่อนุมัติแล้ว)</span>
    <span class="k"><i class="sw arrow">${ARROW}</i> ข้อความบนลูกศร = ปุ่มหรือเมนูที่กด</span>
  </div>
  ${lanes.map(laneHtml).join("\n")}
  <footer>ฉบับ 18 พ.ย. 2026 · อ้างอิง SPEC §5 §5.1 §8 · ภาพทั้งหมดถ่ายจาก mockup (ข้อมูลสมมติ ไม่ใช่ลูกค้าหรือพนักงานจริง)</footer>
</div>
<dialog id="zoom" aria-label="ภาพหน้าจอขยาย"><img alt=""><p></p></dialog>
<script>${JS}</script>
</body>
</html>
`;

const outName = PREVIEW ? "page-flow-preview.html" : "page-flow-by-role.html";
writeFileSync(join(OUT_DIR, outName), html, "utf-8");
console.log(`สร้าง ${outName} (${(html.length / 1024).toFixed(0)} KB · ${lanes.length} แถวตำแหน่ง)`);
