/**
 * บทเรียนตำแหน่ง Admin (เปิดงาน) · position_code = job_admin · 7 ขั้น
 * ข้อความตาม mockup docs/mockup/tutorial.html · จุดชี้ = data-tour ในหน้าจริง
 *   nav-new → components/shell/NavLinks.tsx (ทุกเมนูมี data-tour="nav-<key>")
 *   new-form / new-tier / new-save / cust-upload → components/customers-new/NewContractsClient.tsx
 *   reg-search → ยังไม่มี (หน้า /customers ยังเป็นหน้าตัวอย่าง) — ขั้นนี้จะถูกข้ามเงียบๆ จนกว่าจะมีหน้าจริง
 * ⚠ หน้าจริงแนบไฟล์ที่หน้าเปิดงาน (ปุ่ม "ไฟล์แนบ" ในตาราง) ไม่ใช่ที่หน้ารายละเอียดลูกค้า จึงปรับข้อความขั้น 5 ให้ตรงของจริง
 */
import type { Lesson } from "./types";

export const adminLesson: Lesson = {
  id: "admin",
  title: "Admin (เปิดงาน)",
  positions: ["แอดมิน"],
  steps: [
    {
      target: "nav-new",
      act: "click",
      title: "เปิดงานใหม่ที่เมนูนี้",
      body: "สัญญาใหม่ทุกฉบับเริ่มที่เมนู “เปิดงานเข้าทะเบียนบริการ”",
      hint: "กดเมนูที่ไฮไลต์",
    },
    {
      path: "/customers/new",
      target: "new-form",
      title: "กรอกข้อมูลลูกค้าและสัญญา",
      body: "ชื่อลูกค้า วันเริ่มสัญญา และระยะสัญญา (12 เดือน = 1 ปี · 36 เดือน = 3 ปี · อื่นๆ ใส่ 1–35 เดือน)",
    },
    {
      path: "/customers/new",
      target: "new-tier",
      title: "ระบบจัด Tier ให้เอง",
      body: "กรอกมูลค่าแล้วระบบคำนวณ Tier ให้ ไม่ต้องจัดเอง และไม่ต้องกรอก F1–F10",
    },
    {
      path: "/customers/new",
      target: "new-save",
      act: "click",
      title: "บันทึกสัญญา",
      body: "ตรวจข้อมูลแล้วกดบันทึก (ในบทเรียนนี้กดแล้วไม่บันทึกจริง)",
      hint: "ลองกดปุ่มที่ไฮไลต์",
    },
    {
      path: "/customers/new",
      target: "cust-upload",
      title: "แนบไฟล์สัญญา (PDF)",
      body: "แนบไฟล์สัญญาและ Site plan (PDF ไฟล์เดียว) ที่ช่อง “ไฟล์แนบ” ของแถวนั้นในหน้านี้ · หน้ารายละเอียดลูกค้าใช้ดู/ดาวน์โหลดไฟล์อย่างเดียว",
    },
    {
      path: "/customers",
      target: "reg-search",
      title: "ค้นหาในทะเบียน",
      body: "พิมพ์ชื่อลูกค้าเพื่อค้นหา กดชื่อเพื่อดูรายละเอียดหรือแก้ไขสัญญา",
    },
    {
      target: "help-btn",
      title: "จบบทเรียน Admin",
      body: "ดูซ้ำได้ทุกเมื่อที่ปุ่ม “สอนใช้งาน” มุมขวาบน",
      cta: "เสร็จสิ้น",
    },
  ],
};
