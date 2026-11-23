/**
 * บทเรียนตำแหน่งหัวหน้างาน · position_code = supervisor · 8 ขั้น
 * ข้อความตาม mockup docs/mockup/tutorial.html · จุดชี้ = data-tour ในหน้าจริง
 *   todo-stats → components/todo/SummaryCards.tsx · svc-* → components/service/ServiceForm.tsx / AgSection.tsx
 *   bait-add → components/bait/BaitForm.tsx · collect-list → components/collection/CollectionClient.tsx (กรอบตารางรายการ)
 *   clo-send → components/months/MonthsClient.tsx
 * ⚠ ขั้น svc-* ต้องเลือกลูกค้าในรายการก่อนฟอร์มถึงจะโผล่ svc-allok / bait-add มีจุดสำรองชี้รายการลูกค้า (contract-list) ส่วน svc-termite / svc-ag ถ้าฟอร์มยังไม่ขึ้นจะถูกข้ามเงียบๆ
 */
import type { Lesson } from "./types";

export const recorderLesson: Lesson = {
  id: "recorder",
  title: "หัวหน้างาน",
  positions: ["หัวหน้างาน", "Supervisor"],
  steps: [
    {
      path: "/todo",
      target: "todo-stats",
      title: "ดูงานของเดือนนี้",
      body: "หน้านี้บอกว่าเดือนนี้มีลูกค้ากี่ราย ทำแล้วกี่ราย เหลือกี่ราย",
    },
    {
      target: "nav-service",
      act: "click",
      title: "ไปกรอกผลบริการ",
      body: "เมนู “ลงข้อมูลทำบริการประจำเดือน” ใช้กรอกผลทีละรายหลังเข้าบริการ",
      hint: "กดเมนูที่ไฮไลต์",
    },
    {
      path: "/service",
      target: "svc-allok",
      act: "click",
      title: "ทุกอย่างปกติ กดทีเดียว",
      body: "ถ้า IG / IC ทุกสถานีปกติ กดปุ่มนี้ปุ่มเดียวแทนการกรอกทีละสถานี",
      hint: "ลองกดปุ่มที่ไฮไลต์",
      fallback: {
        target: "contract-list",
        title: "เลือกลูกค้าก่อน",
        body: "เลือกลูกค้าจากรายการนี้ก่อน แล้วฟอร์มกรอกผลบริการจะขึ้นมา (ปุ่ม “IG / IC ปกติทั้งหมด” อยู่ในฟอร์มนั้น)",
      },
    },
    {
      path: "/service",
      target: "svc-termite",
      title: "พบปลวก",
      body: "ถ้าสถานีไหนพบปลวก ติ๊กช่องนี้ แล้วระบุสถานีที่พบ",
    },
    {
      path: "/service",
      target: "svc-ag",
      title: "กล่อง AG ในรอบบริการ",
      body: "ถ้าเปลี่ยนหรือวางกล่อง AG พร้อมรอบบริการ ให้ติ๊กตรงนี้",
    },
    {
      path: "/bait",
      target: "bait-add",
      title: "กล่อง AG นอกรอบ",
      body: "ถ้าไปวาง AG แยกจากรอบประจำเดือน บันทึกที่หน้านี้",
      fallback: {
        target: "contract-list",
        title: "เลือกลูกค้าก่อน",
        body: "เลือกลูกค้าที่ไปวาง AG นอกรอบจากรายการนี้ก่อน แล้วฟอร์มบันทึกกล่อง AG จะขึ้นมา",
      },
    },
    {
      path: "/collection",
      target: "collect-list",
      title: "ลูกค้ารอเก็บสถานี",
      body: "ลูกค้าที่หมดสัญญาจะขึ้นที่นี่ เก็บสถานีเสร็จแล้วกดยืนยันรายตัว",
    },
    {
      path: "/admin/closure",
      target: "clo-send",
      title: "ส่งข้อมูลปลายเดือน",
      body: "สิ้นเดือนกดส่งข้อมูลและดูสรุปงานของสาขา",
      hint: "ดูซ้ำได้ที่ปุ่ม “สอนใช้งาน” มุมขวาบน",
      cta: "เสร็จสิ้น",
    },
  ],
};
