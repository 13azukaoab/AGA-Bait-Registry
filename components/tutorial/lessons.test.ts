/**
 * เทสข้อมูลบทเรียน: เลือกบทเรียนตามตำแหน่ง + ข้อมูลครบ + จุดชี้ (data-tour) มีอยู่จริงในหน้าจริง
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NAV_GROUPS } from "@/components/shell/nav-items";

import { LESSONS, getLesson, lessonIdForUser, POSITION_LESSON } from "./lessons";
import { homeForRole } from "@/lib/auth/access";

describe("เลือกบทเรียนตามตำแหน่ง", () => {
  it("position_code ในตาราง positions → บทเรียนของตำแหน่งนั้น", () => {
    expect(lessonIdForUser("job_admin", "admin")).toBe("admin");
    expect(lessonIdForUser("supervisor", "recorder")).toBe("recorder");
    expect(lessonIdForUser("pm", "host")).toBe("pmom");
    expect(lessonIdForUser("om", "host")).toBe("pmom");
    expect(lessonIdForUser("owner", "host")).toBe("pmom");
  });

  it("position_code มาก่อน role (กรณีขัดกัน)", () => {
    expect(lessonIdForUser("supervisor", "host")).toBe("recorder");
  });

  it("ตำแหน่งที่ host เพิ่มเอง (ไม่รู้จัก) → ใช้ role แทน", () => {
    expect(lessonIdForUser("custom_position", "admin")).toBe("admin");
    expect(lessonIdForUser("custom_position", "recorder")).toBe("recorder");
    expect(lessonIdForUser(null, "host")).toBe("pmom");
  });

  it("viewer / ไม่มีข้อมูล → ไม่มีบทเรียนเฉพาะตำแหน่ง (null)", () => {
    expect(lessonIdForUser(null, "viewer")).toBeNull();
    expect(lessonIdForUser(undefined, undefined)).toBeNull();
    expect(lessonIdForUser("", "")).toBeNull();
  });

  it("ชื่อพิเศษของ Object (constructor ฯลฯ) ไม่หลุดเป็นบทเรียน", () => {
    expect(lessonIdForUser("constructor", "viewer")).toBeNull();
    expect(lessonIdForUser("__proto__", "toString")).toBeNull();
    expect(getLesson("constructor")).toBeUndefined();
  });

  it("ทุกตำแหน่งในแผนที่ชี้ไปบทเรียนที่มีอยู่จริง", () => {
    for (const id of Object.values(POSITION_LESSON)) expect(getLesson(id)).toBeDefined();
  });
});

describe("ข้อมูลบทเรียน", () => {
  it("จำนวนขั้น (หลังตัดบท login/รหัสผ่าน · DECISIONS 2.111): Admin 7 · หัวหน้างาน 8 · PM/OM 7 · ไม่มีบทส่วนกลาง", () => {
    expect(Object.keys(LESSONS).sort()).toEqual(["admin", "pmom", "recorder"]);
    expect(getLesson("central")).toBeUndefined();
    expect(LESSONS.admin.steps).toHaveLength(7);
    expect(LESSONS.recorder.steps).toHaveLength(8);
    expect(LESSONS.pmom.steps).toHaveLength(7);
  });

  it("ทุกขั้นมีหัวข้อ + เนื้อหา · ขั้น act=click ต้องมีจุดชี้", () => {
    for (const lesson of Object.values(LESSONS)) {
      for (const step of lesson.steps) {
        expect(step.title.trim()).not.toBe("");
        expect(step.body.trim()).not.toBe("");
        if (step.act === "click") expect(step.target).not.toBeNull();
      }
    }
  });

  it("ไม่มีบทไหนต่อบทอื่น · ใช้หน้าจริงทั้งหมด (ไม่มีหน้าจำลอง login / เปลี่ยนรหัส)", () => {
    for (const lesson of Object.values(LESSONS)) {
      expect("next" in lesson).toBe(false);
      expect(lesson.steps.every((s) => (s.screen ?? "app") === "app" && !s.guard)).toBe(true);
    }
  });

  it("ไม่มีขั้นสอน login / รหัสชั่วคราว / เปลี่ยนรหัสผ่าน ในบทใดเลย", () => {
    // หมายเหตุ: ขั้น usr-add ของ PM/OM พูดถึง “รหัสชั่วคราว” ตอนสร้างบัญชีให้คนอื่น — เป็นเนื้อหาคนละเรื่อง คงไว้
    const banned = /login-|chpw-|รหัสผ่านชั่วคราว|ตั้งรหัสผ่านใหม่|เปลี่ยนรหัสผ่าน|เข้าสู่ระบบ|ชื่อผู้ใช้ คือ/;
    for (const lesson of Object.values(LESSONS)) {
      for (const step of lesson.steps) {
        const text = [step.target ?? "", step.title, step.body, step.hint ?? "", step.cta ?? ""].join(" ");
        expect(text, `${lesson.id}:${step.target}`).not.toMatch(banned);
      }
    }
  });

  it("ขั้นแรกของทุกบทอยู่หน้าแรกของตำแหน่ง (path ตรง homeForRole หรือชี้เมนู/ไม่ระบุหน้า)", () => {
    const roleOf = { admin: "admin", recorder: "recorder", pmom: "host" } as const;
    for (const id of ["admin", "recorder", "pmom"] as const) {
      const first = LESSONS[id].steps[0]!;
      expect(first.screen ?? "app").toBe("app");
      // ไม่มี path = ชี้ได้ทุกหน้า (เมนูซ้าย) · มี path = ต้องเป็นหน้าแรกของ role นั้น
      if (first.path) expect(first.path).toBe(homeForRole(roleOf[id]));
    }
  });
});

/* ---------- จุดชี้ต้องมีอยู่จริงในโค้ดหน้าจอ ---------- */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

