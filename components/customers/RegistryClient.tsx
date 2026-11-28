"use client";

/**
 * หน้า "ทะเบียนลูกค้า/สัญญา" ฝั่ง client (SPEC §8 จอ 3 · mockup FINAL `#registry`)
 *
 * Logic summary:
 *   * อ่านอย่างเดียว (ดูและตรวจความถูกต้อง) — กรอก/แก้ผลบริการไปที่เมนูลงข้อมูลบริการ · เปิดงานใหม่ที่ /customers/new
 *   * server ส่งหน้าแรก + ข้อมูลอ้างอิงมาให้ · ตัวกรองเปลี่ยน/พิมพ์ค้นหา (หน่วง 350ms) → โหลดหน้าแรกใหม่ · "โหลดเพิ่ม" → ต่อ keyset
 *   * ตอบกลับช้ากว่าคำขอใหม่ถูกทิ้ง (reqId) กันผลเก่าทับผลใหม่
 *   * ตัวกรองฝั่งหน้า (Tier/สถานะ) → โหลดหน้าถัดไปต่อเองทีละหน้าจนตรวจครบ (registryAutoLoad.ts) · เพดาน AUTO_LOAD_CAP แล้วหยุดให้กดต่อเอง ·
 *     error หยุด + ปุ่ม "ลองใหม่" · cursor ใช้ได้เฉพาะเมื่อ loadedKey ตรงกับตัวกรองปัจจุบัน (กันใช้ cursor เก่ากับตัวกรองใหม่)
 *   * URL เก็บเฉพาะ id/enum (replaceState) — คำค้นไม่อยู่ใน URL (PDPA)
 *   * จำนวน: ไม่มีกรอง Tier/สถานะ → "แสดง n จาก N สัญญา" · มีกรองซ้ำ → "ตรวจแล้ว x จาก N สัญญาที่ตรงตัวกรองอื่น" + บอกเมื่อครบ
 *   * ส่งออก CSV = ตัวกรอง/ลำดับ/คำค้นเดียวกับที่เห็น สูงสุด MAX_EXPORT_ROWS แถว (เกินแล้วแจ้ง ไม่ตัดเงียบ)
 *   * ⚠ PDPA: ไม่ console.log ข้อมูล · error แสดงเป็นข้อความไทย + code
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, Button, cx, TierBadge } from "@/components/ui";
import type { UserRole } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/client";

import { AUTO_LOAD_CAP, capText, decideAutoLoad, progressText } from "./registryAutoLoad";
import { RegistryFilterBar } from "./RegistryFilterBar";
import { RegistryList } from "./RegistryList";
import { registryCsv, registryFileName } from "./registryExport";
import { defaultFilters, filtersToParams, needsPostFilter, sanitizeSearch } from "./registryFilters";
import { loadRegistryForExport, loadRegistryPage, MAX_EXPORT_ROWS, MAX_SEARCH_CUSTOMERS, todayBangkok, type PageData, type RegistryRefs } from "./registryData";
import { tierLegend } from "./registryStatus";
import type { Cursor, RegistryFilters, RegistryRow } from "./registryTypes";

export interface RegistryInitial {
  rows: RegistryRow[];
  next: Cursor | null;
  scanned: number;
  dbTotal: number | null;
}

interface Props {
  role: UserRole;
  today: string;
  refs: RegistryRefs;
  initialFilters: RegistryFilters;
  initial: RegistryInitial;
}

const fmtN = (n: number) => n.toLocaleString("en-US");
/** กุญแจของ "ชุดตัวกรอง + คำค้น" — ไว้เช็กว่า cursor ที่ถืออยู่เป็นของตัวกรองปัจจุบัน */
const queryKey = (f: RegistryFilters, search: string) => `${filtersToParams(f).toString()}|${search}`;

