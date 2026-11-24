/**
 * ตัวเขียนไฟล์ .xlsx ขนาดเล็ก (Node เท่านั้น · ไม่ใช้ dependency เพิ่ม) — ใช้สร้าง "แบบฟอร์มกรอกแถวที่นำเข้าไม่ได้" (DECISIONS 2.104)
 *
 * Logic summary:
 *   - ทุกเซลล์เป็นข้อความ (inlineStr) และจัดรูปแบบเป็น "ข้อความ" (numFmt 49 = "@") ทั้งคอลัมน์
 *     → Excel ไม่แปลงเบอร์ 0812345678 เป็นตัวเลข (0 หน้าหาย) และไม่แปลง 03/04/2026 เป็นวันที่ตาม locale (วัน/เดือนสลับ)
 *     ซึ่งเป็นปัญหาหลักถ้าใช้ CSV (เหตุที่แถวนำเข้าไม่ได้ส่วนใหญ่คือวันที่)
 *   - ZIP แบบไม่บีบอัด (stored · method 0) + CRC32 จาก node:zlib → readXlsx.ts อ่านกลับได้ (มีเทส round-trip)
 *   - ชีทแรกแถว 1 = หัวตาราง (ตัวหนา · ตรึงแถว) · ชีทอื่นใช้เป็นคำอธิบาย
 *   - dataValidation แบบรายการ (เช่น ช่อง "แก้แล้ว" = ใช่/ไม่) ใส่ได้ต่อคอลัมน์
 *   - ⚠ ไฟล์ที่สร้างอาจมีข้อมูลลูกค้า — เขียนลง fixtures/ (gitignored) เท่านั้น ผู้เรียกเป็นคนตรวจ path
 */
import { crc32 } from "node:zlib";

export interface XlsxColumn {
  /** ความกว้าง (หน่วยตัวอักษรของ Excel) */
  width?: number;
  /** รายการค่าที่เลือกได้ (dropdown) · ไม่ใส่ = พิมพ์อิสระ */
  list?: readonly string[];
}

export interface XlsxSheetInput {
  name: string;
  /** rows[0] = หัวตาราง (ถ้า header = true) */
  rows: readonly (readonly string[])[];
  columns?: readonly XlsxColumn[];
  /** true = แถวแรกเป็นหัว: ตัวหนา + ตรึงแถว */
  header?: boolean;
  /** จำนวนแถวข้อมูลที่ใส่ dropdown/รูปแบบข้อความ (เผื่อแถวว่างท้ายตาราง) · ค่าเริ่มต้น = จำนวนแถว */
  formatRows?: number;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // ตัวอักษรควบคุมที่ XML 1.0 ไม่รับ (เว้นแท็บ/ขึ้นบรรทัด) → ตัดทิ้ง
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** index คอลัมน์ (เริ่ม 0) → "A", "B", … "AA" */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const STYLE_TEXT = 1;
const STYLE_HEADER = 2;

function sheetXml(sheet: XlsxSheetInput): string {
  const width = Math.max(1, ...sheet.rows.map((r) => r.length), sheet.columns?.length ?? 0);
  const lastRow = Math.max(sheet.rows.length, sheet.formatRows ?? 0);
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
  if (sheet.header) {
    out.push(
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    );
  }
  out.push("<cols>");
  for (let i = 0; i < width; i++) {
    const w = sheet.columns?.[i]?.width ?? 14;
    out.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1" style="${STYLE_TEXT}"/>`);
  }
  out.push("</cols>");
  out.push("<sheetData>");
  sheet.rows.forEach((row, r) => {
    const style = sheet.header && r === 0 ? STYLE_HEADER : STYLE_TEXT;
    const cells = row
      .map((v, c) =>
        v === ""
          ? `<c r="${columnLetter(c)}${r + 1}" s="${style}"/>`
          : `<c r="${columnLetter(c)}${r + 1}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`,
      )
      .join("");
    out.push(`<row r="${r + 1}">${cells}</row>`);
  });
  out.push("</sheetData>");
  const validations = (sheet.columns ?? [])
    .map((col, c) => ({ col, c }))
    .filter(({ col }) => col.list && col.list.length > 0);
  if (validations.length > 0 && lastRow >= 2) {
    out.push(`<dataValidations count="${validations.length}">`);
    for (const { col, c } of validations) {
      const ref = `${columnLetter(c)}2:${columnLetter(c)}${lastRow}`;
      const formula = `"${col.list!.join(",")}"`;
      out.push(
        `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${ref}"><formula1>${escapeXml(formula)}</formula1></dataValidation>`,
      );
    }
    out.push("</dataValidations>");
  }
  out.push("</worksheet>");
  return out.join("");
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

function workbookFiles(sheets: readonly XlsxSheetInput[]): [string, string][] {
  const files: [string, string][] = [];
  files.push([
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      "</Types>",
  ]);
  files.push([
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>",
  ]);
  files.push([
    "xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      "<sheets>" +
      sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      "</sheets></workbook>",
  ]);
  files.push([
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      "</Relationships>",
  ]);
  files.push(["xl/styles.xml", STYLES_XML]);
  sheets.forEach((s, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]));
  return files;
}

/** ZIP แบบ stored (ไม่บีบอัด) · ชื่อไฟล์ UTF-8 (flag bit 11) */
function zipStored(files: readonly [string, Buffer][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** สร้างไฟล์ .xlsx เป็น Buffer (ผู้เรียกเขียนลงดิสก์เอง) */
export function buildXlsx(sheets: readonly XlsxSheetInput[]): Buffer {
  if (sheets.length === 0) throw new Error("buildXlsx: ต้องมีอย่างน้อย 1 ชีท");
  const names = new Set<string>();
  for (const s of sheets) {
    if (!s.name || s.name.length > 31 || /[\\/?*[\]:]/.test(s.name)) throw new Error(`buildXlsx: ชื่อชีท "${s.name}" ใช้ไม่ได้`);
    if (names.has(s.name)) throw new Error(`buildXlsx: ชื่อชีทซ้ำ "${s.name}"`);
    names.add(s.name);
  }
  return zipStored(workbookFiles(sheets).map(([name, xml]) => [name, Buffer.from(xml, "utf8")]));
}
