/**
 * บทเรียนส่วนกลาง (ทุกตำแหน่ง · 7 ขั้น) — ล็อกอิน + ตั้งรหัสผ่านใหม่
 * ฝึกบนหน้าจำลอง (sandbox) ไม่เรียกระบบจริง · จบแล้วต่อบทเรียนของตำแหน่ง (`next: "@position"`)
 * ข้อความตาม mockup docs/mockup/tutorial.html
 */
import type { Lesson } from "./types";

export const centralLesson: Lesson = {
  id: "central",
  title: "เริ่มใช้งานครั้งแรก",
  positions: ["ทุกตำแหน่ง"],
  next: "@position",
  steps: [
    {
      screen: "sandbox-login",
      target: "login-user",
      title: "ชื่อผู้ใช้ คือรหัสพนักงาน",
      body: "พิมพ์รหัสพนักงานของคุณ ไม่ต้องพิมพ์อีเมล (ในตัวอย่างนี้ใส่ให้แล้ว เป็นรหัสสมมติ)",
    },
    {
      screen: "sandbox-login",
      target: "login-pass",
      title: "รหัสผ่านชั่วคราว",
      body: "ใส่รหัสชั่วคราวที่ส่วนกลางให้ ใช้ได้ครั้งแรกครั้งเดียว กดรูปตาเพื่อตรวจว่าพิมพ์ถูก",
    },
    {
      screen: "sandbox-login",
      target: "login-btn",
      act: "click",
      title: "กดเข้าสู่ระบบ",
      body: "พร้อมแล้วกดปุ่มนี้ ระบบจะพาไปตั้งรหัสผ่านใหม่ทันที",
      hint: "ลองกดปุ่มที่ไฮไลต์ดูได้เลย",
    },
    {
      screen: "sandbox-chpw",
      target: "chpw-new",
      title: "ตั้งรหัสผ่านใหม่ (ข้ามไม่ได้)",
      body: "รหัสต้องยาวอย่างน้อย 8 ตัว มีตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก และตัวเลข ข้อที่ผ่านแล้วจะขึ้นเป็นสีเขียว",
      hint: "ลองพิมพ์ หรือกด “ใส่รหัสตัวอย่าง”",
    },
    {
      screen: "sandbox-chpw",
      target: "chpw-confirm",
      title: "พิมพ์ซ้ำอีกครั้ง",
      body: "พิมพ์รหัสเดิมซ้ำให้ตรงกัน กันพิมพ์ผิด",
    },
    {
      screen: "sandbox-chpw",
      target: "chpw-save",
      act: "click",
      guard: "pw",
      title: "บันทึกรหัสผ่านใหม่",
      body: "กดปุ่มนี้เมื่อรหัสผ่านทุกข้อเป็นสีเขียว",
      hint: "ต้องกรอกรหัสให้ผ่านก่อนถึงจะไปต่อได้",
    },
    {
      screen: "sandbox-chpw",
      target: null,
      title: "เข้าระบบสำเร็จ",
      body: "ต่อไปคือบทเรียนของตำแหน่งคุณ ใช้เวลาไม่ถึง 3 นาที ข้ามได้ทุกเมื่อ",
      cta: "เริ่มบทเรียนของฉัน",
    },
  ],
};
