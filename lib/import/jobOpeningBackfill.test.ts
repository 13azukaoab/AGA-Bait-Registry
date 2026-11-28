import { describe, expect, it } from "vitest";

import {
  classifyNotFound,
  planJobOpeningBackfill,
  registryNotImportedFromPlan,
  targetsFromPlan,
  type BackfillTarget,
} from "./jobOpeningBackfill";
import type { JobEntry, JobFieldValue, JobOpeningIndex } from "./jobOpeningServiceDates";
import type { RegistryImportPlan } from "./registryImportPlan";

// ข้อมูลสมมติทั้งหมด (เลขสัญญา/วันที่สมมติ · ไม่มีข้อมูลลูกค้า)

const BATCH = "registry-OCT26";

const val = (value: string | null, extra: Partial<JobFieldValue> = {}): JobFieldValue => ({ value, conflict: false, hadProblem: false, ...extra });

function job(contractNo: string, mail: string | null, service: string | null, time: string | null, more: Partial<JobEntry> = {}): JobEntry {
  return {
    contractNo,
    occurrences: [{ source: "2569", sheet: "ต.ค.26", excelRow: 4 }],
    branchText: "สาทร",
    mail: val(mail),
    service: val(service),
    time: val(time),
    timeFromRange: false,
    ...more,
  };
}

function index(entries: JobEntry[]): JobOpeningIndex {
  return { entries: new Map(entries.map((e) => [e.contractNo, e])), sheets: [], sheetsSkipped: [], problems: [], duplicates: [] };
}

function target(contractNo: string, more: Partial<BackfillTarget> = {}): BackfillTarget {
  return {
    id: `id-${contractNo}`,
    contractNo,
    importBatch: BATCH,
    status: "active",
    startDate: "2026-10-01",
    endDate: "2027-09-30",
    saleType: "new",
    mail: null,
    serviceDate: null,
    serviceTime: null,
    ...more,
  };
}

const OPTS = { fillBatches: [BATCH] };

