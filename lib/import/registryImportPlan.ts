/**
 * แผนนำเข้าทะเบียนส่วนกลาง (OCT.26 · 24 สาขา) — pure function ไม่แตะฐานข้อมูล
 * (phase 6 · SPEC §10, §15 · DECISIONS 2.70 / 2.73 / 2.76 / 2.78)
 *
 * Logic summary:
 *   1. รับชีททั้งหมดที่จะนำเข้า "พร้อมกัน" → หาเลขสัญญาซ้ำข้ามสาขาเอง (findCrossBranchDuplicates · ง1)
 *      ผู้เรียกจึงลืมกันแถวซ้ำไม่ได้ · ต้องส่งครบทุกสาขาในรอบเดียว (ซ้ำข้ามไฟล์ เช่น เขต 1 ↔ เขต 4)
 *   2. แต่ละชีท → prepareStrictImport (แกนเดียวกับ dry-run) ด้วย REGISTRY_IMPORT_OPTIONS ที่ล็อกไว้ (แก้จากผู้เรียกไม่ได้)
 *      → แถวพร้อมนำเข้า = แถวเดียวกับที่ dry-run นับเป็น strict.ready ทุกแถว · แถวกรอกมือ / แถวที่กันไว้ ไม่เข้าแผน
 *   3. ยอดที่คาดของเดือน (expected) = buildBranchSnapshot (lib/rules) ของแถวในแผน — ใช้เทียบกับยอดที่คำนวณจาก DB หลังนำเข้า
 *   4. หยุด (throw) เมื่อ: สาขาส่งมาซ้ำ · เลขสัญญาซ้ำในแผน · มูลค่าทศนิยมเกิน 2 ตำแหน่ง (DB เก็บ numeric(12,2) — ห้ามปัดเงียบ)
 *   5. ลูกค้า: 1 แถวสัญญา = 1 ลูกค้า (ไม่รวมชื่อซ้ำเอง · DECISIONS 2.59 แอดมินแก้เอง) — นับกลุ่มชื่อซ้ำไว้รายงาน
 *   7. สถานะสัญญา (เจ้าของตัดสิน 19 พ.ย. 2026): วันสิ้นสุด < วันแรกของเดือนที่นำเข้า (opts.month)
 *      → 'expired_pending_collection' (หมดอายุ รอเก็บสถานี · SPEC §7.8) · อื่นๆ = 'active'
 *      (จบต้นเดือนที่นำเข้า เช่น 14 ต.ค. ยัง active · ไม่กระทบยอด — snapshot นับตามเดือนบริการ ไม่ดูสถานะ)
 *   6. เบอร์โทร: parseThaiPhones (phones.ts) ของช่องเบอร์แถวเดียวกัน — รูปแบบไม่ถูก = ไม่เก็บ (นับใน phones)
 *   8. ที่อยู่ (DECISIONS 2.102): cleanAddress (addresses.ts) ของช่อง "ที่อยู่ลูกค้า" แถวเดียวกัน → customers.address
 *      (ล้างช่องว่างเท่านั้น ไม่แก้เนื้อหา · ว่าง = null) · นับต่อสาขาใน addresses ให้ตัวตรวจหลังเขียนเทียบ
 *      · ที่อยู่มีตัวอักษรควบคุม (DB text รับไม่ได้) = หยุด (ข้อความมีแค่สาขา/เลขแถว)
 *   9. รายการตัดสัญญา (DECISIONS 2.103 · กลุ่มอาจกรอกซ้ำ): input.excludeRows → prepareStrictImport ตัดออกก่อนคิดยอด
 *      → expected / จำนวน / ที่อยู่ / เบอร์ ทั้งหมดคิดจากแผนที่ตัดแล้ว · รายงานใน excludedRows (เลขแถว + เลขสัญญา)
 *   ⚠ PlannedContract มีชื่อลูกค้า/ผู้ขาย/เบอร์/ที่อยู่ (หน่วยความจำเท่านั้น) — ห้าม log · รายงานใช้ได้แค่ heldRows / mustFixRows / excludedRows / ตัวเลข
 */
