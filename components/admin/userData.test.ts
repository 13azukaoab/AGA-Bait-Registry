/**
 * loadUsersPage: ส่ง created_at (วันเปิดบัญชี · DECISIONS 2.114) ต่อให้หน้า /admin/users
 * ใช้ client ปลอม — ตรวจรายการคอลัมน์ที่ select และการแปลงเป็น UserRow
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { loadUsersPage } from "./userData";

const PROFILE = {
  user_id: "u1",
  username: "ag-01001",
  display_name: "กนก",
  role: "host",
  position_code: "pm",
  is_active: true,
  must_change_password: false,
  last_login: null,
  created_at: "2026-01-05T02:00:00+00:00",
};

function fakeClient(selects: Record<string, string>) {
  const chain = (table: string, data: unknown[]) => {
    const q = {
      select(cols: string) {
        selects[table] = cols;
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return q;
  };
  return {
    from: (table: string) => chain(table, table === "profiles" ? [PROFILE] : []),
    rpc: () => Promise.resolve({ data: [], error: null }),
  } as unknown as SupabaseClient;
}

describe("loadUsersPage created_at", () => {
  it("selects created_at and maps it to createdAt", async () => {
    const selects: Record<string, string> = {};
    const res = await loadUsersPage(fakeClient(selects));
    expect(res.error).toBe(false);
    expect((selects.profiles ?? "").split(",").map((c) => c.trim())).toContain("created_at");
    expect(res.users[0]?.createdAt).toBe("2026-01-05T02:00:00+00:00");
  });
});