function collectDataTourKeys(): Set<string> {
  const keys = new Set<string>();
  const root = process.cwd();
  const files = [...walk(join(root, "components")), ...walk(join(root, "app"))];
  const attr = /data-tour=(?:"([^"]+)"|\{([^}]*)\})/g;
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(attr)) {
      if (m[1]) keys.add(m[1]);
      if (m[2]) for (const q of m[2].matchAll(/"([^"]+)"/g)) keys.add(q[1]!);
    }
  }
  // NavLinks ใส่ data-tour={`nav-${item.key}`} ให้ทุกเมนู
  for (const group of NAV_GROUPS) for (const item of group.items) keys.add(`nav-${item.key}`);
  return keys;
}

/** จุดชี้ที่หน้าจริงยังไม่มี (หน้ายังเป็นหน้าตัวอย่าง ScreenStub) — ตัวแสดงจะข้ามขั้นเหล่านี้เงียบๆ · เอาออกเมื่อหน้าจริงเสร็จ */
const PENDING_PAGES = new Set<string>();

describe("จุดชี้ data-tour ในหน้าจริง", () => {
  const keys = collectDataTourKeys();

  it("ทุกจุดที่บทเรียนชี้ มี data-tour ในโค้ด (ยกเว้นหน้าที่ยังเป็นหน้าตัวอย่าง)", () => {
    const missing: string[] = [];
    for (const lesson of Object.values(LESSONS)) {
      for (const step of lesson.steps) {
        if (step.target && !keys.has(step.target) && !PENDING_PAGES.has(step.target)) {
          missing.push(`${lesson.id}:${step.target}`);
        }
        if (step.fallback && !keys.has(step.fallback.target)) missing.push(`${lesson.id}:fallback:${step.fallback.target}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("รายการ “หน้ายังไม่เสร็จ” ต้องยังหาไม่เจอจริง (ถ้าเจอแล้วให้เอาออกจาก PENDING_PAGES)", () => {
    for (const key of PENDING_PAGES) expect(keys.has(key)).toBe(false);
  });

  it("หน้าทะเบียน (/customers) และรอเก็บ (/collection) เป็นหน้าจริงแล้ว — มีจุดชี้ reg-search และ collect-list", () => {
    expect(keys.has("reg-search")).toBe(true);
    expect(keys.has("collect-list")).toBe(true);
  });

  it("หัวหน้างาน (svc-allok, bait-add) และ PM/OM (port-save) มีจุดสำรอง", () => {
    const fb = (id: "recorder" | "pmom") =>
      LESSONS[id].steps.filter((s) => s.fallback).map((s) => `${s.target}->${s.fallback!.target}`);
    expect(fb("recorder")).toEqual(["svc-allok->contract-list", "bait-add->contract-list"]);
    expect(fb("pmom")).toEqual(["port-save->port-list"]);
  });

  it("ขั้นบันทึกสัญญาของ Admin มีข้อความสำรองเมื่อปุ่มถูกปิด · port-list ชี้หัวตาราง (thead)", () => {
    const save = LESSONS.admin.steps.find((s) => s.target === "new-save")!;
    expect(save.disabledBody).toContain("กรอก");
    const port = readFileSync(join(process.cwd(), "components/port/PortClient.tsx"), "utf8");
    expect(port).toMatch(/<thead data-tour="port-list">/);
    expect(port).not.toMatch(/<table[^>]*data-tour="port-list"/);
  });

  it("ข้อความขั้นท้าย Admin ไม่อ้างคู่มือที่ยังไม่มี", () => {
    expect(LESSONS.admin.steps.at(-1)!.body).not.toContain("คู่มือ");
  });

  it("ปุ่ม “สอนใช้งาน” (help-btn) มีที่แถบบน", () => {
    expect(keys.has("help-btn")).toBe(true);
  });
});