import { buildBranchSnapshot } from "../rules/snapshot";
import type { Contract, SnapshotRow, TierRule } from "../rules/types";
import { REGISTRY_IMPORT_OPTIONS } from "./centralRegistrySheets";
import { findCrossBranchDuplicates } from "./crossBranchDuplicates";
import { parseThaiPhones, summarizePhones, type ParsedPhone, type PhoneSummary } from "./phones";
import { cleanAddress, summarizeAddresses, type AddressSummary } from "./addresses";
import { prepareStrictImport, type ExcludeRow, type HoldRow } from "./registryDryRun";
import { parseRegistrySheet, type CellValue } from "./registrySheet";
import type { SellerIndex } from "./sellerLookup";
import type { SaleType } from "./types";

/** ชื่อแทนที่ importContracts ใส่เมื่อช่องชื่อว่าง — นับไว้รายงาน (ไม่ใช่ชื่อจริง) */
export const NO_NAME_PLACEHOLDER = "(ไม่มีชื่อ)";

export interface RegistrySheetInput {
  /** ชื่อชีทในไฟล์ */
  sheet: string;
  /** สาขาปลายทาง (ตามตาราง centralRegistrySheets.ts · สะกดตรง master) */
  branch: string;
  grid: CellValue[][];
  /** แถวที่ต้องตัดออก (2.103 · จาก CONTRACT_EXCLUSIONS_OCT26 ผ่าน assignContractExclusions) · ไม่ส่ง = ไม่ตัด */
  excludeRows?: ExcludeRow[];
}

export interface PlanOptions {
  /** เกณฑ์ Tier (อ่านจาก tier_rules — ห้าม hardcode) */
  rules: TierRule[];
  /** เดือนที่คำนวณยอดที่คาด 'YYYY-MM' */
  month: string;
  /** ดัชนีผู้ขายจากไฟล์เปิดงาน · ไม่ส่ง = ผู้ขายว่างทุกแถว */
  sellerIndex?: SellerIndex;
  /** ค่า contracts.import_batch ของทุกสัญญาในรอบนี้ (เช่น REGISTRY_IMPORT_BATCH_OCT26) */
  importBatch: string;
}

/** 1 แถวที่จะเขียน (ลูกค้า 1 ราย + สัญญา 1 ฉบับ + ทีม) — ⚠ มีชื่อลูกค้า/ผู้ขาย */
export interface PlannedContract {
  excelRow: number;
  customerName: string;
  /** ป้ายใน master (customer_types.label) — ชั้นเขียน DB แปลงเป็น code */
  customerTypeLabel: string;
  contractNo: string;
  startDate: string;
  endDate: string;
  termMonths: number;
  valueTotal: number;
  saleType: SaleType | null;
  saleName: string | null;
  amName: string | null;
  isUrgent: boolean;
  /** รหัสทีม (ไม่ซ้ำ) เช่น ["B", "C"] */
  teamCodes: string[];
  /** สถานะตอนนำเข้า (ข้อ 7 ใน Logic summary) */
  status: ContractImportStatus;
  /** เบอร์โทร → customer_phones (phones.ts · รูปแบบไม่ถูก/ว่าง = []) · ⚠ เบอร์จริง */
  phones: ParsedPhone[];
  /** ที่อยู่ → customers.address (addresses.ts · ว่าง = null) · ⚠ ที่อยู่จริง */
  address: string | null;
}

export type ContractImportStatus = "active" | "expired_pending_collection";

/** สถานะตอนนำเข้า: วันสิ้นสุดก่อนวันแรกของเดือนที่นำเข้า = หมดอายุ รอเก็บสถานี */
export function importStatusOf(endDate: string, month: string): ContractImportStatus {
  return endDate < `${month}-01` ? "expired_pending_collection" : "active";
}

