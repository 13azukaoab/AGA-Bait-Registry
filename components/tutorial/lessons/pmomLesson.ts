/**
 * บทเรียนตำแหน่ง PM / OM (และเจ้าของ) · position_code = pm, om, owner · 7 ขั้น
 * ข้อความตาม mockup docs/mockup/tutorial.html · จุดชี้ = data-tour ในหน้าจริง
 *   nav-admin-group / nav-users → components/shell/NavLinks.tsx
 *   usr-add → components/admin/UsersClient.tsx · set-tabs → components/settings/SettingsClient.tsx
 *   port-save → components/port/PortEditor.tsx · sync-run → components/dashboard-sync/DashboardSyncClient.tsx
 * ขั้นสุดท้ายชี้ปุ่ม "สอนใช้งาน" (help-btn) ที่แถบบน
 */
import type { Lesson } from "./types";

export const pmomLesson: Lesson = {
  id: "pmom",
  title: "PM / OM",
  positions: ["Project Manager", "OM"],
  steps: [
    {
      path: "/todo",
      target: "nav-admin-group",
      title: "เห็นครบทุกเมนู",
      body: "PM / OM เห็นเมนูทุกกลุ่ม รวมกลุ่ม “ดูแลระบบ” ที่ตำแหน่งอื่นไม่เห็น",
    },
    {
      target: "nav-users",
      act: "click",
      title: "จัดการผู้ใช้",
      body: "สร้างบัญชี รีเซ็ตรหัส และปิดบัญชีทำที่นี่",
      hint: "กดเมนูที่ไฮไลต์",
    },
    {
      path: "/admin/users",
      target: "usr-add",
      title: "สร้างบัญชีใหม่",
      body: "เลือกตำแหน่ง ระบบกำหนดสิทธิ์ให้เอง และออกรหัสชั่วคราวให้ส่งต่อผู้ใช้",
    },
    {
      path: "/admin/settings",
      target: "set-tabs",
      title: "ตั้งค่า",
      body: "เกณฑ์ Tier ประเภทลูกค้า และทีม แก้ที่แท็บเหล่านี้ ระบบอ่านเกณฑ์จากที่นี่ทุกครั้ง",
    },
    {
      path: "/admin/port",
      target: "port-save",
      title: "ลงข้อมูล Port ต่างจังหวัด",
      body: "สาขาต่างจังหวัดที่ยังไม่ใช้ระบบ ลงตัวเลขประจำเดือนที่หน้านี้",
    },
    {
      path: "/admin/sync",
      target: "sync-run",
      title: "Dashboard Sync",
      body: "ส่งข้อมูลไป AGA Bait Dashboard อัตโนมัติทุกเช้า 06:00 กดเองได้ที่ปุ่มนี้",
    },
    {
      path: "/admin/history",
      target: "help-btn",
      title: "ประวัติการแก้ไข และจบบทเรียน",
      body: "ดูว่าใครแก้อะไรเมื่อไหร่ได้ที่เมนู “ประวัติการแก้ไข” · ดูบทเรียนซ้ำได้ที่ปุ่ม “สอนใช้งาน”",
      cta: "เสร็จสิ้น",
    },
  ],
};
