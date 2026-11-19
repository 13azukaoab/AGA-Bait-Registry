"use client";

/**
 * หน้า "ประวัติการแก้ไข" ฝั่ง client (SPEC §8.2 · หน้า 15 · mockup FINAL docs/mockup/history-log.html)
 *
 * Logic summary:
 *   * host เท่านั้น (page.tsx ตรวจฝั่ง server แล้ว · RLS ของ audit_log ตัดสินที่ฐานข้อมูลอีกชั้น)
 *   * ตัวกรองเปลี่ยน → โหลดหน้าแรกใหม่ทันที (keyset 50 แถว) · "โหลดเพิ่ม" ใช้ cursor ของแถวสุดท้าย · มี request id กันผลเก่าทับผลใหม่
 *   * ค่าเริ่มต้น "เฉพาะการเปลี่ยนแปลง" (จาก audit_log) · "รวมการกรอกปกติ" เพิ่มแถวกลุ่มต่อคนต่อวันจากตาราง visits
 *   * มุมมอง ตาราง/ไทม์ไลน์ ใช้ข้อมูลชุดเดียวกัน · จอ ≤600px เริ่มที่ไทม์ไลน์ (ถ้าผู้ใช้ยังไม่ได้เลือกเอง)
 *   * URL เก็บตัวกรองเฉพาะ id / enum / วันที่ (ไม่มีข้อความอิสระ) ด้วย history.replaceState (ไม่โหลดหน้าใหม่)
 *   * ส่งออก CSV: วนโหลดครบทุกหน้าตามตัวกรองปัจจุบัน (สูงสุด MAX_EXPORT_ROWS) แล้วสร้างไฟล์ในเครื่อง
 *   * ⚠ PDPA: ไม่ log ข้อมูลลง console · ข้อผิดพลาดแสดงเป็นข้อความทั่วไป (ไม่โชว์ข้อความดิบจากฐานข้อมูล)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, Button, cx } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

import { HistoryFilterBar } from "./HistoryFilterBar";
import { HistoryIcon } from "./HistoryIcons";
import { HistoryList } from "./HistoryList";
import { isPostCloseEdit } from "./historyClosure";
import {
  fetchAuditPage,
  fetchVisitDetails,
  fetchVisitStamps,
  findContractByNo,
  loadContractInfos,
  MAX_EXPORT_ROWS,
} from "./historyData";
import { buildCsv, downloadCsv, exportFileName, type ExportCtx } from "./historyExport";
import { defaultFilters, filtersToParams, normalizeFilters } from "./historyFilters";
import { groupVisits, mergeEntries } from "./historyGroups";
import type { AuditRow, ContractInfo, DisplayMode, HistoryFilters, HistoryRefs, ViewMode, VisitGroupEntry } from "./historyTypes";
import type { Cursor } from "./historyQuery";

export interface HistoryClientProps {
  refs: HistoryRefs;
  todayYmd: string;
  initialFilters: HistoryFilters;
  initialContract: ContractInfo | null;
}

const ERROR_TEXT = "โหลดประวัติไม่สำเร็จ ลองใหม่อีกครั้ง หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ";

function Seg({ pressed, onClick, children, title }: { pressed: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={cx(
        "min-h-8 rounded-[7px] px-3 py-1.5 text-[12.5px] max-[767px]:min-h-11",
        pressed ? "bg-accent font-semibold text-accent-fg" : "bg-transparent text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function HistoryClient({ refs, todayYmd, initialFilters, initialContract }: HistoryClientProps) {
  const supabase = useMemo(() => createClient(), []);
  const [filters, setFiltersState] = useState<HistoryFilters>(() => normalizeFilters(initialFilters, todayYmd).filters);
  const [clamped, setClamped] = useState(() => normalizeFilters(initialFilters, todayYmd).clamped);
  const [mode, setMode] = useState<DisplayMode>("changes");
  const [view, setView] = useState<ViewMode>("table");
  const userPickedView = useRef(false);

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [next, setNext] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const [groups, setGroups] = useState<VisitGroupEntry[]>([]);
  const [groupsTruncated, setGroupsTruncated] = useState(false);
  const [groupsError, setGroupsError] = useState(false);

  const [contracts, setContracts] = useState<Map<string, ContractInfo>>(() => new Map(initialContract ? [[initialContract.id, initialContract]] : []));
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ tone: "ok" | "warn" | "danger"; text: string } | null>(null);
  const reqId = useRef(0);

  const setFilters = useCallback(
    (next: HistoryFilters) => {
      const r = normalizeFilters(next, todayYmd);
      setClamped(r.clamped);
      setFiltersState(r.filters);
      setOpenKeys(new Set());
    },
    [todayYmd],
  );

  // จอเล็กเริ่มที่ไทม์ไลน์ (ตารางกว้างเกินจอ) — ถ้าผู้ใช้เลือกมุมมองเองแล้วไม่สลับให้
  useEffect(() => {
    const mq = window.matchMedia("(max-width:600px)");
    const apply = () => {
      if (!userPickedView.current) setView(mq.matches ? "timeline" : "table");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // URL ตามตัวกรอง (เฉพาะ id/enum/วันที่)
  useEffect(() => {
    const qs = filtersToParams(filters, todayYmd).toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [filters, todayYmd]);

  const ensureContracts = useCallback(
    async (list: readonly AuditRow[]) => {
      const need = list.map((r) => r.contractId).filter((id): id is string => !!id && !contracts.has(id));
      if (need.length === 0) return;
      const r = await loadContractInfos(supabase, need);
      if (!r.ok) return; // ชื่อลูกค้าไม่สำคัญพอจะทำให้หน้าล้ม — แสดงเฉพาะสาขา
      setContracts((prev) => {
        const m = new Map(prev);
        for (const c of r.data) m.set(c.id, c);
        return m;
      });
    },
    [supabase, contracts],
  );

  // โหลดหน้าแรกใหม่เมื่อตัวกรองเปลี่ยน
  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    setError(false);
    setRows([]);
    setNext(null);
    void (async () => {
      const r = await fetchAuditPage(supabase, filters, refs, null);
      if (id !== reqId.current) return;
      if (!r.ok) {
        setError(true);
      } else {
        setRows(r.data.rows);
        setNext(r.data.next);
        void ensureContracts(r.data.rows);
      }
      setLoading(false);
    })();
    // ensureContracts เปลี่ยนตาม contracts — ไม่ใส่ใน deps เพื่อไม่ให้โหลดซ้ำเมื่อชื่อสัญญามาถึง
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, supabase, refs]);

  // กลุ่มการกรอกปกติ (เฉพาะเมื่อเปิดโหมด "รวมการกรอกปกติ")
  useEffect(() => {
    if (mode !== "all") {
      setGroups([]);
      setGroupsTruncated(false);
      setGroupsError(false);
      return;
    }
    let alive = true;
    setGroupsError(false);
    void (async () => {
      const r = await fetchVisitStamps(supabase, filters, refs);
      if (!alive) return;
      if (!r.ok) {
        setGroupsError(true);
        setGroups([]);
        return;
      }
      setGroups(groupVisits(r.data.stamps));
      setGroupsTruncated(r.data.truncated);
    })();
    return () => {
      alive = false;
    };
  }, [mode, filters, supabase, refs]);

  async function loadMore() {
    if (!next || loadingMore) return;
    const id = reqId.current;
    setLoadingMore(true);
    const r = await fetchAuditPage(supabase, filters, refs, next);
    if (id !== reqId.current) return;
    setLoadingMore(false);
    if (!r.ok) {
      setError(true);
      return;
    }
    setRows((prev) => [...prev, ...r.data.rows]);
    setNext(r.data.next);
    void ensureContracts(r.data.rows);
  }

  // ----- ตัวช่วยค้นหาชื่อ -----
  const makeLookup = useCallback(
    (contractMap: ReadonlyMap<string, ContractInfo>): ExportCtx => {
      const branch = new Map(refs.branches.map((b) => [b.id, b.name]));
      const person = new Map(refs.people.map((p) => [p.userId, p.displayName]));
      const pos = new Map(refs.positions.map((p) => [p.code, p.label]));
      return {
        branchName: (id) => branch.get(id) ?? null,
        personName: (id) => person.get(id) ?? null,
        positionLabel: (code) => (code ? (pos.get(code) ?? "") : ""),
        contract: (id) => (id ? (contractMap.get(id) ?? null) : null),
        isPostClose: (row) => isPostCloseEdit(row, refs.branches, refs.closures),
      };
    },
    [refs],
  );
  const lookup = useMemo(() => makeLookup(contracts), [makeLookup, contracts]);

  const entries = useMemo(() => mergeEntries(rows, mode === "all" ? groups : [], next !== null), [rows, groups, mode, next]);

  const counts = useMemo(() => {
    let upd = 0;
    let del = 0;
    let ins = 0;
    let post = 0;
    for (const r of rows) {
      if (r.action === "update") upd++;
      else if (r.action === "delete") del++;
      else ins++;
      if (lookup.isPostClose(r)) post++;
    }
    return { upd, del, ins, post };
  }, [rows, lookup]);
  const groupVisitsTotal = groups.reduce((s, g) => s + g.count, 0);

  const loadGroupDetails = useCallback(
    async (ids: readonly string[]) => {
      const r = await fetchVisitDetails(supabase, ids);
      return r.ok ? r.data : null;
    },
    [supabase],
  );

  async function findContract(no: string): Promise<"ok" | "notfound" | "error"> {
    const r = await findContractByNo(supabase, no);
    if (!r.ok) return "error";
    if (!r.data) return "notfound";
    const c = r.data;
    setContracts((prev) => new Map(prev).set(c.id, c));
    setFilters({ ...filters, contractId: c.id });
    return "ok";
  }

  async function doExport() {
    if (exporting) return;
    setExporting(true);
    setExportMsg(null);
    try {
      const all: AuditRow[] = [];
      let cursor: Cursor | null = null;
      let capped = false;
      for (;;) {
        const r = await fetchAuditPage(supabase, filters, refs, cursor);
        if (!r.ok) throw new Error("export");
        all.push(...r.data.rows);
        if (!r.data.next) break;
        if (all.length >= MAX_EXPORT_ROWS) {
          capped = true;
          break;
        }
        cursor = r.data.next;
      }
      let exportGroups: VisitGroupEntry[] = [];
      let groupsCapped = false;
      if (mode === "all") {
        const g = await fetchVisitStamps(supabase, filters, refs);
        if (!g.ok) throw new Error("export");
        exportGroups = groupVisits(g.data.stamps);
        groupsCapped = g.data.truncated;
      }
      const map = new Map(contracts);
      const need = all.map((r) => r.contractId).filter((id): id is string => !!id && !map.has(id));
      if (need.length) {
        const c = await loadContractInfos(supabase, need);
        if (c.ok) for (const i of c.data) map.set(i.id, i);
      }
      const csv = buildCsv(mergeEntries(all, exportGroups, capped), makeLookup(map), () => "");
      downloadCsv(csv, exportFileName(filters.from, filters.to));
      const total = all.length + exportGroups.length;
      setExportMsg(
        capped || groupsCapped
          ? { tone: "warn", text: `ส่งออกแล้ว ${total.toLocaleString("en-US")} แถว — ข้อมูลมากกว่านี้ ระบบตัดที่ส่วนที่ใหม่ที่สุด ลดช่วงวันที่หรือเพิ่มตัวกรองแล้วส่งออกอีกครั้งเพื่อให้ครบ` }
          : { tone: "ok", text: `ส่งออกแล้ว ${total.toLocaleString("en-US")} แถว (ตามตัวกรองที่เลือกอยู่)` },
      );
    } catch {
      setExportMsg({ tone: "danger", text: "ส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง" });
    } finally {
      setExporting(false);
    }
  }

  const toggle = useCallback((key: string) => {
    setOpenKeys((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }, []);

  const reset = () => setFilters(defaultFilters(todayYmd));
  const contractLabel = filters.contractId ? (contracts.get(filters.contractId)?.contractNo ?? null) : null;

  return (
    <div>
      <header>
        <h1 className="m-0 text-xl font-semibold">ประวัติการแก้ไข</h1>
        <p className="m-0 mt-1 text-[13px] text-fg-muted">
          ดูว่า <b className="text-fg">ใคร แก้ / ลบ / เพิ่ม อะไร เมื่อไหร่</b> — มาจากบันทึกการแก้ไขของระบบ · เฉพาะ host (PM/OM)
        </p>
      </header>

      <div className="mt-4 flex flex-wrap gap-2" aria-live="polite">
        <button
          type="button"
          aria-pressed={filters.postCloseOnly}
          onClick={() => setFilters({ ...filters, postCloseOnly: !filters.postCloseOnly })}
          title="รายการที่ผู้บริหารต้องตามมากที่สุด — กดเพื่อกรองเฉพาะที่แก้ข้อมูลของเดือนที่ปิดแล้ว"
          className={cx(
            "flex min-h-11 max-w-full items-center gap-2.5 rounded-xl border-[1.5px] border-warn bg-warn-soft px-3.5 py-1.5 text-left text-fg hover:brightness-[.97]",
            filters.postCloseOnly && "shadow-[0_0_0_3px_var(--warn)]",
          )}
        >
          <HistoryIcon name="lock" className="text-lg text-warn" />
          <span>
            <b className="block text-[13.5px]">แก้หลังปิดเดือน ({counts.post} ในรายการที่โหลดแล้ว)</b>
            <small className="block text-xs font-normal text-fg-muted">Dashboard ยังเป็นค่าเดิม จนกว่าจะสั่งคำนวณ snapshot ใหม่</small>
          </span>
          {filters.postCloseOnly && <span className="rounded-full border border-warn bg-surface px-2 py-0.5 text-xs font-semibold">ยกเลิกกรอง</span>}
        </button>
        <span className="inline-flex items-center rounded-full bg-accent-soft px-3 py-1 text-[12.5px] text-accent-strong">แก้ {counts.upd}</span>
        <span className="inline-flex items-center rounded-full bg-danger-soft px-3 py-1 text-[12.5px] text-danger">ลบ {counts.del}</span>
        <span className="inline-flex items-center rounded-full bg-ok-soft px-3 py-1 text-[12.5px] text-ok">เพิ่ม/ไฟล์ {counts.ins}</span>
        {mode === "all" && (
          <span className="inline-flex items-center rounded-full bg-surface-3 px-3 py-1 text-[12.5px] text-fg-muted" title="การกรอกผลบริการรวมเป็นกลุ่มต่อคนต่อวัน">
            กรอกปกติ {groupVisitsTotal} รายการ → {groups.length} กลุ่ม
          </span>
        )}
      </div>

      <div role="note" className="mt-3.5 flex items-start gap-2 rounded-xl border border-accent bg-accent-soft px-3.5 py-2.5 text-[12.5px]">
        <HistoryIcon name="info" className="mt-0.5 text-accent-strong" />
        <div>
          <b>“วันที่แก้” ไม่เท่ากับ “เดือนของข้อมูล”</b>
          <div className="text-xs text-fg-muted">
            <b>วันที่แก้</b> = วันที่มีคนกดบันทึก (คอลัมน์ “เวลา”) · <b>เดือนของข้อมูล</b> = เดือนบริการที่ข้อมูลนั้นสังกัด (ใต้คอลัมน์ “ข้อมูล”) · แก้เมื่อ 9 พ.ย. แต่เป็นผลบริการของเดือน ต.ค. ที่ปิดแล้ว →
            ขึ้นป้าย “แก้หลังปิดเดือน”
          </div>
        </div>
      </div>

      <section aria-label="รายการประวัติ" className="mt-4 overflow-hidden rounded-card border border-border bg-surface shadow-[var(--shadow)]">
        <HistoryFilterBar
          filters={filters}
          refs={refs}
          todayYmd={todayYmd}
          contractLabel={contractLabel}
          rangeClamped={clamped}
          onChange={setFilters}
          onFindContract={findContract}
          onReset={reset}
        />

        <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-2.5">
          <div role="group" aria-label="เลือกว่าจะแสดงอะไร" className="inline-flex flex-wrap gap-0.5 rounded-[10px] border border-border bg-surface-2 p-[3px]">
            <Seg pressed={mode === "changes"} onClick={() => setMode("changes")} title="แก้ / ลบ / ไฟล์ / ปิดเดือน / Port — ไม่รวมการกรอกผลบริการปกติ">
              เฉพาะการเปลี่ยนแปลง (ค่าเริ่มต้น)
            </Seg>
            <Seg pressed={mode === "all"} onClick={() => setMode("all")} title="เพิ่มแถวรวม “กรอกผลบริการ n รายการ” ของแต่ละคนแต่ละวัน — กางดูทีละรายได้">
              รวมการกรอกปกติ (จัดเป็นกลุ่ม)
            </Seg>
          </div>
          <div role="group" aria-label="เลือกมุมมอง" className="inline-flex gap-0.5 rounded-[10px] border border-border bg-surface-2 p-[3px]">
            <Seg
              pressed={view === "table"}
              onClick={() => {
                userPickedView.current = true;
                setView("table");
              }}
            >
              ตาราง
            </Seg>
            <Seg
              pressed={view === "timeline"}
              onClick={() => {
                userPickedView.current = true;
                setView("timeline");
              }}
            >
              ไทม์ไลน์
            </Seg>
          </div>
          <span className="flex-1" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void doExport()}
            loading={exporting}
            disabled={loading || rows.length === 0}
            title="ส่งออกทุกรายการที่ตรงตัวกรอง (ไม่จำกัดจำนวนที่แสดง) เป็นไฟล์ CSV เปิดด้วย Excel ได้"
            className="max-[767px]:min-h-11"
          >
            <span className="inline-flex items-center gap-1.5">
              <HistoryIcon name="download" />
              ส่งออก (CSV สำหรับ Excel)
            </span>
          </Button>
        </div>

        {exportMsg && (
          <div className="border-b border-border px-4 py-2.5">
            <Alert variant={exportMsg.tone === "ok" ? "ok" : exportMsg.tone === "warn" ? "warn" : "danger"}>{exportMsg.text}</Alert>
          </div>
        )}
        {groupsError && mode === "all" && (
          <div className="border-b border-border px-4 py-2.5">
            <Alert variant="warn">โหลดกลุ่มการกรอกปกติไม่สำเร็จ — รายการด้านล่างแสดงเฉพาะการเปลี่ยนแปลง ลองสลับโหมดใหม่อีกครั้ง</Alert>
          </div>
        )}
        {groupsTruncated && mode === "all" && (
          <div className="border-b border-border px-4 py-2.5">
            <Alert variant="warn">การกรอกปกติในช่วงนี้มากเกินกว่าจะรวมได้ครบ — กลุ่มที่แสดงเป็นส่วนที่ใหม่ที่สุด ลดช่วงวันที่เพื่อดูให้ครบ</Alert>
          </div>
        )}

        {error ? (
          <div className="px-4 py-6">
            <Alert variant="danger" title="โหลดประวัติไม่สำเร็จ">
              {ERROR_TEXT}
            </Alert>
          </div>
        ) : loading ? (
          <div role="status" className="px-4 py-10 text-center text-[13px] text-fg-muted">กำลังโหลดประวัติ…</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-fg-muted">
            ไม่พบรายการที่ตรงกับตัวกรอง{" "}
            <Button variant="secondary" size="sm" onClick={reset} className="ml-2 max-[767px]:min-h-11">
              ล้างตัวกรอง
            </Button>
          </div>
        ) : (
          <HistoryList entries={entries} view={view} lookup={lookup} openKeys={openKeys} onToggle={toggle} loadGroupDetails={loadGroupDetails} />
        )}

        {!error && !loading && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3 text-xs text-fg-muted">
            <span>
              แสดง <b className="text-fg">{entries.length}</b> รายการ{next ? " · ยังมีรายการเก่ากว่านี้" : " · ครบทุกรายการที่ตรงตัวกรองแล้ว"}
            </span>
            {next && (
              <Button variant="secondary" size="sm" onClick={() => void loadMore()} loading={loadingMore} className="max-[767px]:min-h-11">
                โหลดเพิ่ม
              </Button>
            )}
          </div>
        )}
      </section>

      <p className="mt-3 text-xs text-fg-muted">
        รายการโหลดทีละ 50 · ค่าเริ่มต้นไม่รวมการกรอกผลบริการปกติ เพราะหัวหน้างานกรอกวันละหลายสิบถึงร้อยราย — ดูได้ที่ปุ่ม “รวมการกรอกปกติ” (รวมเป็น 1 แถวต่อคนต่อวัน)
      </p>
    </div>
  );
}
