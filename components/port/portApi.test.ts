import { describe, expect, it, vi } from "vitest";

import { savePortRow, type PortWriter } from "./portApi";
import { buildUpsertPayload, emptyInput, portErrorMessage } from "./portLogic";

const payload = buildUpsertPayload({
  month: "2026-10", branchId: "b", branchName: "ตาก", input: emptyInput(), report: null, nowIso: "2026-11-19T00:00:00Z",
});

function writer(result: { error: { code?: string | null } | null } | Error) {
  const upsert = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const client: PortWriter = { from: () => ({ upsert }) };
  return { client, upsert };
}

describe("savePortRow", () => {
  it("สำเร็จ → ok · upsert ที่ month_key,branch_id", async () => {
    const { client, upsert } = writer({ error: null });
    expect(await savePortRow(client, payload)).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(payload, { onConflict: "month_key,branch_id" });
  });

  it.each(["SN001", "SN002", "SN003", "SN004", "23514", "42501"])("error %s → คืน code ที่แปลงเป็นไทยได้", async (code) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = writer({ error: { code } });
    const out = await savePortRow(client, payload);
    expect(out).toEqual({ ok: false, code });
    expect(portErrorMessage(out.ok ? null : out.code)).toMatch(/[ก-๙]/);
    expect(warn).toHaveBeenCalledWith("port save failed", code); // log เฉพาะ code
    warn.mockRestore();
  });

  it("เครือข่ายล้ม → code null (ข้อความทั่วไป)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = writer(new Error("secret raw message"));
    const out = await savePortRow(client, payload);
    expect(out).toEqual({ ok: false, code: null });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret raw message");
    warn.mockRestore();
  });
});
