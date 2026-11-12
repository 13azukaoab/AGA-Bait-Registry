"use client";

/**
 * StationSetup — ตั้งสถานีครั้งแรกของสัญญา (ครั้งเดียว) ก่อนบันทึกผลบริการ (SPEC v1.8 §8.1 · DECISIONS 2.19)
 *
 *   * ลูกค้าใหม่: กรอกจำนวน IG / IC → ระบบสร้างเลข 1..n ให้ตอนบันทึก
 *   * Renew: แสดงสถานีที่ยังใช้งานของสัญญาเก่า "ติ๊กย้ายไว้ให้ทั้งหมด" ผู้ใช้ติ๊กออกได้ + เพิ่มสถานีใหม่ได้
 *     (สถานีที่ย้ายใช้เลขเดิม · เลขใหม่ต่อจากเลขสูงสุดของชนิดนั้น · AG ย้ายได้ จุดต่อจุด)
 *     สถานีที่ไม่ย้ายค้างที่สัญญาเก่า (เข้ารายการรอเก็บสถานี) — ประวัติผลบริการของสัญญาเก่าเปิดดูได้เสมอ
 */
import { cx } from "@/components/ui/cx";

import { INPUT, INVALID, LABEL, SECTION, SECTION_TITLE, STATION_TYPE_TAG } from "./styles";
import { describeNumbers } from "./stationIndex";
import type { InitPlan } from "./setup";
import type { SetupState, StationRow } from "./types";

