import { describe, expect, it } from "vitest";

import {
  DEFAULT_SORT,
  IDLE_BAD_DAYS,
  IDLE_WARN_DAYS,
  idleDays,
  idleLevel,
  nextSort,
  positionRank,
  selectSortKey,
  sortAnnouncement,
  sortUsers,
  toggleDir,
} from "./userSort";
import type { UserRow } from "./userLogic";

// ข้อมูลสมมติทั้งหมด (ไม่ใช่คนจริง) · "ตอนนี้" = 28/11/2026 10:00 เวลาไทย
const NOW = new Date("2026-11-28T10:00:00+07:00");

function user(o: Partial<UserRow> & { userId: string }): UserRow {
  return {
    username: "ag-01001",
    displayName: "ทดสอบ หนึ่ง",
    positionCode: "pm",
    role: "host",
    isActive: true,
    mustChangePassword: false,
    lastLogin: null,
    ...o,
  };
}

const A = user({ userId: "a", username: "ag-01001", displayName: "กนก", positionCode: "pm", lastLogin: "2026-11-28T08:41:00+07:00" });
const B = user({ userId: "b", username: "ag-01002", displayName: "ขวัญ", positionCode: "owner", lastLogin: "2026-11-20T10:05:00+07:00" });
const C = user({ userId: "c", username: "ag-01003", displayName: "คมสัน", positionCode: "supervisor", role: "recorder", lastLogin: null });
const D = user({ userId: "d", username: "ag-01004", displayName: "งามตา", positionCode: "job_admin", role: "admin", isActive: false, lastLogin: "2026-03-30T13:25:00+07:00" });
const E = user({ userId: "e", username: "ag-01005", displayName: "จันทร์", positionCode: "om", lastLogin: "2026-08-12T11:40:00+07:00" });
const ALL = [A, B, C, D, E];

const ids = (rows: UserRow[]) => rows.map((r) => r.userId).join("");

describe("sortUsers — ทุกคอลัมน์ ทั้งสองทิศ", () => {
  it("ชื่อ: ก→ฮ แล้วกลับทิศได้", () => {
    const asc = sortUsers(ALL, { key: "name", dir: "asc" }, NOW).map((u) => u.displayName);
    expect(asc).toEqual(["กนก", "ขวัญ", "คมสัน", "งามตา", "จันทร์"]);
    const desc = sortUsers(ALL, { key: "name", dir: "desc" }, NOW).map((u) => u.displayName);
    expect(desc).toEqual([...asc].reverse());
  });

  it("รหัสพนักงาน: น้อย→มาก / มาก→น้อย", () => {
    expect(ids(sortUsers(ALL, { key: "username", dir: "asc" }, NOW))).toBe("abcde");
    expect(ids(sortUsers(ALL, { key: "username", dir: "desc" }, NOW))).toBe("edcba");
  });

  it("ตำแหน่ง: เจ้าของ → PM → OM → แอดมิน → หัวหน้างาน และย้อนกลับ", () => {
    expect(ids(sortUsers(ALL, { key: "position", dir: "asc" }, NOW))).toBe("baedc");
    expect(ids(sortUsers(ALL, { key: "position", dir: "desc" }, NOW))).toBe("cdeab");
  });

  it("สถานะ: ใช้งานก่อน (เท่ากันเรียงชื่อ) / ปิดบัญชีก่อน", () => {
    expect(ids(sortUsers(ALL, { key: "status", dir: "asc" }, NOW))).toBe("abced");
    expect(ids(sortUsers(ALL, { key: "status", dir: "desc" }, NOW))).toBe("dabce");
  });

  it("เข้าใช้ล่าสุด: ใหม่→เก่า และ เก่า→ใหม่ (ยังไม่เคยเข้า = เก่าสุด)", () => {
    expect(ids(sortUsers(ALL, { key: "lastLogin", dir: "desc" }, NOW))).toBe("abedc");
    expect(ids(sortUsers(ALL, { key: "lastLogin", dir: "asc" }, NOW))).toBe("cdeba");
  });

  it("ไม่ได้เข้าใช้มา: มาก→น้อย (ยังไม่เคยเข้า = นานสุด ขึ้นบนสุด) และกลับทิศ", () => {
    expect(ids(sortUsers(ALL, { key: "idleDays", dir: "desc" }, NOW))).toBe("cdeba");
    expect(ids(sortUsers(ALL, { key: "idleDays", dir: "asc" }, NOW))).toBe("abedc");
  });

  it("ค่าเท่ากัน → เรียงตามชื่อ ไม่กลับทิศตามที่เลือก", () => {
    const x = user({ userId: "x", displayName: "ข", positionCode: "pm" });
    const y = user({ userId: "y", displayName: "ก", positionCode: "pm" });
    expect(ids(sortUsers([x, y], { key: "position", dir: "asc" }, NOW))).toBe("yx");
    expect(ids(sortUsers([x, y], { key: "position", dir: "desc" }, NOW))).toBe("yx");
  });

  it("ตำแหน่งไม่รู้จัก/ไม่มีตำแหน่ง ไปท้ายสุดเมื่อเรียงตามลำดับงาน", () => {
    const z = user({ userId: "z", displayName: "กก", positionCode: "new_role" });
    const n = user({ userId: "n", displayName: "กข", positionCode: null });
    expect(ids(sortUsers([z, n, C, A], { key: "position", dir: "asc" }, NOW))).toBe("aczn");
    expect(positionRank("new_role")).toBe(positionRank(null));
  });

  it("ไม่แก้ array เดิม", () => {
    const copy = [...ALL];
    sortUsers(ALL, { key: "name", dir: "desc" }, NOW);
    expect(ALL).toEqual(copy);
  });

  it("ค่าเริ่มต้น = ตำแหน่ง แล้วชื่อ", () => {
    expect(DEFAULT_SORT).toEqual({ key: "position", dir: "asc" });
  });
});