describe("planJobOpeningBackfill", () => {
  it("ช่องว่างทั้ง 3 → เติมครบ · นับรายช่อง/รายเดือนวันเริ่ม", () => {
    const p = planJobOpeningBackfill(index([job("CT26-0000001", "2026-09-28", "2026-10-03", "09:00")]), [target("CT26-0000001")], OPTS);
    expect(p.updates).toEqual([
      {
        id: "id-CT26-0000001",
        contractNo: "CT26-0000001",
        set: { mail_received_date: "2026-09-28", first_service_date: "2026-10-03", first_service_time: "09:00" },
      },
    ]);
    expect(p.counts).toMatchObject({ matched: 1, eligible: 1, contractsToUpdate: 1, fills: { mail: 1, service: 1, time: 1 } });
    expect(p.fillsByStartMonth).toEqual({ "2026-10": { mail: 1, service: 1, time: 1 } });
  });

  it("ไม่ทับค่าที่มีอยู่ (เท่ากัน / ต่างกัน นับแยก + เลขสัญญาที่ต่าง)", () => {
    const p = planJobOpeningBackfill(
      index([job("CT26-0000002", "2026-09-28", "2026-10-03", null), job("CT26-0000003", "2026-09-28", null, null)]),
      [target("CT26-0000002", { mail: "2026-09-28", serviceDate: "2026-10-04" }), target("CT26-0000003", { mail: "2026-09-01" })],
      OPTS,
    );
    expect(p.updates).toEqual([]);
    expect(p.counts.alreadySame.mail).toBe(1);
    expect(p.counts.alreadyDifferent).toMatchObject({ mail: 1, service: 1 });
    expect(p.differentContractNos).toEqual({ mail: ["CT26-0000003"], service: ["CT26-0000002"], time: [] });
  });

  it("เวลา: DB มีวันเดียวกันอยู่แล้ว → เติมเวลาอย่างเดียว + requireServiceDate", () => {
    const p = planJobOpeningBackfill(
      index([job("CT26-0000004", null, "2026-10-03", "13:30")]),
      [target("CT26-0000004", { serviceDate: "2026-10-03" })],
      OPTS,
    );
    expect(p.updates).toEqual([
      { id: "id-CT26-0000004", contractNo: "CT26-0000004", set: { first_service_time: "13:30" }, requireServiceDate: "2026-10-03" },
    ]);
  });

  it("เวลา: DB มีวันอื่น = ไม่เติม (dateMismatch) · ไม่มีวันที่เลย = ไม่เติม (noDate)", () => {
    const p = planJobOpeningBackfill(
      index([job("CT26-0000005", null, "2026-10-03", "13:30"), job("CT26-0000006", null, null, "13:30")]),
      [target("CT26-0000005", { serviceDate: "2026-10-09" }), target("CT26-0000006")],
      OPTS,
    );
    expect(p.updates).toEqual([]);
    expect(p.counts).toMatchObject({ timeDateMismatch: 1, timeNoDate: 1 });
  });

  it("ค่าในไฟล์ conflict / อ่านไม่ได้ / ว่าง = ไม่เติม นับแยกเหตุ", () => {
    const p = planJobOpeningBackfill(
      index([
        job("CT26-0000007", null, null, null, {
          mail: val(null, { conflict: true }),
          service: val(null, { hadProblem: true }),
        }),
      ]),
      [target("CT26-0000007")],
      OPTS,
    );
    expect(p.updates).toEqual([]);
    expect(p.counts.conflict.mail).toBe(1);
    expect(p.counts.problemOnly.service).toBe(1);
    expect(p.counts.noValue.time).toBe(1);
  });

  it("ไม่แตะสัญญาที่เปิดในแอป / batch อื่น / สถานะปิด-ยกเลิก (นับแยก)", () => {
    const p = planJobOpeningBackfill(
      index([
        job("CT26-0000008", "2026-10-01", null, null),
        job("CT26-0000009", "2026-10-01", null, null),
        job("CT26-0000010", "2026-10-01", null, null),
        job("CT26-0000011", "2026-10-01", null, null),
      ]),
      [
        target("CT26-0000008", { importBatch: null }),
        target("CT26-0000009", { importBatch: "registry-OCT26-fix1" }),
        target("CT26-0000010", { status: "cancelled" }),
        target("CT26-0000011", { status: "closed" }),
      ],
      OPTS,
    );
    expect(p.updates).toEqual([]);
    expect(p.counts.otherBatch).toEqual({ "": 1, "registry-OCT26-fix1": 1 });
    expect(p.counts.skippedStatus).toEqual({ cancelled: 1, closed: 1 });
    expect(p.counts.eligible).toBe(0);
  });

  it("fillBatches เพิ่ม batch รอบเติมได้ · skipStatuses ปรับได้", () => {
    const p = planJobOpeningBackfill(
      index([job("CT26-0000012", "2026-10-01", null, null), job("CT26-0000013", "2026-10-01", null, null)]),
      [target("CT26-0000012", { importBatch: "registry-OCT26-fix1" }), target("CT26-0000013", { status: "closed" })],
      { fillBatches: [BATCH, "registry-OCT26-fix1"], skipStatuses: ["cancelled"] },
    );
    expect(p.updates.map((u) => u.contractNo)).toEqual(["CT26-0000012", "CT26-0000013"]);
  });

  it("คำเตือน: Mail หลังวันบริการ · บริการก่อนวันเริ่ม · บริการหลังวันสิ้นสุด → เติมตามปกติ (skipWarned = ไม่เติม)", () => {
    const jobs = index([
      job("CT26-0000014", "2026-10-10", "2026-10-03", null),
      job("CT26-0000015", null, "2026-09-20", null),
      job("CT26-0000016", null, "2027-10-20", null),
    ]);
    const targets = [target("CT26-0000014"), target("CT26-0000015"), target("CT26-0000016")];
    const p = planJobOpeningBackfill(jobs, targets, OPTS);
    expect(p.warnings).toEqual({
      mailAfterService: ["CT26-0000014"],
      serviceBeforeStart: ["CT26-0000015"],
      serviceAfterEnd: ["CT26-0000016"],
      futureDate: [],
    });
    expect(p.updates).toHaveLength(3);
    const strict = planJobOpeningBackfill(jobs, targets, { ...OPTS, skipWarned: true });
    expect(strict.updates).toHaveLength(0);
    expect(strict.counts.skippedWarned).toBe(3);
  });

  it("วันที่ที่จะเติมเลยวันนี้ (asOf) = เตือน futureDate · ไม่ส่ง asOf = ไม่ตรวจ", () => {
    const jobs = index([job("CT26-0000024", "2026-12-01", null, null), job("CT26-0000025", "2026-11-01", null, null)]);
    const targets = [target("CT26-0000024"), target("CT26-0000025")];
    expect(planJobOpeningBackfill(jobs, targets, { ...OPTS, asOf: "2026-11-28" }).warnings.futureDate).toEqual(["CT26-0000024"]);
    expect(planJobOpeningBackfill(jobs, targets, OPTS).warnings.futureDate).toEqual([]);
  });

  it("ผลกระทบงานขาย: Renew ที่ Mail > 15 = ล่าช้า · ยอดย้ายจากเดือนวันเริ่มไปเดือน Mail", () => {
    const p = planJobOpeningBackfill(
      index([
        job("CT26-0000017", "2026-09-20", null, null),
        job("CT26-0000018", "2026-10-15", null, null),
        job("CT26-0000019", "2026-09-25", null, null),
      ]),
      [
        target("CT26-0000017", { saleType: "renew" }),
        target("CT26-0000018", { saleType: "renew" }),
        target("CT26-0000019", { saleType: null }),
      ],
      OPTS,
    );
    expect(p.salesImpact.lateRenewals).toBe(1);
    expect(p.salesImpact.monthChanged).toBe(2);
    // ไม่มีประเภทขาย → ไม่อยู่ในยอดงานขายอยู่แล้ว (ไม่นับย้ายเดือน)
    expect(p.salesImpact.byMonth).toEqual({ "2026-10": { out: 1, in: 0 }, "2026-09": { out: 0, in: 1 } });
  });

  it("เลขที่ไม่เจอเป้าหมาย / เป้าหมายที่ไม่มีในไฟล์ (แยกเดือนวันเริ่ม) · จับคู่หลังล้างเลข", () => {
    const p = planJobOpeningBackfill(
      index([job("CT26-0000020", "2026-10-01", null, null), job("CT26-0000099", "2026-10-01", null, null)]),
      [target(" ct26-0000020"), target("CT26-0000021", { startDate: "2026-10-15" }), target("CT25-0000022", { startDate: "2025-03-01" })],
      OPTS,
    );
    expect(p.counts.matched).toBe(1);
    expect(p.jobsWithoutTarget).toEqual(["CT26-0000099"]);
    expect(p.targetsWithoutJobByStartMonth).toEqual({ "2026-10": 1, "2025-03": 1 });
    expect(p.targetsByStartMonth).toEqual({ "2026-10": 2, "2025-03": 1 });
  });

  it("เลขซ้ำในเป้าหมาย = หยุด", () => {
    expect(() => planJobOpeningBackfill(index([]), [target("CT26-0000023"), target("CT26-0000023")], OPTS)).toThrow(/ซ้ำ/);
  });
});

