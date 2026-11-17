"use client";

/**
 * ตัวเก็บสถานะ "มีงานกรอกค้างที่ยังไม่บันทึก" ระดับทั้งแอป (M34)
 *
 * ทำไมต้องมี: กล่องแจ้งเวอร์ชันใหม่ (UpdateBanner อยู่ใน AppShell) ต้องรู้ว่าตอนนี้มีฟอร์มค้างไหม
 * ก่อนรีโหลดหน้าเพื่ออัปเดต · ในโค้ดเดิมแต่ละหน้าเก็บ `dirty` ไว้ใน state ของตัวเอง ไม่มีที่กลางให้อ่าน
 *
 * วิธีใช้ (ในหน้า/ฟอร์มที่มีข้อมูลค้าง): `useUnsavedWork(dirty);`
 *  - dirty = true  → ลงทะเบียนว่ามีงานค้าง · dirty = false หรือหน้าถูกถอด (unmount) → ถอนออกเอง
 *  - หลายฟอร์มพร้อมกันได้ (นับต่อ id) — มีฟอร์มใดค้างอยู่ = ถือว่ามีงานค้าง
 *
 * ตอนเขียนไฟล์นี้ยังไม่มีหน้าไหนเรียก hook (หน้าฟอร์มอยู่นอกขอบเขตงาน) — รายชื่อหน้าที่ต่อแล้วดูใน CHANGELOG/รายงานงาน
 */
import { useEffect, useId } from "react";

const dirtyIds = new Set<string>();

/** มีฟอร์มใดค้างอยู่หรือไม่ (อ่าน ณ ตอนที่เรียก — ไม่ใช่ reactive) */
export function hasUnsavedWork(): boolean {
  return dirtyIds.size > 0;
}

/** ตั้งสถานะค้าง/ไม่ค้างของ id หนึ่ง — export ไว้ให้เทส/ตัวช่วยที่ไม่ใช่ React ใช้ */
export function setUnsavedWork(id: string, dirty: boolean): void {
  if (dirty) dirtyIds.add(id);
  else dirtyIds.delete(id);
}

/** hook สำหรับฟอร์ม: ส่ง `dirty` ของฟอร์มเข้ามา ที่เหลือจัดการให้ */
export function useUnsavedWork(dirty: boolean): void {
  const id = useId();
  useEffect(() => {
    setUnsavedWork(id, dirty);
    return () => setUnsavedWork(id, false);
  }, [id, dirty]);
}
