"use client";

/**
 * BaitClient — หน้า "กล่อง AG นอกรอบประจำเดือน" (split ซ้ายรายชื่อ / ขวาฟอร์มทีละราย · mockup #bait FINAL)
 *
 * Logic summary:
 *   * ใช้เฉพาะงานกล่องที่ "ไม่ได้เข้าพร้อมรอบบริการประจำเดือน" — กรอกผลติดตาม (F) หรือติดกล่องใหม่ (S) ได้เลย
 *   * รายชื่อ + ตัวกรอง เขต/สาขา/เดือน มาจากเซิร์ฟเวอร์ (เปลี่ยนตัวกรอง = เปลี่ยน URL) · รายชื่อชุดเดียวกับ /service
 *     (+ สัญญาที่หมดช่วงบริการแล้วแต่ยังมีกล่อง AG ค้าง) · สลับ "มีกล่องค้างติดตาม / ทุกราย"
 *   * เลือกลูกค้า → โหลดรายละเอียดสัญญา (สถานี · ประวัติ F) + รายการการเข้านอกรอบที่บันทึกแล้ว แล้วเปิดฟอร์มใหม่
 *   * บันทึกสำเร็จ → โหลดสถานี/ประวัติ F ใหม่ (กล่องที่เพิ่งติด S ครั้งนี้กลายเป็นจุด F ของวันถัดไป) แล้วเริ่มฟอร์มใหม่ของรายเดิม
 *     "บันทึกแล้วเพิ่มอีกวัน" = วันที่ว่าง ทีมคงเดิม · ตัวเลข "AG n" ของรายชื่อรีเฟรชจากฐานข้อมูลทันที
 *   * เตือนก่อนออกจากรายที่ยังไม่บันทึก (ค่าเริ่มต้น = "กลับไปกรอกต่อ")
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/service/ConfirmDialog";
import { ContractList, type ListView } from "@/components/service/ContractList";
import { loadContractCounts, loadContractDetail, loadVisit, type ServiceMaster } from "@/components/service/data";
import { defaultVisitDate, formFromVisit, newId } from "@/components/service/formState";
import { monthLabel, todayBangkok } from "@/lib/service/months";
import type { ContractDetail, ContractListItem, FormState, LoadedVisit } from "@/components/service/types";
import { Alert, Toast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

import { newBaitForm } from "./baitLogic";
import { BaitForm, type BaitSavedInfo } from "./BaitForm";
import { loadBaitVisits, type BaitVisitLogItem } from "./data";

interface OpenState {
  itemId: string;
  detail: ContractDetail;
  log: BaitVisitLogItem[];
  loadedVisit: LoadedVisit | null;
  form: FormState;
  focusDate: boolean;
}

export function BaitClient({
  master,
  zoneId,
  branchId,
  month,
  currentMonth,
  initialItems,
  truncated,
}: {
  master: ServiceMaster;
  zoneId: string;
  branchId: string;
  month: string;
  currentMonth: string;
  initialItems: ContractListItem[];
  truncated: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [items, setItems] = useState<ContractListItem[]>(initialItems);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ListView>("ag");
  const [open, setOpen] = useState<OpenState | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [toast, setToast] = useState("");
  const req = useRef(0);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  /** เปิดฟอร์มใหม่ (การเข้าใหม่) ของสัญญา — ทีมเติมจากครั้งก่อน/ครั้งที่เพิ่งบันทึก */
  const openFresh = useCallback(
    async (
      item: ContractListItem,
      opts: { dateEmpty?: boolean; teamIds?: readonly string[]; myReq: number },
    ): Promise<boolean> => {
      const [detailRes, logRes] = await Promise.all([
        loadContractDetail(supabase, item, month),
        loadBaitVisits(supabase, item.contractId),
      ]);
      if (opts.myReq !== req.current) return false;
      if (!detailRes.detail) {
        setLoadError(detailRes.error ?? "โหลดข้อมูลสัญญาไม่ได้");
        setOpen(null);
        return false;
      }
      if (logRes.error) setLoadError(`โหลดรายการที่บันทึกแล้วไม่ได้: ${logRes.error}`);
      const detail = detailRes.detail;
      const date = opts.dateEmpty ? "" : defaultVisitDate(month, todayBangkok());
      setOpen({
        itemId: item.contractId,
        detail,
        log: logRes.items,
        loadedVisit: null,
        form: newBaitForm(detail, newId(), date, opts.teamIds ?? detail.lastTeamIds),
        focusDate: Boolean(opts.dateEmpty),
      });
      return true;
    },
    [supabase, month],
  );

  const select = useCallback(
    async (id: string | null) => {
      const myReq = ++req.current;
      setLoadError(null);
      if (id === null) {
        setOpen(null);
        setDirty(false);
        return;
      }
      const item = itemsRef.current.find((c) => c.contractId === id);
      if (!item) return;
      setLoading(true);
      const ok = await openFresh(item, { myReq });
      if (myReq === req.current) {
        setLoading(false);
        if (ok) setDirty(false);
      }
    },
    [openFresh],
  );

  // เปิดรายแรกที่มีกล่องค้างเมื่อเข้าหน้า (ไม่มี = รายแรกของรายชื่อ)
  useEffect(() => {
    const first = initialItems.find((c) => c.agCount > 0) ?? initialItems[0];
    if (first) {
      if (first.agCount === 0) setView("all");
      void select(first.contractId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const guard = (go: () => void) => {
    if (dirty) setPending(() => go);
    else go();
  };

  /** อ่านตัวเลขสดของรายเดียวจากฐานข้อมูล (AG n · ตั้งสถานีแล้ว) */
  const refreshItem = async (contractId: string) => {
    const fresh = await loadContractCounts(supabase, contractId, month);
    if (!fresh) return;
    const updated = itemsRef.current.map((c) =>
      c.contractId === contractId ? { ...c, agCount: fresh.agCount, stationsInitialized: fresh.stationsInitialized } : c,
    );
    setItems(updated);
    itemsRef.current = updated;
  };

  const handleSaved = async (info: BaitSavedInfo) => {
    if (!open) return;
    const current = open.itemId;
    const teamIds = open.form.teamIds;
    const date = open.form.visitDate;
    const myReq = ++req.current;
    setDirty(false);
    await refreshItem(current);
    if (myReq !== req.current) return;
    const item = itemsRef.current.find((c) => c.contractId === current);
    if (!item) return;
    setToast(
      `บันทึกงานกล่องของ “${item.customerName}” วันที่ ${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)} แล้ว${
        info.more ? " · กรอกวันถัดไปได้เลย" : ""
      }`,
    );
    setLoading(true);
    await openFresh(item, { dateEmpty: info.more, teamIds, myReq });
    if (myReq === req.current) setLoading(false);
  };

  const handleDeleted = async () => {
    if (!open) return;
    const current = open.itemId;
    const myReq = ++req.current;
    setDirty(false);
    await refreshItem(current);
    if (myReq !== req.current) return;
    const item = itemsRef.current.find((c) => c.contractId === current);
    if (!item) return;
    setToast("ลบการเข้านอกรอบแล้ว");
    setLoading(true);
    await openFresh(item, { myReq });
    if (myReq === req.current) setLoading(false);
  };

  /** แก้การเข้านอกรอบที่บันทึกแล้ว (จากรายการ "กรอกแล้ว") */
  const editLog = (visitId: string) =>
    guard(() => {
      if (!open) return;
      const myReq = ++req.current;
      setLoadError(null);
      setLoading(true);
      void loadVisit(supabase, visitId).then(({ visit, error }) => {
        if (myReq !== req.current) return;
        setLoading(false);
        if (!visit) {
          setLoadError(error ?? "โหลดการเข้าบริการไม่ได้");
          return;
        }
        setOpen((o) => (o ? { ...o, loadedVisit: visit, form: formFromVisit(o.detail, visit), focusDate: false } : o));
        setDirty(false);
      });
    });

  const navigate = (next: { zoneId?: string; branchId?: string; month?: string }) => {
    const z = next.zoneId ?? zoneId;
    const b = next.branchId ?? branchId;
    const m = next.month ?? month;
    const params = new URLSearchParams({ zone: z, month: m });
    if (b) params.set("branch", b);
    guard(() => router.replace(`/bait?${params.toString()}`));
  };

  const openItem = open ? items.find((c) => c.contractId === open.itemId) : undefined;

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-3">
      <header>
        <h1 className="m-0 text-[20px] font-semibold">กล่อง AG นอกรอบประจำเดือน</h1>
        <p className="m-0 mt-1 text-[13px] text-fg-muted">
          ใช้เฉพาะงานกล่องที่ <b>ไม่ได้เข้าพร้อมรอบบริการประจำเดือน</b> — กรอกผลติดตาม (F) หรือติดกล่องใหม่ (S) ได้เลย
          ไม่ต้องรอรอบประจำเดือน · งานกล่องที่ทำพร้อมรอบบริการ ให้กรอกในหน้า “ลงข้อมูลทำบริการประจำเดือน” · เดือน {monthLabel(month)}
        </p>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <ContractList
          zones={master.zones}
          branches={master.branches}
          zoneId={zoneId}
          branchId={branchId}
          month={month}
          currentMonth={currentMonth}
          items={items}
          truncated={truncated}
          selectedId={open?.itemId ?? null}
          query={query}
          view={view}
          variant="offround"
          onFilter={navigate}
          onQuery={setQuery}
          onView={setView}
          onSelect={(id) => guard(() => void select(id))}
        />

        <div className="flex min-w-0 flex-col gap-3">
          {loadError ? (
            <Alert variant="danger" title="เปิดรายนี้ไม่ได้">
              {loadError} — ลองเลือกรายนี้อีกครั้ง หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ
            </Alert>
          ) : null}

          {loading ? (
            <div role="status" className="rounded-xl border border-border bg-surface px-5 py-14 text-center text-[13px] text-fg-muted">
              กำลังโหลดข้อมูลสัญญา…
            </div>
          ) : open && openItem ? (
            <BaitForm
              key={`${open.itemId}:${open.form.visitId}`}
              supabase={supabase}
              item={openItem}
              detail={open.detail}
              loadedVisit={open.loadedVisit}
              form={open.form}
              log={open.log}
              teams={master.teams}
              today={todayBangkok()}
              focusDateOnMount={open.focusDate}
              onChange={(patch) => {
                setDirty(true);
                setOpen((o) => (o ? { ...o, form: { ...o.form, ...patch } } : o));
              }}
              onEditLog={editLog}
              onSaved={(info) => void handleSaved(info)}
              onDeleted={() => void handleDeleted()}
              onCancel={() => guard(() => void select(open.itemId))}
            />
          ) : (
            <div className="rounded-xl border border-border bg-surface px-5 py-14 text-center text-[13px] text-fg-muted">
              {items.length === 0
                ? `ไม่มีสัญญาตามตัวกรองนี้ — ลองเปลี่ยนสาขา/เดือน (${monthLabel(month)})`
                : "เลือกลูกค้าทางซ้ายเพื่อกรอกงานกล่องเหยื่อ"}
            </div>
          )}

          <div role="note" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-fg-muted">
            <span aria-hidden="true">ℹ </span>
            ขั้นตอนกล่อง AG: ติดกล่องใหม่ (S) → ติดตามผล F1, F2… แยกแต่ละจุด → รอถอด (พบปลวกตาย) → ถอดแล้ว (ยืนยันว่าตายจริง จบปัญหา) ·
            สถิติกล่องและสรุปการใช้เหยื่ออยู่ที่หน้า “สรุปตัวเลข”
          </div>
        </div>
      </div>

      {pending ? (
        <ConfirmDialog
          title="ออกจากรายนี้โดยไม่บันทึก?"
          message="รายนี้มีข้อมูลที่กรอกไว้แต่ยังไม่ได้บันทึก ถ้าออกตอนนี้ข้อมูลที่กรอกไว้จะหายไป"
          confirmLabel="ออกโดยไม่บันทึก"
          cancelLabel="กลับไปกรอกต่อ"
          onConfirm={() => {
            const go = pending;
            setPending(null);
            setDirty(false);
            go();
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}

      <Toast message={toast} onClose={() => setToast("")} />
    </div>
  );
}
