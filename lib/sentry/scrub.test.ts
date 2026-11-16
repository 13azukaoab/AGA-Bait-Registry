import type { Breadcrumb, Event } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { MAX_MESSAGE_LENGTH, scrubBreadcrumb, scrubEvent, stripUrlQuery } from "./scrub";

describe("stripUrlQuery", () => {
  it("ตัด query และ fragment ออกจาก URL เต็ม", () => {
    expect(stripUrlQuery("https://a.supabase.co/rest/v1/customers?name=eq.สมชาย&select=*#x")).toBe(
      "https://a.supabase.co/rest/v1/customers",
    );
  });
  it("ตัด query ใน path สัมพัทธ์", () => {
    expect(stripUrlQuery("/branches/nakhonpathom?customer=123")).toBe("/branches/nakhonpathom");
  });
  it("ตัด query ที่ปนอยู่ในข้อความ", () => {
    expect(stripUrlQuery("GET https://x.co/api?phone=0812345678 failed")).toBe("GET https://x.co/api failed");
  });
  it("ไม่แตะข้อความที่ไม่ใช่ URL", () => {
    expect(stripUrlQuery("Error #5 happened")).toBe("Error #5 happened");
  });
});

describe("scrubEvent", () => {
  const dirty: Event = {
    message: "boom",
    request: {
      url: "https://app.example.com/contracts?customer=สมชาย&phone=0812345678",
      query_string: "customer=สมชาย&phone=0812345678",
      cookies: { "sb-access-token": "secret" },
      headers: { cookie: "sb=secret", authorization: "Bearer x", "user-agent": "UA" },
      data: { customerName: "สมชาย", phone: "0812345678" },
    },
    user: { id: "user-1", email: "a@b.com", username: "somchai", ip_address: "1.2.3.4" },
    extra: { customer: "สมชาย" },
    server_name: "host-123",
    contexts: {
      browser: { name: "Chrome" },
      os: { name: "Android" },
      custom: { customerName: "สมชาย" },
    },
    breadcrumbs: [
      { category: "console", message: "customer สมชาย 0812345678" },
      { category: "fetch", data: { url: "https://x.supabase.co/rest/v1/customers?name=eq.x", method: "GET" } },
    ],
  };

  it("ตัด body, cookies, headers, query string ออกจาก request", () => {
    const out = scrubEvent(dirty);
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.headers).toBeUndefined();
    expect(out.request?.query_string).toBeUndefined();
    expect(out.request?.url).toBe("https://app.example.com/contracts");
  });

  it("user เหลือแค่ id", () => {
    expect(scrubEvent(dirty).user).toEqual({ id: "user-1" });
  });

  it("ไม่มี id → ลบ user ทิ้งทั้งก้อน", () => {
    expect(scrubEvent({ user: { email: "a@b.com", ip_address: "1.2.3.4" } }).user).toBeUndefined();
  });

  it("ลบ extra / server_name และ contexts ที่ไม่อยู่ในรายการปลอดภัย", () => {
    const out = scrubEvent(dirty);
    expect(out.extra).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    expect(Object.keys(out.contexts ?? {}).sort()).toEqual(["browser", "os"]);
  });

  it("กรอง breadcrumb ใน event: ทิ้ง console และตัด query ของ fetch", () => {
    const out = scrubEvent(dirty);
    expect(out.breadcrumbs).toHaveLength(1);
    expect(out.breadcrumbs?.[0]?.data?.url).toBe("https://x.supabase.co/rest/v1/customers");
  });

  it("จำกัดความยาวและตัด query ในข้อความ exception", () => {
    const long = "x".repeat(MAX_MESSAGE_LENGTH + 50);
    const out = scrubEvent({
      exception: {
        values: [
          { type: "Error", value: long },
          { type: "Error", value: "fetch https://a.co/x?phone=0812345678 failed" },
        ],
      },
    });
    expect(out.exception?.values?.[0]?.value?.length).toBe(MAX_MESSAGE_LENGTH + 1);
    expect(out.exception?.values?.[1]?.value).toBe("fetch https://a.co/x failed");
  });

  it("ตัด query ใน transaction และ span", () => {
    const out = scrubEvent({
      transaction: "GET /api/x?id=1",
      spans: [
        {
          span_id: "a",
          trace_id: "b",
          start_timestamp: 1,
          description: "GET https://x.co/rest/v1/customers?name=eq.x",
          data: { "http.query": "name=eq.x", url: "https://x.co/a?b=1", "http.request.body": "secret" },
        },
      ],
    } as unknown as Event);
    expect(out.transaction).toBe("GET /api/x");
    expect(out.spans?.[0]?.description).toBe("GET https://x.co/rest/v1/customers");
    expect(out.spans?.[0]?.data).toEqual({ url: "https://x.co/a" });
  });

  it("ไม่แก้ object เดิม", () => {
    const copy = structuredClone(dirty);
    scrubEvent(dirty);
    expect(dirty).toEqual(copy);
  });
});

describe("scrubBreadcrumb", () => {
  it("ทิ้ง breadcrumb ของ console", () => {
    expect(scrubBreadcrumb({ category: "console", message: "ข้อมูลลูกค้า" })).toBeNull();
  });

  it("ตัด query ของ fetch/xhr และลบ body/headers", () => {
    const b: Breadcrumb = {
      category: "xhr",
      data: {
        url: "/api/customers?phone=0812345678",
        method: "POST",
        request_body: "x",
        response_headers: { a: "b" },
      },
    };
    const out = scrubBreadcrumb(b);
    expect(out?.data).toEqual({ url: "/api/customers", method: "POST" });
  });

  it("ตัด query ของ navigation (from/to)", () => {
    const out = scrubBreadcrumb({
      category: "navigation",
      data: { from: "/a?x=1", to: "/b?name=สมชาย" },
    });
    expect(out?.data).toEqual({ from: "/a", to: "/b" });
  });
});
