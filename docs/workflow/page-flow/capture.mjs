/**
 * capture.mjs — ถ่ายภาพ thumbnail จาก mockup + ส่งออก PNG/PDF ของหน้า page-flow-by-role.html
 *
 * ใช้ Edge แบบ headless คุมผ่าน CDP (DevTools Protocol) — ไม่ต้องติดตั้งแพ็กเกจเพิ่ม (ใช้ WebSocket ที่มากับ Node 22+)
 * ถ่ายจาก mockup (docs/mockup/*.html — ข้อมูลสมมติ) เท่านั้น ห้ามถ่ายแอปจริงหรือข้อมูลจริง
 *
 * วิธีใช้ (รันจากโฟลเดอร์ไหนก็ได้):
 *   node docs/workflow/page-flow/capture.mjs thumbs            ถ่ายครบทุกภาพ
 *   node docs/workflow/page-flow/capture.mjs thumbs s-todo     ถ่ายเฉพาะ key ที่ระบุ
 *   node docs/workflow/page-flow/capture.mjs export [ชื่อ]     ส่งออก page-flow-by-role.png + .pdf (หรือชื่ออื่น เช่น page-flow-preview)
 *   node docs/workflow/page-flow/capture.mjs shot <html> <out.png> <กว้าง> [dark]   ถ่ายเต็มหน้าที่ความกว้างที่กำหนด (ตรวจ 375px)
 *
 * ตั้ง EDGE_PATH ถ้า Edge ไม่ได้อยู่ที่ตำแหน่งปกติ
 * ภาพ thumbnail: จอ 1280x800 ธีมสว่าง ย่อ 0.6 → 768x480 · ซ่อนแผง "เฉพาะ mockup" (.mk) เพราะไม่ใช่ส่วนของระบบจริง
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCKUP = resolve(HERE, "../../mockup");
const EDGE =
  process.env.EDGE_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9333;
const SCALE = 0.6;

/** ปิดกล่องเตือน "ยังปิดงานเดือนก่อนไม่เสร็จ" ที่เด้งตอนเปิดหน้าสถานะทะเบียนบริการ (ปุ่ม "ไว้ทีหลัง") */
const CLOSE_DIALOG = `document.querySelectorAll('[data-ms="close"]').forEach(b => b.click())`;

/** กางเมนูซ้ายให้เต็ม (บางหน้ากว้างจะย่อเมนูเอง) — ไม่บันทึกค่าลง localStorage */
const EXPAND_NAV = `if (typeof navMini === 'function') navMini(false, true)`;

/** role = ค่าใน dropdown "เลือกบทบาท" ของ mockup (host / admin / recorder / viewer) */
const SHOTS = [
  // ---- เริ่มใช้งานครั้งแรก (ทุกตำแหน่ง) ----
  { key: "c-login", file: "login.html" },
  { key: "c-changepw", file: "login.html", prep: `document.querySelector('[data-st="must"]').click()` },
  { key: "c-tutorial", file: "tutorial.html" },
  // ---- หัวหน้างาน (recorder) ----
  { key: "s-todo", file: "aga-bait-registry-prototype.html", hash: "todo", role: "recorder", post: CLOSE_DIALOG },
  { key: "s-service", file: "aga-bait-registry-prototype.html", hash: "service", role: "recorder" },
  { key: "s-bait", file: "aga-bait-registry-prototype.html", hash: "bait", role: "recorder" },
  { key: "s-collect", file: "aga-bait-registry-prototype.html", hash: "collect", role: "recorder" },
  { key: "s-material", file: "aga-bait-registry-prototype.html", hash: "material", role: "recorder" },
  { key: "s-closure", file: "month-closure.html", role: "recorder" },
  // ---- แอดมิน (admin) ----
  { key: "a-registry", file: "aga-bait-registry-prototype.html", hash: "registry", role: "admin" },
  { key: "a-todo", file: "aga-bait-registry-prototype.html", hash: "todo", role: "admin", post: CLOSE_DIALOG },
  { key: "a-new", file: "admin-add-customer.html", role: "admin", post: EXPAND_NAV },
  { key: "a-detail", file: "customer-detail.html", role: "admin", post: EXPAND_NAV },
  { key: "a-collect", file: "aga-bait-registry-prototype.html", hash: "collect", role: "admin" },
  { key: "a-summary", file: "aga-bait-registry-prototype.html", hash: "summary", role: "admin" },
  // ---- PM / OM (host) ----
  { key: "h-todo", file: "aga-bait-registry-prototype.html", hash: "todo", role: "host", post: CLOSE_DIALOG },
  { key: "h-users", file: "admin-user-management.html", role: "host" },
  { key: "h-settings", file: "settings.html", role: "host" },
  { key: "h-port", file: "provincial-port-update.html", role: "host" },
  { key: "h-closure", file: "month-closure.html", role: "host" },
  { key: "h-sync", file: "dashboard-sync.html", role: "host" },
  { key: "h-history", file: "history-log.html", role: "host" },
  // ---- ผู้ดูทั่วไป (viewer — ไม่ต้องล็อกอิน) ----
  { key: "v-summary", file: "aga-bait-registry-prototype.html", hash: "summary", role: "viewer" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ไคลเอนต์ CDP แบบบางๆ */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.waiters = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, fail } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
      } else if (msg.method) {
        this.waiters = this.waiters.filter((w) => !(w.method === msg.method && (w.done(msg.params), true)));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
  once(method, timeoutMs = 20000) {
    return new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error(`timeout รอ ${method}`)), timeoutMs);
      this.waiters.push({ method, done: (p) => (clearTimeout(t), ok(p)) });
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

