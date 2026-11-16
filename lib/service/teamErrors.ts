/**
 * ข้อความภาษาไทยของ error ที่เกี่ยวกับ "ทีมที่เปิด/ปิด/ประเภท" (M26/M33) — ใช้ร่วมกันระหว่างหน้า /customers/new และ /service
 *
 * Logic summary:
 *   * TM004 = ทีมปิดใช้งาน เลือกให้งานใหม่ไม่ได้ · TM005 = ทีมหัวหน้างานผูกกับสัญญา/การเข้าบริการไม่ได้
 *     (ทั้งคู่ DB ตรวจเฉพาะทีมที่ "เพิ่มใหม่" · DETAIL = รหัสทีมคั่นด้วย ",")
 *   * TM006 = เปิด/ปิดทีมได้เฉพาะ host
 *   * ถ้า DETAIL หน้าตาไม่เหมือนรหัสทีม (ว่าง / ยาวเกิน / มีอักขระแปลก) จะไม่ใส่ในข้อความ — ไม่เดา ไม่โชว์ค่าดิบ
 *   * คืน null = ไม่ใช่รหัสกลุ่มนี้ (ให้ตัวแปลงหลักทำต่อ)
 */

/** รหัสทีมจาก DETAIL ("A, B") → ["A","B"] · รูปแบบแปลก = [] */
export function parseTeamCodes(details: string | null | undefined): string[] {
  const raw = (details ?? "").trim();
  if (raw === "" || raw.length > 80) return [];
  const codes = raw.split(",").map((c) => c.trim());
  return codes.every((c) => /^[\p{L}\p{N}_-]{1,20}$/u.test(c)) ? codes : [];
}

export function describeTeamError(
  code: string,
  details: string | null | undefined,
): string | null {
  const codes = parseTeamCodes(details);
  const which = codes.length > 0 ? `ทีม ${codes.join(", ")}` : "ทีมที่เลือก";
  switch (code) {
    case "TM004":
      return `${which} ปิดใช้งานแล้ว เลือกให้งานใหม่ไม่ได้ — เอาทีมนี้ออก หรือเลือกทีมอื่นที่ยังเปิดอยู่`;
    case "TM005":
      return `${which} เป็นทีมหัวหน้างาน ผูกกับสัญญา/การเข้าบริการไม่ได้ — เอาทีมนี้ออก แล้วเลือกทีมบริการหรือทีมติดตั้งแทน`;
    case "TM006":
      return "เปิด/ปิดทีมได้เฉพาะผู้ดูแลระบบ (Host)";
    default:
      return null;
  }
}
