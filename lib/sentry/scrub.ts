/**
 * ตัวกรองข้อมูลส่วนบุคคลก่อนส่งเข้า Sentry (PDPA · M32) — pure function ทดสอบได้ ไม่เรียก SDK
 *
 * Logic summary:
 *   - `beforeSend` (scrubEvent): ตัด request body / query string / cookies / headers ทิ้งทั้งหมด,
 *     ตัด query ออกจาก URL, user เหลือแค่ `id`, ลบ extra / server_name, contexts เก็บเฉพาะ
 *     ที่ไม่มีข้อมูลบุคคล (browser/os/device/runtime/app/trace), ตัดข้อความ error ให้สั้น
 *     (กันข้อมูลลูกค้าติดมากับข้อความ error ยาวๆ), และกรอง breadcrumb ในตัว event ซ้ำอีกชั้น
 *   - `beforeBreadcrumb` (scrubBreadcrumb): ทิ้ง breadcrumb ของ console (ข้อความอาจมีข้อมูลลูกค้า),
 *     ตัด query/fragment ออกจาก URL ของ fetch/xhr/navigation และลบ body/headers
 *   - ฝั่ง Sentry (org) เปิด Data Scrubber + ไม่เก็บ IP ไว้แล้วอีกชั้น — ที่นี่คือด่านแรกก่อนข้อมูลออกจากเครื่อง
 *
 * ⚠ ห้ามเพิ่มการแนบข้อมูลลูกค้า (ชื่อ เบอร์ ที่อยู่ เลขสัญญา) ผ่าน Sentry.setContext / setExtra / setTag
 */
import type { Breadcrumb, Event } from "@sentry/nextjs";

/** ความยาวสูงสุดของข้อความ error ที่ส่งออก (ตัวอักษร) */
export const MAX_MESSAGE_LENGTH = 200;

/** contexts ที่ปลอดภัย (ไม่มีข้อมูลบุคคล) — ที่เหลือถูกตัดทิ้ง */
const SAFE_CONTEXT_KEYS = new Set(["browser", "os", "device", "runtime", "app", "trace"]);

/** ตัด query string + fragment ออกจาก URL (รองรับ URL เต็ม, path สัมพัทธ์ และข้อความที่มี URL ปน เช่น "GET https://x/y?a=1") */
export function stripUrlQuery(value: string): string {
  // ต้องมี "/" ในส่วนหน้า ? หรือ # จึงนับเป็น URL (กัน "Error #5" ถูกตัด)
  return value.replace(/([^\s?#]*\/[^\s?#]*)[?#]\S*/g, "$1");
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text;
}

/** ข้อความ error: ตัด query ใน URL ที่ปนมา + จำกัดความยาว */
function cleanMessage(text: string): string {
  return truncate(stripUrlQuery(text));
}

const URL_KEYS = new Set(["url", "to", "from", "url.full", "http.url", "http.query", "http.fragment"]);

/** ตัด URL query ออกจากค่าในกองข้อมูล (breadcrumb.data / span.data) และลบ body/headers/query เดี่ยวๆ */
function scrubDataBag(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const lower = key.toLowerCase();
    if (lower === "http.query" || lower === "http.fragment") continue;
    if (lower.includes("body") || lower.includes("header") || lower.includes("cookie")) continue;
    if (lower === "query" || lower === "query_string") continue;
    if (URL_KEYS.has(lower) && typeof value === "string") {
      out[key] = stripUrlQuery(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** กรอง breadcrumb — คืน null เมื่อไม่ควรส่งเลย */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // console.log/warn/error อาจพ่นข้อมูลลูกค้าออกมา → ไม่เก็บ
  if (breadcrumb.category === "console") return null;

  const cleaned: Breadcrumb = { ...breadcrumb };
  if (typeof cleaned.message === "string") cleaned.message = cleanMessage(cleaned.message);
  if (cleaned.data) cleaned.data = scrubDataBag(cleaned.data);
  return cleaned;
}

/** กรอง event (error/transaction) ก่อนส่ง — ไม่แก้ object เดิม */
export function scrubEvent<T extends Event>(event: T): T {
  const out: T = { ...event };

  // ---------- request: ทิ้ง body/cookies/headers/query ----------
  if (out.request) {
    const request = { ...out.request };
    delete request.data;
    delete request.cookies;
    delete request.headers;
    delete request.query_string;
    if (typeof request.url === "string") request.url = stripUrlQuery(request.url);
    out.request = request;
  }

  // ---------- user: เหลือได้แค่ id ----------
  if (out.user) {
    out.user = out.user.id !== undefined ? { id: out.user.id } : {};
    if (Object.keys(out.user).length === 0) delete out.user;
  }

  // ---------- ข้อมูลเสริมที่อาจมีข้อมูลบุคคล ----------
  delete out.extra;
  delete out.server_name;
  delete out.modules;

  if (out.contexts) {
    const kept: NonNullable<Event["contexts"]> = {};
    for (const [key, value] of Object.entries(out.contexts)) {
      if (SAFE_CONTEXT_KEYS.has(key)) kept[key] = value;
    }
    out.contexts = kept;
  }

  // ---------- ข้อความ error ----------
  if (typeof out.message === "string") out.message = cleanMessage(out.message);
  if (out.logentry?.message) out.logentry = { ...out.logentry, message: cleanMessage(out.logentry.message) };
  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v) =>
        typeof v.value === "string" ? { ...v, value: cleanMessage(v.value) } : v,
      ),
    };
  }

  // ---------- breadcrumbs ที่ติดมากับ event ----------
  if (out.breadcrumbs) {
    out.breadcrumbs = out.breadcrumbs
      .map((b) => scrubBreadcrumb(b))
      .filter((b): b is Breadcrumb => b !== null);
  }

  // ---------- transaction (ถ้าเปิด tracing ในอนาคต) ----------
  if (out.transaction) out.transaction = stripUrlQuery(out.transaction);
  if (out.spans) {
    out.spans = out.spans.map((span) => ({
      ...span,
      ...(span.description ? { description: stripUrlQuery(span.description) } : {}),
      ...(span.data ? { data: scrubDataBag(span.data) as typeof span.data } : {}),
    }));
  }

  return out;
}
