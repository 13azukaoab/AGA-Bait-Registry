import { describe, it, expect } from "vitest";
import {
  normalizeContractNo,
  normalizeTime,
  parseSourceDate,
  normalizeTeams,
  resolveTermValue,
} from "./fields";

describe("normalizeContractNo", () => {
  it("trim + uppercase + ตัดช่องว่างใน: ' ct26-0028860 ' → CT26-0028860 (มี fix)", () => {
    const r = normalizeContractNo(" ct26-0028860 ");
    expect(r.value).toBe("CT26-0028860");
    expect(r.wellFormed).toBe(true);
    expect(r.fix).toBeDefined();
  });

  it("ค่าถูกต้องอยู่แล้ว → ไม่มี fix", () => {
    const r = normalizeContractNo("CT26-0028860");
    expect(r.value).toBe("CT26-0028860");
    expect(r.fix).toBeUndefined();
  });

  it("ไม่ใช่รูปแบบสัญญาเลย → isContractNo=false (เอาไว้ skip)", () => {
    expect(normalizeContractNo("จำนวน").isContractNo).toBe(false);
    expect(normalizeContractNo("").isContractNo).toBe(false);
  });

  it("เป็นสัญญาแต่เลขไม่ครบ 7 หลัก → wellFormed=false", () => {
    const r = normalizeContractNo("CT26-12345");
    expect(r.isContractNo).toBe(true);
    expect(r.wellFormed).toBe(false);
  });
});

describe("normalizeTime", () => {
  it("13:00:00 → 13:00 (มี fix)", () => {
    const r = normalizeTime("13:00:00");
    expect(r.value).toBe("13:00");
    expect(r.fix).toBeDefined();
  });

  it("09.00 น. → 09:00", () => {
    expect(normalizeTime("09.00 น.").value).toBe("09:00");
  });

  it("9:30 → 09:30 (เติมศูนย์หน้า)", () => {
    expect(normalizeTime("9:30").value).toBe("09:30");
  });

  it("ค่าถูกต้อง 14:30 → ไม่มี fix", () => {
    const r = normalizeTime("14:30");
    expect(r.value).toBe("14:30");
    expect(r.fix).toBeUndefined();
  });

  it("ว่าง → value=null ไม่มี error (ยังไม่นัด)", () => {
    const r = normalizeTime("");
    expect(r.value).toBeNull();
    expect(r.error).toBeUndefined();
  });

  it("อ่านไม่ออก → error", () => {
    expect(normalizeTime("บ่ายโมง").error).toBeDefined();
  });
});

describe("parseSourceDate", () => {
  it("dd/mm/yyyy → ISO", () => {
    expect(parseSourceDate("11/09/2026").iso).toBe("2026-09-11");
  });

  it("yyyy-mm-dd → ISO", () => {
    expect(parseSourceDate("2026-10-20").iso).toBe("2026-10-20");
  });

  it("ปีผิดปกติ (1900) → error", () => {
    expect(parseSourceDate("26/01/1900").error).toContain("ปี");
  });

  it("วันที่ไม่มีจริง 31/11/2026 → error", () => {
    expect(parseSourceDate("31/11/2026").error).toBeDefined();
  });

  it("รูปแบบพัง 25-09/26 → error", () => {
    expect(parseSourceDate("25-09/26").error).toBeDefined();
  });

  it("ว่าง → iso=null ไม่มี error", () => {
    const r = parseSourceDate("");
    expect(r.iso).toBeNull();
    expect(r.error).toBeUndefined();
  });
});

describe("normalizeTeams", () => {
  it("sup → Sup (มี fix)", () => {
    const r = normalizeTeams("sup");
    expect(r.teams).toEqual(["Sup"]);
    expect(r.fixes.length).toBe(1);
  });

  it("หนง. → Sup", () => {
    expect(normalizeTeams("หนง.").teams).toEqual(["Sup"]);
  });

  it("หลายทีมคั่น comma: A,E,Z", () => {
    const r = normalizeTeams("A,E,Z");
    expect(r.teams).toEqual(["A", "E", "Z"]);
    expect(r.error).toBeUndefined();
  });

  it("ตัวเล็ก o → O (มี fix)", () => {
    const r = normalizeTeams("o");
    expect(r.teams).toEqual(["O"]);
    expect(r.fixes.length).toBe(1);
  });

  it('"หลายทีม" ที่ไม่ระบุ → error', () => {
    const r = normalizeTeams("หลายทีม");
    expect(r.error).toBeDefined();
  });

  it("ทีมไม่รู้จัก → error", () => {
    expect(normalizeTeams("XYZ").error).toBeDefined();
  });

  it("ว่าง → teams=[] ไม่มี error (ยังไม่นัด)", () => {
    const r = normalizeTeams("");
    expect(r.teams).toEqual([]);
    expect(r.error).toBeUndefined();
  });
});

describe("resolveTermValue (อ่าน 1/3 ปีจากคอลัมน์มูลค่า)", () => {
  it("มูลค่าอยู่ช่อง 1 ปี → term 1", () => {
    const r = resolveTermValue("33426.80", "");
    expect(r.termYears).toBe(1);
    expect(r.valueTotal).toBe(33426.8);
  });

  it("มูลค่าอยู่ช่อง 3 ปี → term 3", () => {
    const r = resolveTermValue("", "64200");
    expect(r.termYears).toBe(3);
    expect(r.valueTotal).toBe(64200);
  });

  it("มีตัวคั่นหลักพัน: 1,234,567 → เลข", () => {
    expect(resolveTermValue("1,234,567", "").valueTotal).toBe(1234567);
  });

  it("ไม่มีมูลค่าทั้งสองช่อง → error", () => {
    expect(resolveTermValue("", "").error).toBeDefined();
  });

  it("มีมูลค่าทั้งสองช่อง → error (กำกวม)", () => {
    expect(resolveTermValue("100", "200").error).toBeDefined();
  });
});