export interface PlannedBranch {
  sheet: string;
  branch: string;
  area: string;
  contracts: PlannedContract[];
  /** แถวที่กันไว้ (ง1) — ไม่เข้าแผน */
  heldRows: HoldRow[];
  /** เลขแถว Excel ที่ต้องกรอกมือ (strict mustFix) — ไม่เข้าแผน */
  mustFixRows: number[];
  /** ยอดที่คาดของเดือน (buildBranchSnapshot ของแถวในแผน) */
  expected: SnapshotRow;
  /** จำนวนแถวที่จะลงชื่อใน sale_name / am_name */
  sellers: { saleName: number; amName: number };
  /** แถวที่ชื่อลูกค้าว่าง (จะบันทึกเป็น NO_NAME_PLACEHOLDER) */
  placeholderNames: number;
  /** กลุ่มชื่อลูกค้าซ้ำในสาขา (ชื่อเทียบแบบ customer_name_key) — จำนวนกลุ่ม / แถวในกลุ่ม */
  sameNameGroups: { groups: number; rows: number };
  /** สรุปเบอร์โทร (จำนวนเท่านั้น) · hasPhoneColumn = ชีทมีคอลัมน์เบอร์ */
  phones: PhoneSummary & { hasPhoneColumn: boolean };
  /** สรุปที่อยู่ (จำนวนเท่านั้น · 2.102) · hasAddressColumn = ชีทมีหัว "ที่อยู่ลูกค้า" */
  addresses: AddressSummary & { hasAddressColumn: boolean };
  /** ป้ายหัวที่มีคำว่า "ที่อยู่" แต่ไม่ตรงตัว (ต้องรายงาน ไม่เดา) */
  addressHeaderVariants: string[];
  /** แถวที่ตัดออกตามรายการ (2.103) — ไม่เข้าแผน */
  excludedRows: ExcludeRow[];
}

