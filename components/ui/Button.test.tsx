/**
 * เทส Button variant add / save (เรนเดอร์เป็น HTML string — ไม่ต้องใช้ DOM)
 * เช็กโครงสร้างที่ผู้ใช้เห็น: ข้อความ, ไอคอน, disabled/loading, type เริ่มต้น และ variant เดิมไม่เปลี่ยน
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

const html = (props: Parameters<typeof Button>[0]) => renderToStaticMarkup(createElement(Button, props));

describe("Button variant add", () => {
  const out = html({ variant: "add", children: "เพิ่มแถว" });
  it("แสดงข้อความ + ไอคอนบวก และไม่มี '+ ' ซ้ำ", () => {
    expect(out).toContain("เพิ่มแถว");
    expect(out).not.toContain("+ ");
    expect(out).toContain("<svg");
  });
  it("type เริ่มต้นเป็น button", () => {
    expect(out).toContain('type="button"');
  });
  it("loading → disabled + aria-busy", () => {
    const l = html({ variant: "add", loading: true, children: "เพิ่มแถว" });
    expect(l).toContain("disabled");
    expect(l).toContain('aria-busy="true"');
  });
});

describe("Button variant save", () => {
  it("แสดงข้อความ + ไอคอนดิสก์ และส่ง type=submit ได้", () => {
    const out = html({ variant: "save", type: "submit", children: "บันทึกเข้าทะเบียน" });
    expect(out).toContain("บันทึกเข้าทะเบียน");
    expect(out).toContain("<svg");
    expect(out).toContain('type="submit"');
  });
  it("disabled ส่งต่อให้ปุ่มจริง", () => {
    expect(html({ variant: "save", disabled: true, children: "บันทึก" })).toContain("disabled");
  });
});

describe("Button variant เดิม", () => {
  it("primary ยังใช้ class bg-accent", () => {
    expect(html({ variant: "primary", children: "ตกลง" })).toContain("bg-accent");
  });
});
