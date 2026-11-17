/**
 * ตัวอ่านไฟล์ .xlsx ขนาดเล็ก (Node เท่านั้น · ไม่ใช้ dependency เพิ่ม) — ใช้กับงานนำเข้า/ทดลองนำเข้าข้อมูลจริง (phase 6)
 *
 * Logic summary:
 *   - .xlsx = ไฟล์ ZIP → อ่าน central directory → แตกไฟล์ที่ต้องใช้ด้วย zlib.inflateRawSync
 *   - workbook.xml + workbook.xml.rels → ชื่อชีท ↔ path ของ sheetN.xml
 *   - sharedStrings.xml → ตารางข้อความ (รวมทุก <t> ใน <si> เดียว เพราะข้อความอาจแบ่งเป็นหลาย run)
 *   - sheetN.xml → grid[แถว][คอลัมน์] (index เริ่ม 0 · แถว Excel ที่ 1 = grid[0])
 *   - ค่าที่คืน: number (ตัวเลข/วันที่แบบ serial) · string · boolean · null (ว่าง)
 *     วันที่ใน Excel เป็นตัวเลข serial — ผู้เรียกที่รู้ว่าคอลัมน์ไหนเป็นวันที่ให้แปลงด้วย `excelSerialToIso` (registrySheet.ts)
 *   - ใช้ "ค่าที่คำนวณแล้ว" ที่ Excel เก็บไว้ (<v>) ไม่คำนวณสูตรใหม่
 *
 * ⚠ ห้าม import ไฟล์นี้จากโค้ดฝั่ง browser (ใช้ node:fs / node:zlib) — จึงไม่ export ผ่าน lib/import/index.ts
 * ⚠ ไฟล์จริงมีข้อมูลลูกค้า (PDPA) — ห้าม log ค่าในเซลล์ออกมา
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

import type { CellValue } from "../registrySheet";

export type { CellValue };

export interface XlsxSheet {
  name: string;
  /** grid[rowIndex][colIndex] · rowIndex 0 = แถว Excel ที่ 1 */
  rows: CellValue[][];
}

// ---------- ZIP ----------

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function readZipEntries(buf: Buffer): Map<string, Buffer> {
  // หา End Of Central Directory (อยู่ท้ายไฟล์ · comment ยาวได้ถึง 65,535 ไบต์)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("readXlsx: ไม่ใช่ไฟล์ ZIP/xlsx (ไม่พบ End Of Central Directory)");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error("readXlsx: central directory เสีย");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (buf.readUInt32LE(localOffset) !== LOC_SIG) throw new Error(`readXlsx: local header เสีย (${name})`);
    const locNameLen = buf.readUInt16LE(localOffset + 26);
    const locExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + locNameLen + locExtraLen;
    const data = buf.subarray(start, start + compSize);

    if (method === 0) entries.set(name, Buffer.from(data));
    else if (method === 8) entries.set(name, inflateRawSync(data));
    else throw new Error(`readXlsx: ไม่รองรับการบีบอัดแบบ ${method} (${name})`);
  }
  return entries;
}

// ---------- XML ----------

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** รวมข้อความทุก <t>…</t> ในก้อน XML (ข้าม <rPh> คำอ่านภาษาญี่ปุ่น) */
function collectText(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of withoutPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1] ?? "");
  return out;
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decodeXml(m[1] ?? "") : undefined;
}

/** "AB12" → index คอลัมน์เริ่ม 0 (AB = 27) */
export function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => collectText(m[1] ?? ""));
}

function parseSheet(xml: string, shared: string[]): CellValue[][] {
  const rows: CellValue[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNo = Number(attr(rowMatch[1] ?? "", "r"));
    const cells: CellValue[] = [];
    // <c .../> (เซลล์ว่างที่มีแต่ style) หรือ <c ...>…</c>
    for (const c of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = c[1] ?? "";
      const body = c[2] ?? "";
      const ref = attr(tag, "r");
      if (!ref) continue;
      const t = attr(tag, "t");
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value: CellValue = null;
      if (t === "s") value = v !== undefined ? (shared[Number(v)] ?? null) : null;
      else if (t === "inlineStr") value = collectText(body);
      else if (t === "str") value = v !== undefined ? decodeXml(v) : null;
      else if (t === "b") value = v === "1";
      else if (t === "e") value = v !== undefined ? decodeXml(v) : null; // #N/A, #REF! ฯลฯ
      else if (v !== undefined) value = Number(v);
      cells[columnIndex(ref)] = value;
    }
    rows[rowNo - 1] = Array.from(cells, (x) => (x === undefined ? null : x));
  }
  return Array.from(rows, (r) => r ?? []);
}

/** อ่านทุกชีทของไฟล์ .xlsx ตามลำดับในไฟล์ */
export function readXlsx(path: string): XlsxSheet[] {
  const zip = readZipEntries(readFileSync(path));
  const text = (name: string) => zip.get(name)?.toString("utf8");

  const workbook = text("xl/workbook.xml");
  const rels = text("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("readXlsx: ไม่พบ workbook.xml");

  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1] ?? "", "Id");
    const target = attr(m[1] ?? "", "Target");
    if (id && target) relTarget.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }

  const shared = parseSharedStrings(text("xl/sharedStrings.xml"));
  const sheets: XlsxSheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1] ?? "", "name") ?? "";
    const rid = attr(m[1] ?? "", "r:id");
    const target = rid ? relTarget.get(rid) : undefined;
    const xml = target ? text(target) : undefined;
    if (!xml) throw new Error(`readXlsx: ไม่พบข้อมูลชีท "${name}"`);
    sheets.push({ name, rows: parseSheet(xml, shared) });
  }
  return sheets;
}