export function StationSetup({
  isRenew,
  oldStations,
  setup,
  plan,
  showIssues,
  onChange,
}: {
  isRenew: boolean;
  oldStations: readonly StationRow[];
  setup: SetupState;
  plan: InitPlan;
  showIssues: boolean;
  onChange: (next: SetupState) => void;
}) {
  const bad = showIssues && plan.errors.length > 0;
  const excluded = new Set(setup.excludedOldIds);

  const toggle = (id: string) =>
    onChange({
      ...setup,
      excludedOldIds: excluded.has(id) ? setup.excludedOldIds.filter((x) => x !== id) : [...setup.excludedOldIds, id],
    });

  const ofType = (type: "IG" | "IC" | "AG") => oldStations.filter((s) => s.type === type);
  const setAll = (type: "IG" | "IC" | "AG", keep: boolean) => {
    const ids = new Set(ofType(type).map((s) => s.id));
    const rest = setup.excludedOldIds.filter((x) => !ids.has(x));
    onChange({ ...setup, excludedOldIds: keep ? rest : [...rest, ...ids] });
  };

  return (
    <section
      data-field="setup"
      aria-label="ระบุจำนวนสถานีครั้งแรก"
      className={cx(SECTION, "border-warn bg-warn-soft")}
    >
      <h3 className={SECTION_TITLE}>
        {isRenew ? "สัญญาต่ออายุ (Renew) — ตั้งสถานีครั้งแรก" : "ลูกค้าใหม่ — ยังไม่มีจำนวนสถานี"}
      </h3>
      <p className="m-0 mt-0.5 text-[12px] text-fg-muted">
        {isRenew
          ? "ระบบเสนอย้ายสถานีที่ยังใช้งานจากสัญญาเก่ามาให้ (ใช้เลขเดิม · เลขรอบกล่อง AG นับต่อ) ติ๊กออกได้ และเพิ่มสถานีใหม่ได้ · ทำครั้งเดียวต่อสัญญา"
          : "ระบุจำนวนที่ติดตั้งจริง (บังคับครั้งแรกครั้งเดียว) ระบบสร้างเลขสถานี 1..n แยกชนิดให้ตอนบันทึก"}
      </p>

      {isRenew ? (
        <div className="mt-2.5 flex flex-col gap-3">
          {oldStations.length === 0 ? (
            <p className="m-0 text-[12.5px] text-fg-muted">สัญญาเก่าไม่มีสถานีที่ยังใช้งาน — ระบุสถานีใหม่ด้านล่าง</p>
          ) : null}
          {(["IG", "IC"] as const).map((type) => {
            const list = ofType(type);
            if (list.length === 0) return null;
            const moved = list.filter((s) => !excluded.has(s.id));
            return (
              <div key={type} className="rounded-lg border border-border bg-surface p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className={STATION_TYPE_TAG}>{type}</span>
                  <b className="num">
                    ย้าย {moved.length} / {list.length} สถานี
                  </b>
                  <span className="text-[12px] text-fg-muted num">เลข {describeNumbers(moved.map((s) => s.no ?? 0))}</span>
                  <button type="button" onClick={() => setAll(type, true)} className="ml-auto cursor-pointer text-[12px] text-accent underline">
                    ย้ายทั้งหมด
                  </button>
                  <button type="button" onClick={() => setAll(type, false)} className="cursor-pointer text-[12px] text-accent underline">
                    ไม่ย้ายเลย
                  </button>
                </div>
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[12px] text-fg-muted">เลือกรายสถานี (ติ๊กออกสถานีที่ไม่ย้าย)</summary>
                  <div className="mt-1.5 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                    {list.map((s) => (
                      <label
                        key={s.id}
                        className={cx(
                          "flex cursor-pointer items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[12px] num",
                          excluded.has(s.id) ? "bg-surface-2 text-fg-faint line-through" : "bg-surface",
                        )}
                      >
                        <input type="checkbox" checked={!excluded.has(s.id)} onChange={() => toggle(s.id)} />
                        {s.no}
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            );
          })}
          {ofType("AG").length > 0 ? (
            <div className="rounded-lg border border-border bg-surface p-2.5">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className={STATION_TYPE_TAG}>AG</span>
                <b>กล่องเหยื่อที่ยังใช้งาน ({ofType("AG").length} จุด)</b>
                <button type="button" onClick={() => setAll("AG", true)} className="ml-auto cursor-pointer text-[12px] text-accent underline">
                  ย้ายทั้งหมด
                </button>
                <button type="button" onClick={() => setAll("AG", false)} className="cursor-pointer text-[12px] text-accent underline">
                  ไม่ย้ายเลย
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {ofType("AG").map((s) => (
                  <label
                    key={s.id}
                    className={cx(
                      "flex cursor-pointer items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[12px]",
                      excluded.has(s.id) ? "bg-surface-2 text-fg-faint line-through" : "bg-surface",
                    )}
                  >
                    <input type="checkbox" checked={!excluded.has(s.id)} onChange={() => toggle(s.id)} />
                    จุดที่ {s.no}
                    {s.pointLabel ? <span className="text-fg-muted">· {s.pointLabel}</span> : null}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
            <CountField label="เพิ่ม IG ใหม่ (จำนวน)" id="sv-extra-ig" value={setup.extraIg} invalid={bad} onChange={(v) => onChange({ ...setup, extraIg: v })} />
            <CountField label="เพิ่ม IC ใหม่ (จำนวน)" id="sv-extra-ic" value={setup.extraIc} invalid={bad} onChange={(v) => onChange({ ...setup, extraIc: v })} />
          </div>
        </div>
      ) : (
        <div className="mt-2.5 grid grid-cols-2 gap-3 sm:max-w-sm">
          <CountField label="IG (จำนวน)" id="sv-ig" value={setup.igCount} invalid={bad} onChange={(v) => onChange({ ...setup, igCount: v })} />
          <CountField label="IC (จำนวน)" id="sv-ic" value={setup.icCount} invalid={bad} onChange={(v) => onChange({ ...setup, icCount: v })} />
        </div>
      )}

      <p className="m-0 mt-2 text-[12px] text-fg-muted num">
        หลังบันทึก สัญญานี้จะมีสถานีที่ใช้งาน: IG {plan.index.IG.size} · IC {plan.index.IC.size} · AG {plan.index.AG.size}
      </p>
      {bad ? (
        <ul className="m-0 mt-1 list-disc pl-5 text-[12px] text-danger">
          {plan.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CountField({
  label,
  id,
  value,
  invalid,
  onChange,
}: {
  label: string;
  id: string;
  value: string;
  invalid: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        max={500}
        inputMode="numeric"
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(INPUT, "num", invalid && INVALID)}
      />
    </div>
  );
}
