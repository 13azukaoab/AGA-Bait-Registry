/**
 * กฎไฟล์แนบสัญญา (SPEC §6.6 · migration 20261111090300_contract_files)
 *
 * Logic summary:
 *   * ≤ 5 MB → รับเลย · 5–10 MB → บีบในแอปก่อน (was_compressed=true) · > 10 MB → ปฏิเสธทันที
 *   * บีบแล้วยังเกิน 5 MB → ไม่รับ แจ้งให้สแกนใหม่
 *   * contract_pdf รับ PDF อย่างเดียว · site_plan รับ PDF / PNG / JPG และต้องมีเหตุผล
 *   * path ใน bucket = `<contract_id>/<โทเคน>-<ชื่อ ASCII ปลอดภัย>` (Storage ไม่รับชื่อ key ภาษาไทยทุกกรณี
 *     ชื่อไฟล์เดิมเก็บแยกที่ contract_files.file_name) โทเคนกันชนซ้ำ (storage_path UNIQUE)
 */

export const MB = 1024 * 1024;
/** ขนาดสูงสุดที่เก็บได้ (ตรงกับ CHECK ของตารางและ file_size_limit ของ bucket) */
export const STORED_MAX_BYTES = 5 * MB;
/** ขนาดสูงสุดที่รับเข้ามาบีบ */
export const ACCEPT_MAX_BYTES = 10 * MB;

export type ContractFileKind = "contract_pdf" | "site_plan";

export const ALLOWED_MIME: Record<ContractFileKind, readonly string[]> = {
  contract_pdf: ["application/pdf"],
  site_plan: ["application/pdf", "image/png", "image/jpeg"],
};

/** ข้อความปฏิเสธ PDF ใหญ่เกิน 5 MB (เจ้าของตัดสิน 12 พ.ย. 2026 — ไม่มีตัวบีบ PDF ให้สแกนใหม่) */
export const PDF_TOO_LARGE_MESSAGE =
  "ไฟล์ PDF ใหญ่เกิน 5 MB กรุณาสแกนใหม่ให้ไม่เกิน 5 MB (แนะนำ 150–200 dpi ขาวดำ) ดูวิธีในคู่มือสแกนและแนบไฟล์สัญญา";

export type SizeVerdict = "ok" | "compress" | "too_large";

export function classifySize(bytes: number): SizeVerdict {
  if (bytes > ACCEPT_MAX_BYTES) return "too_large";
  if (bytes > STORED_MAX_BYTES) return "compress";
  return "ok";
}

export interface FileCheck {
  ok: boolean;
  /** ข้อความภาษาไทยเมื่อไม่ผ่าน */
  error?: string;
  verdict?: SizeVerdict;
}

export function checkFile(
  kind: ContractFileKind,
  file: { type: string; size: number },
): FileCheck {
  if (!ALLOWED_MIME[kind].includes(file.type)) {
    return {
      ok: false,
      error:
        kind === "contract_pdf"
          ? "ไฟล์สัญญารับเฉพาะ PDF"
          : "Site plan รับเฉพาะไฟล์ PDF, PNG หรือ JPG",
    };
  }
  if (file.size <= 0) return { ok: false, error: "ไฟล์ว่างเปล่า" };
  const verdict = classifySize(file.size);
  // PDF ไม่บีบ: เกิน 5 MB = ปฏิเสธเลย (รูปภาพ 5–10 MB ยังบีบได้)
  if (file.type === "application/pdf" && verdict !== "ok") {
    return { ok: false, verdict, error: PDF_TOO_LARGE_MESSAGE };
  }
  if (verdict === "too_large") {
    return { ok: false, verdict, error: "ไฟล์ขนาดใหญ่เกินไป (เกิน 10 MB) กรุณาสแกนใหม่ให้เล็กลง" };
  }
  return { ok: true, verdict };
}

/** ผลหลังบีบ: ต้อง ≤ 5 MB ถึงจะเก็บได้ */
export function checkCompressed(bytes: number): FileCheck {
  if (bytes > STORED_MAX_BYTES) {
    return { ok: false, error: "บีบแล้วไฟล์ยังเกิน 5 MB กรุณาสแกนใหม่ให้เล็กลง" };
  }
  return { ok: true, verdict: "ok" };
}

/** ชื่อไฟล์ที่ปลอดภัยกับ Storage key: เหลือ a-z 0-9 . _ - เท่านั้น · ไม่เหลืออะไร = "file" */
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const cleanBase = base
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const b = cleanBase.slice(0, 60) || "file";
  return ext ? `${b}.${ext}` : b;
}

/** `<contract_id>/<token>-<ชื่อปลอดภัย>` — token ต้องไม่ซ้ำ (เช่น Date.now() หรือเลขสุ่ม) */
export function buildStoragePath(contractId: string, fileName: string, token: string): string {
  return `${contractId}/${token}-${safeFileName(fileName)}`;
}

/** เหตุผลของ Site plan ต้องไม่ว่าง (CHECK ในตาราง) */
export function isValidReason(reason: string): boolean {
  return reason.trim().length > 0;
}