export interface RegistryImportPlan {
  month: string;
  /** ค่า contracts.import_batch ที่จะเขียน (DECISIONS 2.86) */
  importBatch: string;
  branches: PlannedBranch[];
  totals: { contracts: number; held: number; mustFix: number; excluded: number; withAddress: number };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** เทียบชื่อแบบเดียวกับ customer_name_key ใน DB (ตัด zero-width · รวมช่องว่าง · ตัวพิมพ์เล็ก) */
export function customerNameKey(name: string): string {
  return name
    .replace(/[​‌‍⁠﻿]/g, "")
    .replace(/[\s   ]+/g, " ")
    .trim()
    .toLowerCase();
}

function assertCents(value: number, excelRow: number, branch: string): void {
  const cents = value * 100;
  if (Math.abs(cents - Math.round(cents)) > 1e-6) {
    throw new Error(`แผนนำเข้า: ${branch} แถว ${excelRow} มูลค่ามีทศนิยมเกิน 2 ตำแหน่ง — หยุด (ห้ามปัดเงียบ)`);
  }
}

/** สร้างแผนนำเข้าจากชีททั้งหมด (ดู Logic summary หัวไฟล์) */
export function planRegistryImport(sheets: RegistrySheetInput[], opts: PlanOptions): RegistryImportPlan {
  if (!MONTH_RE.test(opts.month)) throw new Error(`แผนนำเข้า: เดือน "${opts.month}" ต้องเป็น YYYY-MM`);
  if (!opts.importBatch || opts.importBatch.trim() !== opts.importBatch) {
    throw new Error("แผนนำเข้า: ต้องระบุ importBatch (ไม่มีช่องว่างหัวท้าย)");
  }
  const seenBranch = new Set<string>();
  for (const s of sheets) {
    if (seenBranch.has(s.branch)) throw new Error(`แผนนำเข้า: สาขา "${s.branch}" ส่งมาซ้ำ`);
    seenBranch.add(s.branch);
  }

  // ง1: หาเลขซ้ำข้ามสาขาจากทุกชีทในรอบนี้ (ตัวอ่านชีทเดียวกับ dry-run)
  const holds = findCrossBranchDuplicates(
    sheets.map((s) => ({
      branch: s.branch,
      rows: parseRegistrySheet(s.grid, s.branch, { readDateRangeText: REGISTRY_IMPORT_OPTIONS.readDateRangeText }).rows,
    })),
  );

  const seenContract = new Set<string>();
  const branches = sheets.map((s): PlannedBranch => {
    const prep = prepareStrictImport(s.sheet, s.grid, {
      branch: s.branch,
      sellerIndex: opts.sellerIndex,
      holdRows: holds.get(s.branch),
      excludeRows: s.excludeRows,
      ...REGISTRY_IMPORT_OPTIONS,
    });
    const phoneResults = prep.strictResult.ready.map((r) => parseThaiPhones(prep.phoneCellOf(r.rowIndex)));
    const addressResults = prep.strictResult.ready.map((r) => cleanAddress(prep.addressCellOf(r.rowIndex)));
    const contracts = prep.strictResult.ready.map((r, i): PlannedContract => {
      const excelRow = prep.excelOf(r.rowIndex);
      assertCents(r.valueTotal, excelRow, s.branch);
      if (addressResults[i]!.status === "controlChar") {
        throw new Error(`แผนนำเข้า: ${s.branch} แถว ${excelRow} ที่อยู่มีตัวอักษรควบคุม (DB รับไม่ได้) — หยุด ให้สาขาแก้ในไฟล์`);
      }
      if (seenContract.has(r.contractNo)) {
        throw new Error(`แผนนำเข้า: ${s.branch} แถว ${excelRow} เลขที่สัญญาซ้ำกับแถวอื่นในแผน — หยุด`);
      }
      seenContract.add(r.contractNo);
      return {
        excelRow,
        customerName: r.customerName,
        customerTypeLabel: r.customerType,
        contractNo: r.contractNo,
        startDate: r.startDate,
        endDate: r.endDate,
        termMonths: r.termMonths,
        valueTotal: r.valueTotal,
        saleType: r.saleType,
        saleName: r.saleName,
        amName: r.amName,
        isUrgent: r.urgent,
        teamCodes: [...new Set(r.teams)],
        status: importStatusOf(r.endDate, opts.month),
        phones: phoneResults[i]!.phones,
        address: addressResults[i]!.address,
      };
    });
    const asRules: Contract[] = contracts.map((c) => ({
      id: c.contractNo,
      startDate: c.startDate,
      termMonths: c.termMonths,
      valueTotal: c.valueTotal,
    }));
    const byName = new Map<string, number>();
    for (const c of contracts) {
      const k = customerNameKey(c.customerName);
      byName.set(k, (byName.get(k) ?? 0) + 1);
    }
    const dupGroups = [...byName.values()].filter((n) => n > 1);
    return {
      sheet: s.sheet,
      branch: prep.ref.branch,
      area: prep.ref.area,
      contracts,
      heldRows: prep.heldRows,
      mustFixRows: prep.strictResult.mustFix.map((m) => prep.excelOf(m.rowIndex)).sort((a, b) => a - b),
      expected: buildBranchSnapshot(prep.ref, asRules, opts.month, opts.rules),
      sellers: {
        saleName: contracts.filter((c) => c.saleName).length,
        amName: contracts.filter((c) => c.amName).length,
      },
      placeholderNames: contracts.filter((c) => c.customerName === NO_NAME_PLACEHOLDER).length,
      sameNameGroups: { groups: dupGroups.length, rows: dupGroups.reduce((a, n) => a + n, 0) },
      phones: { ...summarizePhones(phoneResults), hasPhoneColumn: prep.parsed.columns.phone !== null },
      addresses: { ...summarizeAddresses(addressResults), hasAddressColumn: prep.parsed.columns.address !== null },
      addressHeaderVariants: prep.parsed.addressHeaderVariants,
      excludedRows: prep.excludedRows,
    };
  });

  return {
    month: opts.month,
    importBatch: opts.importBatch,
    branches,
    totals: {
      contracts: branches.reduce((n, b) => n + b.contracts.length, 0),
      held: branches.reduce((n, b) => n + b.heldRows.length, 0),
      mustFix: branches.reduce((n, b) => n + b.mustFixRows.length, 0),
      excluded: branches.reduce((n, b) => n + b.excludedRows.length, 0),
      withAddress: branches.reduce((n, b) => n + b.addresses.withAddress, 0),
    },
  };
}
