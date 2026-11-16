import { describe, expect, it } from "vitest";

import { DATA_COLLECTION_OFF, isSentryEnabled, resolveSentryOptions } from "./options";

const DSN = "https://abc@o1.ingest.de.sentry.io/1";

describe("resolveSentryOptions", () => {
  it("ไม่มี DSN → null (ไม่ init)", () => {
    expect(resolveSentryOptions({ vercelEnv: "production" })).toBeNull();
    expect(resolveSentryOptions({ dsn: "", vercelEnv: "production" })).toBeNull();
    expect(resolveSentryOptions({ dsn: "   ", vercelEnv: "production" })).toBeNull();
  });

  it("ไม่ใช่ production → null แม้มี DSN", () => {
    for (const vercelEnv of ["preview", "development", "", undefined]) {
      expect(resolveSentryOptions({ dsn: DSN, vercelEnv })).toBeNull();
      expect(isSentryEnabled({ dsn: DSN, vercelEnv })).toBe(false);
    }
  });

  it("production + มี DSN → เปิด และตั้งค่า PDPA/โควตาถูกต้อง", () => {
    const options = resolveSentryOptions({ dsn: DSN, vercelEnv: "production" });
    expect(options).not.toBeNull();
    expect(options?.dataCollection).toEqual(DATA_COLLECTION_OFF);
    expect(options).not.toHaveProperty("sendDefaultPii", true);
    expect(options).not.toHaveProperty("tracesSampleRate");
    expect(options?.beforeSendLog?.()).toBeNull();
    expect(options?.beforeSendMetric?.()).toBeNull();
    expect(options?.environment).toBe("production");
    // ห้ามเปิด Replay / profiling
    expect(options).not.toHaveProperty("integrations");
    expect(options).not.toHaveProperty("replaysSessionSampleRate");
    expect(options).not.toHaveProperty("replaysOnErrorSampleRate");
    expect(options).not.toHaveProperty("profilesSampleRate");
  });

  it("hooks ผูกกับตัวกรอง PDPA", () => {
    const options = resolveSentryOptions({ dsn: DSN, vercelEnv: "production" });
    const event = options?.beforeSend?.(
      { type: undefined, request: { url: "https://a.co/x?phone=1", cookies: { a: "b" } }, user: { id: "1", email: "e" } },
    );
    expect(event).toMatchObject({ request: { url: "https://a.co/x" }, user: { id: "1" } });
    expect(options?.beforeBreadcrumb?.({ category: "console", message: "x" })).toBeNull();
  });
});

describe("DATA_COLLECTION_OFF", () => {
  it("ปิดทุกหมวดที่ SDK v11 เปิดเป็นค่าเริ่มต้น", () => {
    const d = DATA_COLLECTION_OFF;
    expect(d.userInfo).toBe(false);
    expect(d.cookies).toBe(false);
    expect(d.httpHeaders).toBe(false);
    expect(d.httpBodies).toEqual([]);
    expect(d.urlQueryParams).toBe(false);
    expect(d.databaseQueryData).toBe(false);
    expect(d.stackFrameVariables).toBe(false);
    expect(d.queues).toBe(false);
  });
});
