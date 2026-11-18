/**
 * ตัวช่วยเทสไฟล์จริงของทะเบียนส่วนกลาง (ใช้ร่วมกันใน zone1Registry / centralRegistry .dryrun.test.ts) — Node เท่านั้น
 *
 * ตัวอ่านไฟล์ย้ายไปอยู่ centralRegistryFiles.ts (สคริปต์นำเข้าจริงใช้ตัวเดียวกัน) — ไฟล์นี้ส่งต่ออย่างเดียว
 * ไฟล์จริงมีข้อมูลลูกค้า (PDPA) — ห้าม log ค่าในเซลล์
 */
export {
  hasAllCentralFiles,
  loadCentralRegistry,
  type CentralRegistry,
  type CentralSheet,
} from "./centralRegistryFiles";
