"use client";

/**
 * ServiceClient — หน้า "ลงข้อมูลทำบริการประจำเดือน" (split ซ้ายรายชื่อ / ขวาฟอร์มทีละราย)
 *
 * Logic summary:
 *   * รายชื่อ + ตัวกรอง เขต/สาขา/เดือน มาจากเซิร์ฟเวอร์ (เปลี่ยนตัวกรอง = เปลี่ยน URL แล้วโหลดใหม่)
 *   * เลือกรายชื่อ → โหลดรายละเอียด (สถานี · การเข้าในเดือน · ทีมล่าสุด · ประวัติ F · สถานีสัญญาเก่า) ด้วย Supabase
 *     client ของผู้ใช้ (RLS ทำงาน) แล้วเปิดฟอร์ม
 *   * เดือนนั้นมีการเข้าแล้ว: เปิดแก้ "การเข้าครั้งแรกประเภทบริการประจำเดือน (routine) ของเดือน" ถ้าไม่มี routine ใช้ครั้งแรกของเดือน
 *     · เลือกครั้งอื่น หรือ "+ การเข้าใหม่" ได้จากแถบเลือกการเข้าในฟอร์ม (ไม่รวมการเข้า "ติดตามผล" นอกรอบ — อยู่หน้า /bait)
 *   * "กรอกแล้ว" นับเฉพาะ routine (2.23) · หลังบันทึก/ลบ อ่านตัวเลข "AG n"/กรอกแล้ว ของรายนั้นจากฐานข้อมูลใหม่ทันที
 *   * เตือนก่อนออกจากรายที่ยังไม่บันทึก (ค่าเริ่มต้น = "กลับไปกรอกต่อ")
 *   * บันทึกสำเร็จ → ไปรายถัดไปที่ยังไม่กรอก (วนรอบรายชื่อ) · ไม่มีรายถัดไป = ข้อความ "กรอกครบทุกรายแล้ว"
 *   * ไม่มีข้อมูล = หน้าว่างที่บอกชัด (ไม่มีตัวเลขสมมติ)
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, Toast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

import { ConfirmDialog } from "./ConfirmDialog";
import { ContractList, type ListView } from "./ContractList";
import { loadContractCounts, loadContractDetail, loadVisit, type ServiceMaster } from "./data";
import { formFromVisit, newVisitForm } from "./formState";
import { monthLabel, todayBangkok } from "./months";
import { searchContracts } from "./search";
import { ServiceForm, type SavedInfo } from "./ServiceForm";
import type { ContractDetail, ContractListItem, FormState, LoadedVisit } from "./types";

interface OpenState {
  itemId: string;
  detail: ContractDetail;
  loadedVisit: LoadedVisit | null;
  form: FormState;
  chosenVisitId: string;
}

export function ServiceClient({
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
  const [view, setView] = useState<ListView>("todo");
  const [open, setOpen] = useState<OpenState | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [toast, setToast] = useState("");
  const [allDone, setAllDone] = useState(false);
  const req = useRef(0);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const openVisit = useCallback(
    async (item: ContractListItem, detail: ContractDetail, choice: string, myReq: number): Promise<boolean> => {
      if (choice === "new") {
        if (myReq !== req.current) return false;
        setOpen({
          itemId: item.contractId,
          detail,
          loadedVisit: null,
          form: newVisitForm(detail, month, todayBangkok()),
          chosenVisitId: "new",
        });
        return true;
      }
      const { visit, error } = await loadVisit(supabase, choice);
      if (myReq !== req.current) return false;
      if (!visit) {
        setLoadError(error ?? "โหลดการเข้าบริการไม่ได้");
        return false;
      }
      setOpen({
        itemId: item.contractId,
        detail,
        loadedVisit: visit,
        form: formFromVisit(detail, visit),
        chosenVisitId: visit.id,
      });
      return true;
    },
    [supabase, month],
  );

  const select = useCallback(
    async (id: string | null) => {
      const myReq = ++req.current;
      setLoadError(null);
      setAllDone(false);
      if (id === null) {
        setOpen(null);
        setDirty(false);
        return;
      }
      const item = itemsRef.current.find((c) => c.contractId === id);
      if (!item) return;
      setLoading(true);
      const { detail, error } = await loadContractDetail(supabase, item, month);
      if (myReq !== req.current) return;
      if (!detail) {
        setLoadError(error ?? "โหลดข้อมูลสัญญาไม่ได้");
        setOpen(null);
        setLoading(false);
        return;
      }
      const preferred = detail.visitsInMonth.find((v) => v.visitType === "routine") ?? detail.visitsInMonth[0];
      const ok = await openVisit(item, detail, preferred ? preferred.id : "new", myReq);
      if (myReq === req.current) {
        setLoading(false);
        if (ok) setDirty(false);
      }
    },
    [supabase, month, openVisit],
  );

  // เปิดรายแรกที่ยังไม่กรอกเมื่อเข้าหน้า
  useEffect(() => {
    const first = initialItems.find((c) => c.routineCountInMonth === 0) ?? initialItems[0];
    if (first) void select(first.contractId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const guard = (go: () => void) => {
    if (dirty) setPending(() => go);
    else go();
  };

  const visibleOrder = useMemo(() => {
    const s = searchContracts(items, query);
    return s.searching ? s.items : items;
  }, [items, query]);

  const nextUndone = (fromId: string, list: readonly ContractListItem[]): ContractListItem | null => {
    const i = list.findIndex((c) => c.contractId === fromId);
    for (let step = 1; step < list.length; step += 1) {
      const c = list[(i + step) % list.length];
      if (c && c.routineCountInMonth === 0) return c;
    }
    return null;
  };

  /** อ่านตัวเลขสดของรายเดียวจากฐานข้อมูลแล้วอัปเดตรายชื่อ (AG n · กรอกแล้ว · ตั้งสถานีแล้ว) */
  const refreshItem = async (contractId: string, initializedHint = false) => {
    const fresh = await loadContractCounts(supabase, contractId, month);
    const updated = itemsRef.current.map((c) =>
      c.contractId !== contractId
        ? c
        : fresh
          ? {
              ...c,
              agCount: fresh.agCount,
              routineCountInMonth: fresh.routineCount,
              stationsInitialized: fresh.stationsInitialized,
            }
          : { ...c, stationsInitialized: c.stationsInitialized || initializedHint },
    );
    setItems(updated);
    itemsRef.current = updated;
    return updated;
  };

  const handleSaved = async (info: SavedInfo) => {
    if (!open) return;
    const current = open.itemId;
    const updated = await refreshItem(current, info.initialized);

    if (info.stay) {
      // บันทึกหลักสำเร็จแต่ยังมีขั้นค้าง — อยู่หน้าเดิม ฟอร์มเป็นโหมดแก้การเข้านี้ (visit_id เดิม)
      setOpen({ ...open, form: { ...open.form, isExisting: open.form.isExisting || info.created } });
      return;
    }
    const name = updated.find((c) => c.contractId === current)?.customerName ?? "";
    setToast(`บันทึกผล “${name}” แล้ว`);
    const next = nextUndone(current, updated);
    setDirty(false);
    if (next) void select(next.contractId);
    else {
      void select(null);
      setAllDone(true);
    }
  };

  const handleDeleted = async () => {
    if (!open) return;
    const current = open.itemId;
    await refreshItem(current);
    setToast("ลบการเข้าบริการแล้ว");
    setDirty(false);
    void select(current);
  };

  const navigate = (next: { zoneId?: string; branchId?: string; month?: string }) => {
    const z = next.zoneId ?? zoneId;
    const b = next.branchId ?? branchId;
    const m = next.month ?? month;
    const params = new URLSearchParams({ zone: z, month: m });
    if (b) params.set("branch", b);
    guard(() => router.replace(`/service?${params.toString()}`));
  };

  const openItem = open ? items.find((c) => c.contractId === open.itemId) : undefined;
  const position = openItem
    ? { index: Math.max(1, visibleOrder.findIndex((c) => c.contractId === openItem.contractId) + 1), total: visibleOrder.length }
    : { index: 0, total: items.length };

  const goPrev = () => {
    if (!openItem) return;
    const i = visibleOrder.findIndex((c) => c.contractId === openItem.contractId);
    const prev = visibleOrder[i - 1];
    if (!prev) {
      setToast("เป็นรายแรกแล้ว");
      return;
    }
    guard(() => void select(prev.contractId));
  };
  const goSkip = () => {
    if (!openItem) return;
    const next = nextUndone(openItem.contractId, items);
    if (!next) {
      setToast("ไม่มีรายอื่นที่ยังไม่กรอก");
      return;
    }
    guard(() => void select(next.contractId));
  };

  const done = items.filter((c) => c.routineCountInMonth > 0).length;

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-3">
      <header>
        <h1 className="m-0 text-[20px] font-semibold">ลงข้อมูลทำบริการประจำเดือน</h1>
        <p className="m-0 mt-1 text-[13px] text-fg-muted">
          เลือกลูกค้าทางซ้าย แล้วกรอกทีละราย — ตั้งต้นว่าทุกจุดปกติ กรอกเฉพาะที่พบปลวก เปลี่ยนไม้ งานซ่อม/ฝังเพิ่ม ·
          งานกล่องเหยื่อ AG กรอกในฟอร์มเดียวกัน · เดือน {monthLabel(month)}
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
          onFilter={navigate}
          onQuery={setQuery}
          onView={setView}
          onSelect={(id) => guard(() => void select(id))}
        />

        <div className="min-w-0">
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
            <ServiceForm
              key={`${open.itemId}:${open.chosenVisitId}:${open.form.visitId}`}
              supabase={supabase}
              item={openItem}
              detail={open.detail}
              loadedVisit={open.loadedVisit}
              form={open.form}
              teams={master.teams}
              month={month}
              position={position}
              visitChoices={open.detail.visitsInMonth}
              chosenVisitId={open.chosenVisitId}
              onChange={(patch) => {
                setDirty(true);
                setOpen((o) => (o ? { ...o, form: { ...o.form, ...patch } } : o));
              }}
              onChooseVisit={(id) =>
                guard(() => {
                  const myReq = ++req.current;
                  setLoading(true);
                  void openVisit(openItem, open.detail, id, myReq).then((ok) => {
                    if (myReq === req.current) {
                      setLoading(false);
                      if (ok) setDirty(false);
                    }
                  });
                })
              }
              onDetail={(detail) => setOpen((o) => (o ? { ...o, detail } : o))}
              onSaved={(info) => void handleSaved(info)}
              onDeleted={() => void handleDeleted()}
              onPrev={goPrev}
              onSkip={goSkip}
            />
          ) : (
            <div className="rounded-xl border border-border bg-surface px-5 py-14 text-center">
              {allDone || (items.length > 0 && done === items.length) ? (
                <>
                  <b className="mb-1.5 block text-[16px] text-ok">✓ กรอกครบทุกรายแล้ว</b>
                  <span className="text-[13px] text-fg-muted">
                    กรอกแล้ว {done} / {items.length} ราย ตามตัวกรองนี้ · กดสลับ “กรอกแล้ว” ทางซ้ายเพื่อแก้ไขรายที่กรอกไปแล้ว
                  </span>
                </>
              ) : items.length === 0 ? (
                <span className="text-[13px] text-fg-muted">
                  ไม่มีสัญญาที่อยู่ในช่วงบริการของเดือน {monthLabel(month)} ตามตัวกรองนี้ — ลองเปลี่ยนสาขา/เดือน
                </span>
              ) : (
                <span className="text-[13px] text-fg-muted">เลือกลูกค้าทางซ้ายเพื่อเริ่มกรอก</span>
              )}
            </div>
          )}
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
