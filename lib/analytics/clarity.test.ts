import { describe, expect, it } from "vitest";
import { clarityIdToLoad } from "./clarity";

describe("clarityIdToLoad", () => {
  it("id ถูกต้อง + production → คืน id", () => {
    expect(clarityIdToLoad("abcd1234xy", "production")).toBe("abcd1234xy");
  });
  it("preview / development / ว่าง → null", () => {
    expect(clarityIdToLoad("abcd1234xy", "preview")).toBeNull();
    expect(clarityIdToLoad("abcd1234xy", "development")).toBeNull();
    expect(clarityIdToLoad("abcd1234xy", "")).toBeNull();
    expect(clarityIdToLoad("abcd1234xy", undefined)).toBeNull();
  });
  it("ไม่มี id หรือ id ผิดรูปแบบ → null", () => {
    expect(clarityIdToLoad(undefined, "production")).toBeNull();
    expect(clarityIdToLoad("", "production")).toBeNull();
    expect(clarityIdToLoad("short", "production")).toBeNull();
    expect(clarityIdToLoad("ABCD1234XY", "production")).toBeNull();
    expect(clarityIdToLoad("abcdefgh1234x", "production")).toBeNull();
    expect(clarityIdToLoad('abcd1234";alert(1)', "production")).toBeNull();
    expect(clarityIdToLoad("abcd1234'x", "production")).toBeNull();
    expect(clarityIdToLoad("<script>abc", "production")).toBeNull();
  });
});
