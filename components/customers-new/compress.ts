/**
 * บีบไฟล์ 5–10 MB ในแอปก่อนอัปโหลด (SPEC §6.6 A3)
 *
 * Logic summary:
 *   * รูปภาพ (PNG/JPG) → วาดลง canvas แล้วบันทึกเป็น JPEG ลดคุณภาพทีละขั้น + ย่อด้านยาวถ้ายังไม่พอ
 *     จนได้ ≤ 5 MB (PNG ที่มีความโปร่งใสจะถูกวางบนพื้นขาว)
 *   * PDF → **ยังบีบในเบราว์เซอร์ไม่ได้** (ต้องใช้ไลบรารีบีบ PDF ซึ่งยังไม่อยู่ใน dependencies
 *     และ SPEC §6.6 ระบุว่าต้องเป็นตัวบีบฝั่ง server) จึงคืน null = "บีบไม่ได้" แล้วหน้าจอแจ้งให้ผู้ใช้
 *     สแกนใหม่ให้ ≤ 5 MB · เมื่อมีตัวบีบ PDF แล้ว แก้ที่ `compressPdf` ที่เดียว
 *   * ฟังก์ชันนี้ใช้ DOM (canvas) → เรียกได้เฉพาะใน client component
 */
import { STORED_MAX_BYTES } from "./fileRules";

export interface CompressResult {
  file: File;
  wasCompressed: true;
}

/** จุดต่อไลบรารีบีบ PDF ในอนาคต — ตอนนี้ยังไม่รองรับ */
async function compressPdf(_file: File): Promise<File | null> {
  void _file;
  return null;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("อ่านรูปภาพไม่ได้"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function compressImage(file: File): Promise<File | null> {
  const img = await loadImage(file);
  let scale = 1;
  for (let round = 0; round < 4; round++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      const blob = await canvasToBlob(canvas, quality);
      if (blob && blob.size <= STORED_MAX_BYTES) {
        const base = file.name.replace(/\.[^.]+$/, "");
        return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
      }
    }
    scale *= 0.75;
  }
  return null;
}

/** บีบไฟล์ให้ ≤ 5 MB · null = บีบไม่สำเร็จ (ให้แจ้งผู้ใช้สแกนใหม่) */
export async function compressFile(file: File): Promise<CompressResult | null> {
  try {
    const out =
      file.type === "application/pdf" ? await compressPdf(file) : await compressImage(file);
    return out && out.size <= STORED_MAX_BYTES ? { file: out, wasCompressed: true } : null;
  } catch {
    return null;
  }
}