export function RegistryClient({ role, today, refs, initialFilters, initial }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [filters, setFilters] = useState<RegistryFilters>(initialFilters);
  const [searchText, setSearchText] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [rows, setRows] = useState<RegistryRow[]>(initial.rows);
  const [next, setNext] = useState<Cursor | null>(initial.next);
  const [scanned, setScanned] = useState(initial.scanned);
  const [dbTotal, setDbTotal] = useState<number | null>(initial.dbTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tooBroad, setTooBroad] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState(() => queryKey(initialFilters, ""));
  const [autoLimit, setAutoLimit] = useState(AUTO_LOAD_CAP);
  const [reloadTick, setReloadTick] = useState(0);
  const reqId = useRef(0);
  const inflight = useRef<number | null>(null);
  const firstRun = useRef(true);

  const ctx = useMemo(() => ({ refs, today }), [refs, today]);

  // หน่วงคำค้น 350ms แล้วค่อยโหลดใหม่
  useEffect(() => {
    const t = setTimeout(() => setAppliedSearch(sanitizeSearch(searchText)), 350);
    return () => clearTimeout(t);
  }, [searchText]);

  // URL ตามตัวกรอง (เฉพาะ id/enum)
  useEffect(() => {
    // ไม่แตะ URL ถ้าผู้ใช้เริ่มเปลี่ยนไปหน้าอื่นแล้ว (กัน effect ดึง URL กลับมาหน้านี้ระหว่างเปลี่ยนหน้า)
    if (window.location.pathname !== "/customers") return;
    const qs = filtersToParams(filters).toString();
    const target = qs ? `?${qs}` : window.location.pathname;
    if (target !== window.location.search && target !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", target);
    }
  }, [filters]);

  const applyPage = useCallback((d: PageData, append: boolean, key: string) => {
    setLoadedKey(key);
    setRows((prev) => (append ? [...prev, ...d.rows] : d.rows));
    setNext(d.next);
    setScanned((prev) => (append ? prev + d.scanned : d.scanned));
    if (d.dbTotal !== null) setDbTotal(d.dbTotal);
    setTooBroad(d.searchTooBroad);
  }, []);

  // โหลดหน้าแรกใหม่เมื่อตัวกรอง/คำค้นเปลี่ยน (ข้ามครั้งแรก — server โหลดให้แล้ว)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const id = ++reqId.current;
    inflight.current = id;
    setAutoLimit(AUTO_LOAD_CAP);
    setLoading(true);
    setError(null);
    setExportNote(null);
    const key = queryKey(filters, appliedSearch);
    void loadRegistryPage(supabase, ctx, filters, appliedSearch, null).then((res) => {
      if (id !== reqId.current) return;
      inflight.current = null;
      setLoading(false);
      if (!res.ok) {
        console.error("[customers] load error code", res.code);
        setError(res.code);
        setRows([]);
        setNext(null);
        setLoadedKey(key);
        return;
      }
      applyPage(res.data, false, key);
    });
  }, [filters, appliedSearch, supabase, ctx, applyPage, reloadTick]);

  /** โหลดหน้าถัดไป (ทีละหน้า — ไม่ยิงซ้อน) */
  const loadMore = useCallback(async () => {
    if (!next || inflight.current !== null) return;
    const id = ++reqId.current;
    inflight.current = id;
    setLoading(true);
    setError(null);
    const key = queryKey(filters, appliedSearch);
    const res = await loadRegistryPage(supabase, ctx, filters, appliedSearch, next);
    if (id !== reqId.current) return;
    inflight.current = null;
    setLoading(false);
    if (!res.ok) {
      console.error("[customers] load more error code", res.code);
      setError(res.code);
      return;
    }
    applyPage(res.data, true, key);
  }, [next, filters, appliedSearch, supabase, ctx, applyPage]);

  /** ผู้ใช้กด "โหลดเพิ่ม" เอง — ถ้าถึงเพดานตรวจอัตโนมัติแล้ว เลื่อนเพดานให้อีกรอบ */
  const loadMoreManual = () => {
    setAutoLimit((lim) => (scanned >= lim ? scanned + AUTO_LOAD_CAP : lim));
    void loadMore();
  };

  const retry = () => {
    setError(null);
    if (next) void loadMore();
    else setReloadTick((t) => t + 1);
  };

  const reset = () => {
    setFilters(defaultFilters());
    setSearchText("");
    setAppliedSearch("");
  };

  const exportCsv = async () => {
    setExporting(true);
    setExportNote(null);
    const res = await loadRegistryForExport(supabase, ctx, filters, appliedSearch);
    setExporting(false);
    if (!res.ok) {
      console.error("[customers] export error code", res.code);
      setError(res.code);
      return;
    }
    const blob = new Blob([registryCsv(res.data.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = registryFileName(todayBangkok());
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExportNote(
      res.data.truncated
        ? `ส่งออกได้สูงสุด ${fmtN(MAX_EXPORT_ROWS)} แถวต่อครั้ง — ไฟล์นี้มีเฉพาะส่วนแรก ลองกรองสาขา/เขตให้แคบลงแล้วส่งออกใหม่`
        : `ส่งออกแล้ว ${fmtN(res.data.rows.length)} แถว`,
    );
  };

  const post = needsPostFilter(filters);
  const cursorFresh = loadedKey === queryKey(filters, appliedSearch);
  const decision = decideAutoLoad({ post, hasNext: next !== null, scanned, limit: autoLimit, hasError: error !== null });
  const autoRunning = post && cursorFresh && decision.continue;
  const hitCap = post && cursorFresh && !decision.continue && decision.reason === "cap";

  // ตัวกรองฝั่งหน้า: โหลดหน้าถัดไปต่อเองจนครบ (ทีละหน้า · รอรอบก่อนเสร็จ · cursor ต้องเป็นของตัวกรองปัจจุบัน)
  useEffect(() => {
    if (autoRunning && !loading) void loadMore();
  }, [autoRunning, loading, loadMore]);
  const legend = useMemo(() => tierLegend(refs.tierRules, today.slice(0, 7)), [refs.tierRules, today]);

  const countText = (() => {
    if (post) {
      const total = dbTotal !== null ? ` จาก ${fmtN(dbTotal)} สัญญาที่ตรงตัวกรองอื่น` : "";
      return `พบ ${fmtN(rows.length)} รายการ · ตรวจแล้ว ${fmtN(scanned)}${total}${next ? " · ยังมีต่อ" : " · ตรวจครบแล้ว"}`;
    }
    return dbTotal !== null ? `แสดง ${fmtN(rows.length)} จาก ${fmtN(dbTotal)} สัญญา` : `แสดง ${fmtN(rows.length)} สัญญา`;
  })();

  return (
    <div className="mx-auto max-w-[1280px] p-4 max-[767px]:p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-bold max-[767px]:text-xl">ทะเบียนลูกค้า / สัญญา</h1>
          <p className="mb-0 mt-0.5 max-w-3xl text-[13px] text-fg-muted">
            ตารางสำหรับ <b>ดูและตรวจความถูกต้อง</b> ของข้อมูลลูกค้า/สัญญา (อ่านอย่างเดียว) — กรอง เรียง ส่งออกได้ · Tier คำนวณจากมูลค่าต่อปีอัตโนมัติ ·
            หากต้องกรอกหรือแก้ผลบริการ ให้ไปที่เมนู <b>“ลงข้อมูลทำบริการประจำเดือน”</b> (Host / Recorder)
          </p>
        </div>
        {role === "host" || role === "admin" ? (
          <Link
            href="/customers/new"
            className="inline-flex min-h-9 items-center rounded-lg border border-border-strong bg-surface px-3 text-[13px] font-semibold text-accent-strong hover:bg-surface-2 max-[767px]:min-h-11 max-[767px]:w-full max-[767px]:justify-center"
          >
            เปิดงานลูกค้า/สัญญาใหม่
          </Link>
        ) : null}
      </div>

      <RegistryFilterBar
        filters={filters}
        branches={refs.branches}
        search={searchText}
        exporting={exporting}
        onChange={setFilters}
        onSearch={setSearchText}
        onReset={reset}
        onExport={exportCsv}
      />

      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-fg" role="status" aria-live="polite">
        <span className="num">{autoRunning ? progressText(scanned, dbTotal, rows.length) : loading ? "กำลังโหลด…" : countText}</span>
      </div>

      {exportNote ? (
        <Alert variant={exportNote.startsWith("ส่งออกได้สูงสุด") ? "warn" : "ok"} className="mb-2">
          {exportNote}
        </Alert>
      ) : null}
      {tooBroad ? (
        <Alert variant="warn" title="คำค้นกว้างเกินไป" className="mb-2">
          ชื่อที่ค้นตรงกับลูกค้ามากกว่า {fmtN(MAX_SEARCH_CUSTOMERS)} ราย — ผลค้นตามชื่อแสดงไม่ครบ ลองพิมพ์ชื่อให้เจาะจงขึ้น (ค้นด้วยเลขที่สัญญายังครบถ้วน)
        </Alert>
      ) : null}
      {hitCap ? (
        <Alert variant="warn" title="ตรวจยังไม่ครบ" className="mb-2">
          {capText(scanned, dbTotal)}
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="danger" title="โหลดทะเบียนไม่สำเร็จ" className="mb-2">
          ลองกรองใหม่หรือรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ (รหัส {error}){" "}
          <Button size="sm" onClick={retry}>
            ลองใหม่
          </Button>
        </Alert>
      ) : null}

      {rows.length === 0 && !loading && !autoRunning && !error ? (
        <div className="rounded-card border border-border bg-surface p-6 text-center text-[13px] text-fg-muted">
          {next ? (
            <>
              ยังไม่พบสัญญาที่ตรงในช่วงที่ตรวจ ({fmtN(scanned)} สัญญา) — ยังมีข้อมูลต่อ กด “โหลดเพิ่ม” เพื่อตรวจต่อ
            </>
          ) : (
            <>
              ไม่พบสัญญาที่ตรงกับตัวกรองที่เลือก{" "}
              <Button size="sm" onClick={reset}>
                ล้างตัวกรอง
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className={cx(loading && !autoRunning && "opacity-60")}>
          <RegistryList rows={rows} today={today} role={role} sort={filters.sort} onSort={(sort) => setFilters((f) => ({ ...f, sort }))} />
        </div>
      )}

      {next ? (
        <div className="mt-3 flex justify-center">
          <Button onClick={loadMoreManual} loading={loading} className="max-[767px]:min-h-11 max-[767px]:w-full">
            โหลดเพิ่ม
          </Button>
        </div>
      ) : null}

      {legend.length > 0 ? (
        <div className="xxl-auto mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-muted">
          {legend.map((l) => (
            <span key={l.tier} className="inline-flex items-center gap-1.5">
              <TierBadge tier={l.tier} years={1} /> <span className="num">{l.text}</span>
            </span>
          ))}
          <span>· เลขท้าย = ระยะสัญญา (1 = 12 เดือนหรือ Custom · 3 = 36 เดือน)</span>
        </div>
      ) : null}
      <p className="mt-2 text-xs text-fg-muted">
        Tier มาจากเกณฑ์ในตาราง <b>tier_rules</b> (Host แก้ได้) ไม่ hardcode ในโค้ด · วันสิ้นสุด = วันเริ่ม + ระยะสัญญา − 1 วัน ระบบเติมให้อัตโนมัติ
      </p>
    </div>
  );
}