describe("nextSort / selectSortKey / toggleDir", () => {
  it("คอลัมน์ใหม่ได้ทิศแรกของมัน: ข้อความ = ขึ้น · วัน = ล่าสุด/นานสุดก่อน", () => {
    expect(nextSort(DEFAULT_SORT, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort(DEFAULT_SORT, "lastLogin")).toEqual({ key: "lastLogin", dir: "desc" });
    expect(nextSort(DEFAULT_SORT, "idleDays")).toEqual({ key: "idleDays", dir: "desc" });
  });
  it("กดคอลัมน์เดิมซ้ำสลับทิศ", () => {
    const s1 = nextSort(DEFAULT_SORT, "name");
    expect(nextSort(s1, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort(nextSort(s1, "name"), "name")).toEqual({ key: "name", dir: "asc" });
  });
  it("select มือถือเริ่มที่ทิศแรก · ปุ่มสลับทิศคงคอลัมน์", () => {
    expect(selectSortKey("idleDays")).toEqual({ key: "idleDays", dir: "desc" });
    expect(toggleDir({ key: "idleDays", dir: "desc" })).toEqual({ key: "idleDays", dir: "asc" });
  });
  it("ข้อความประกาศ", () => {
    expect(sortAnnouncement({ key: "name", dir: "asc" })).toBe("เรียงตาม ชื่อ-นามสกุล · ก → ฮ");
    expect(sortAnnouncement({ key: "idleDays", dir: "desc" })).toBe("เรียงตาม ไม่ได้เข้าใช้มา (วัน) · มาก → น้อย");
  });
});

describe("idleDays — นับวันตามปฏิทิน Asia/Bangkok", () => {
  const at = (iso: string) => idleDays(iso, NOW);
  it("วันนี้ = 0 · เมื่อวาน = 1", () => {
    expect(at("2026-11-28T00:05:00+07:00")).toBe(0);
    expect(at("2026-11-27T23:59:00+07:00")).toBe(1);
  });
  it("ยังไม่เคยเข้า/วันที่เสีย = null", () => {
    expect(idleDays(null, NOW)).toBeNull();
    expect(idleDays("ไม่ใช่วันที่", NOW)).toBeNull();
  });
  it("ข้ามเที่ยงคืนเวลาไทย: 23:30 เมื่อวาน เทียบ 00:10 วันนี้ = 1 วัน (ไม่ใช่ 0)", () => {
    const now = new Date("2026-11-28T00:10:00+07:00");
    expect(idleDays("2026-11-27T23:30:00+07:00", now)).toBe(1);
  });
  it("เที่ยงคืนไทยไม่ตรงกับเที่ยงคืน UTC: 02:00 ไทยวันนี้ (= 19:00 UTC เมื่อวาน) ยังเป็น 'วันนี้'", () => {
    const now = new Date("2026-11-28T09:00:00+07:00");
    expect(idleDays("2026-11-28T02:00:00+07:00", now)).toBe(0);
    // 17:30 UTC = 00:30 ไทยวันถัดไป → เป็นวันที่ 28 ของไทย ไม่ใช่ 27
    expect(idleDays("2026-11-27T17:30:00Z", now)).toBe(0);
  });
  it("เวลาในอนาคตปัดเป็น 0", () => {
    expect(at("2026-12-05T10:00:00+07:00")).toBe(0);
  });
  it("ข้ามเดือน/ปี", () => {
    expect(idleDays("2025-11-28T10:00:00+07:00", NOW)).toBe(365);
  });
});

describe("idleLevel — ขอบเขต 29/30/89/90 วัน", () => {
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
  const lv = (n: number, isActive = true) => idleLevel({ isActive, lastLogin: daysAgo(n) }, NOW);

  it("เกณฑ์เป็นค่าคงที่ 30 / 90", () => {
    expect(IDLE_WARN_DAYS).toBe(30);
    expect(IDLE_BAD_DAYS).toBe(90);
  });
  it("29 = ไม่เตือน · 30 = เหลือง", () => {
    expect(lv(29)).toBe("none");
    expect(lv(30)).toBe("warn");
  });
  it("89 = เหลือง · 90 = แดง", () => {
    expect(lv(89)).toBe("warn");
    expect(lv(90)).toBe("bad");
    expect(lv(400)).toBe("bad");
  });
  it("บัญชีปิดใช้งานไม่เตือนเลย", () => {
    expect(lv(30, false)).toBe("none");
    expect(lv(120, false)).toBe("none");
  });
  it("ยังไม่เคยเข้า = ไม่เตือน (ยังไม่มีวันเปิดบัญชีให้นับ)", () => {
    expect(idleLevel({ isActive: true, lastLogin: null }, NOW)).toBe("none");
  });
  it("นับตามวันปฏิทินไทย: 29 วัน 23 ชม. ก่อนหน้า (ข้ามเที่ยงคืน) = 30 วัน = เหลือง", () => {
    const now = new Date("2026-11-28T00:10:00+07:00");
    expect(idleLevel({ isActive: true, lastLogin: "2026-10-29T23:30:00+07:00" }, now)).toBe("warn");
  });
});
