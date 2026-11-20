/**
 * รวมบทเรียน + เลือกบทเรียนตามตำแหน่งของผู้ใช้
 *
 * ตำแหน่ง → บทเรียน (positions.code ใน supabase/migrations/20261110090300…):
 *   job_admin → admin · supervisor → recorder · pm / om / owner → pmom
 * ตำแหน่งที่ host เพิ่มเองภายหลัง (ไม่อยู่ในตาราง) → ใช้ role ของบัญชีแทน:
 *   admin → admin · recorder → recorder · host → pmom · viewer → ไม่มีบทเรียนเฉพาะ (ดูแค่ส่วนกลาง)
 */
import { adminLesson } from "./adminLesson";
import { centralLesson } from "./centralLesson";
import { pmomLesson } from "./pmomLesson";
import { recorderLesson } from "./recorderLesson";
import type { Lesson, LessonId } from "./types";

export type { Lesson, LessonId, LessonStep, StepScreen } from "./types";

export const LESSONS: Readonly<Record<LessonId, Lesson>> = {
  central: centralLesson,
  admin: adminLesson,
  recorder: recorderLesson,
  pmom: pmomLesson,
};

/** position_code → บทเรียนตำแหน่ง */
export const POSITION_LESSON: Readonly<Record<string, LessonId>> = {
  job_admin: "admin",
  supervisor: "recorder",
  pm: "pmom",
  om: "pmom",
  owner: "pmom",
};

/** role ของบัญชี (UserRole) → บทเรียนตำแหน่ง ใช้เมื่อไม่รู้จัก position_code */
const ROLE_LESSON: Readonly<Record<string, LessonId>> = {
  admin: "admin",
  recorder: "recorder",
  host: "pmom",
};

/**
 * เลือกบทเรียนตำแหน่งของผู้ใช้ · null = ไม่มีบทเรียนเฉพาะตำแหน่ง (เช่น viewer)
 * `positionCode` มาก่อน `role` เสมอ
 */
export function lessonIdForUser(
  positionCode: string | null | undefined,
  role: string | null | undefined,
): LessonId | null {
  if (positionCode && Object.hasOwn(POSITION_LESSON, positionCode)) {
    return POSITION_LESSON[positionCode] ?? null;
  }
  if (role && Object.hasOwn(ROLE_LESSON, role)) return ROLE_LESSON[role] ?? null;
  return null;
}

export function getLesson(id: string): Lesson | undefined {
  return Object.hasOwn(LESSONS, id) ? LESSONS[id as LessonId] : undefined;
}