async function launchEdge() {
  if (!existsSync(EDGE)) throw new Error(`ไม่พบ Edge ที่ ${EDGE} (ตั้ง EDGE_PATH ได้)`);
  const profile = mkdtempSync(join(tmpdir(), "aga-flow-edge-"));
  // โปรไฟล์แยก (user-data-dir) กัน Edge ที่เปิดอยู่รับช่วงแล้วปิดตัวเอง
  const proc = spawn(
    EDGE,
    [
      "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
      "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
      "--force-color-profile=srgb", "about:blank",
    ],
    { stdio: "ignore" },
  );
  let targets;
  for (let i = 0; i < 60; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (targets.some((t) => t.type === "page")) break;
    } catch { /* ยังไม่พร้อม */ }
    await sleep(250);
  }
  const page = targets?.find((t) => t.type === "page");
  if (!page) throw new Error("เปิด Edge แบบ headless ไม่สำเร็จ");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.addEventListener("open", ok); ws.addEventListener("error", fail); });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  const close = async () => {
    try { ws.close(); } catch { /* ignore */ }
    proc.kill();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  return { cdp, close };
}

async function open(cdp, url) {
  await cdp.send("Page.navigate", { url: "about:blank" });
  await sleep(150);
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await loaded;
  await cdp.eval("document.fonts.ready.then(() => true)");
}

async function thumbs(cdp, only) {
  mkdirSync(HERE, { recursive: true });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  const list = only.length ? SHOTS.filter((s) => only.includes(s.key)) : SHOTS;
  for (const s of list) {
    const url = pathToFileURL(join(MOCKUP, s.file)).href + (s.hash ? `#${s.hash}` : "");
    await open(cdp, url);
    // ธีมสว่าง + ซ่อนแผงเดโม + ตั้งบทบาทผ่าน dropdown ของ mockup (ถ้าไม่มี dropdown เรียก applyNavRole ตรงๆ)
    await cdp.eval(`(() => {
      document.documentElement.setAttribute('data-theme','light');
      const st = document.createElement('style');
      st.textContent = '.mk,.mockup-tools,#strip{display:none !important}';
      document.head.appendChild(st);
      const role = ${JSON.stringify(s.role || "")};
      if (role) {
        const sel = document.getElementById('roleSel');
        if (sel && [...sel.options].some(o => o.value === role)) { sel.value = role; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        else if (typeof applyNavRole === 'function') applyNavRole(role);
      }
      ${s.prep || ""}
      return true;
    })()`);
    await sleep(900);
    if (s.post) { await cdp.eval(`(() => { ${s.post}; return true; })()`); await sleep(400); } // ขั้นหลังหน้าโหลดเสร็จ (เช่น ปิดกล่องเตือนที่เด้งช้า)
    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: 1280, height: 800, scale: SCALE },
    });
    writeFileSync(join(HERE, `${s.key}.png`), Buffer.from(shot.data, "base64"));
    console.log("ถ่ายแล้ว", s.key);
  }
}

/** ถ่ายภาพเต็มหน้าของ HTML ที่ความกว้างที่กำหนด (เช่น ตรวจจอมือถือ 375px) → ไฟล์ PNG */
async function fullShot(cdp, htmlPath, outPath, width, scale = 1, dark = false) {
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await open(cdp, pathToFileURL(htmlPath).href + "?export=1");
  await sleep(800);
  const h = await cdp.eval("Math.ceil(document.documentElement.scrollHeight)");
  const overflow = await cdp.eval("document.documentElement.scrollWidth - document.documentElement.clientWidth");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: h, deviceScaleFactor: scale, mobile: width < 600 });
  await sleep(400);
  const png = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(outPath, Buffer.from(png.data, "base64"));
  return { h, overflow };
}

/** ส่งออก PNG (กว้าง 1600) + PDF หน้าเดียว (ขนาดกระดาษ = ขนาดหน้าเว็บ) */
async function exportFlow(cdp, name) {
  const html = resolve(HERE, "..", `${name}.html`);
  const { h } = await fullShot(cdp, html, html.replace(/\.html$/, ".png"), 1600, 1.4);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: h, deviceScaleFactor: 1, mobile: false });
  const pdf = await cdp.send("Page.printToPDF", {
    printBackground: true, displayHeaderFooter: false, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    paperWidth: 1600 / 96, paperHeight: (h + 4) / 96, pageRanges: "1",
  });
  writeFileSync(html.replace(/\.html$/, ".pdf"), Buffer.from(pdf.data, "base64"));
  console.log(`ส่งออก ${name}.png/.pdf แล้ว (สูง ${h}px)`);
}

const [mode, ...rest] = process.argv.slice(2);
if (!["thumbs", "export", "shot"].includes(mode)) {
  console.error("ใช้: node capture.mjs thumbs [key...] | export [ชื่อไฟล์ไม่ต้องมี .html] | shot <html> <out.png> <กว้าง> [dark]");
  process.exit(1);
}
const { cdp, close } = await launchEdge();
try {
  if (mode === "thumbs") await thumbs(cdp, rest);
  else if (mode === "export") await exportFlow(cdp, rest[0] || "page-flow-by-role");
  else {
    const r = await fullShot(cdp, resolve(rest[0]), resolve(rest[1]), Number(rest[2]), 1, rest[3] === "dark");
    console.log(`ถ่ายแล้ว สูง ${r.h}px · เกินขอบแนวนอน ${r.overflow}px`);
  }
} finally {
  await close();
}