describe("targetsFromPlan / registryNotImportedFromPlan / classifyNotFound", () => {
  const plan = {
    month: "2026-10",
    importBatch: BATCH,
    totals: { contracts: 1, held: 0, mustFix: 1, excluded: 1, withAddress: 0 },
    branches: [
      {
        branch: "สาทร",
        contracts: [{ contractNo: "CT26-0000030", startDate: "2026-01-05", endDate: "2027-01-04", saleType: "renew", status: "active" }],
        mustFixRows: [8],
        heldRows: [],
        excludedRows: [{ excelRow: 9, contractNo: "CT26-0000032", reason: "สมมติ" }],
      },
    ],
  } as unknown as RegistryImportPlan;

  it("แผน → เป้าหมาย (3 ช่องว่าง · batch ของแผน)", () => {
    expect(targetsFromPlan(plan)).toEqual([
      {
        id: null,
        contractNo: "CT26-0000030",
        importBatch: BATCH,
        status: "active",
        startDate: "2026-01-05",
        endDate: "2027-01-04",
        saleType: "renew",
        mail: null,
        serviceDate: null,
        serviceTime: null,
      },
    ]);
  });

  it("แถวกรอกมือ / ตัดออก → เลขสัญญาจากแถว Excel", () => {
    const m = registryNotImportedFromPlan(
      plan,
      new Map([
        [
          "สาทร",
          [
            { excelRow: 7, rawContractNo: "CT26-0000030" },
            { excelRow: 8, rawContractNo: "ct26-0000031" },
            { excelRow: 9, rawContractNo: "CT26-0000032" },
          ],
        ],
      ]),
    );
    expect([...m]).toEqual([
      ["CT26-0000031", "registryManualEntry"],
      ["CT26-0000032", "registryExcluded"],
    ]);
  });

  it("สาเหตุไม่พบ: ทะเบียนไม่นำเข้า > กรุ๊ป > สาขาอ่านไม่ออก > ต่างจังหวัด > นอก 24 สาขา > ไม่มีในไฟล์ทะเบียน", () => {
    const ctx = {
      centralBranches: new Set(["สาทร"]),
      registryNotImported: new Map([["CT26-0000031", "registryManualEntry" as const]]),
    };
    expect(classifyNotFound(job("CT26-0000031", null, null, null), ctx)).toBe("registryManualEntry");
    expect(classifyNotFound(job("CT26-0000040", null, null, null, { branchText: "งานกรุ๊ป" }), ctx)).toBe("groupBranch");
    expect(classifyNotFound(job("CT26-0000041", null, null, null, { branchText: "ฝ่ายกรุ๊ป / ประชาชื่น" }), ctx)).toBe("groupBranch");
    expect(classifyNotFound(job("CT26-0000042", null, null, null, { branchText: "ไม่รู้จัก" }), ctx)).toBe("unknownBranch");
    expect(classifyNotFound(job("CT26-0000043", null, null, null, { branchText: "เชียงใหม่" }), ctx)).toBe("provincialBranch");
    expect(classifyNotFound(job("CT26-0000044", null, null, null, { branchText: "พระราม 4" }), ctx)).toBe("notCentralBranch");
    expect(classifyNotFound(job("CT26-0000045", null, null, null), ctx)).toBe("absentFromRegistry");
  });
});
