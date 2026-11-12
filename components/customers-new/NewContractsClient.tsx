"use client";

/**
 * NewContractsClient — หน้า "เปิดงานเข้าทะเบียนบริการ" (ตารางกรอกแบบ Excel + ตัวกรอง + แนบไฟล์)
 * ตาม mockup FINAL `docs/mockup/admin-add-customer.html`
 *
 * Logic summary:
 *   * แถวมี 3 แบบ: "บันทึกแล้ว" (มาจากฐานข้อมูล ตามเดือนที่เลือก · อ่านอย่างเดียว + แนบไฟล์/แก้/ลบ/ดูประวัติ)
 *     · "กำลังแก้" (กดปุ่ม แก้ ที่แถวบันทึกแล้ว → แถวเดิมกลายเป็นช่องกรอก ดู `editRow.ts`) · และ "ร่าง"
 *     (แถวที่กำลังกรอก ยังไม่บันทึก) — ร่างแสดงเสมอ ไม่ถูกตัวกรองซ่อน กันงานที่พิมพ์ค้างหาย
 *   * แก้แถว (รอบ 1.3): บันทึก = RPC `save_job_opening` โหมดแก้ (ส่ง `p_contract_id`) ทีละแถว · ล็อกสาขา/ชื่อลูกค้า/
 *     ประเภทลูกค้า · สัญญา closed/cancelled ปิดปุ่มแก้ · แก้แล้ว trigger ลง audit_log เอง → router.refresh() ให้ตัวนับ
 *     "ประวัติ (n)" อัปเดต · ยกเลิก = ทิ้งแถวที่แก้ ค่ากลับเป็นของเดิมในฐานข้อมูล
 *   * ช่องคำนวณ (เขต/Tier/วันสิ้นสุด) เรียก `rowCalc.ts` → `lib/rules` · เกณฑ์ Tier มาจาก `tier_rules` ที่ server ส่งมา
 *   * ตัวกรอง เดือน = เปลี่ยน `?month=` (server โหลดใหม่) · เขต/สาขา/สถานะ/ค้นหา = กรองฝั่ง client
 *     เฉพาะแถวที่บันทึกแล้วของเดือนที่เลือก
 *   * บันทึก = ทีละแถวด้วย RPC `save_job_opening` (1 แถว = 1 transaction · RLS ตัดสินสิทธิ์) แถวที่ผ่านถูกเอาออกจากร่าง
 *     แถวที่ไม่ผ่านค้างไว้พร้อมข้อความผิดพลาด · ชื่อลูกค้าซ้ำในสาขา (AG001) → กล่อง "ใช้รายเดิม / คนละราย"
 *     แล้วส่งซ้ำตามที่เลือก (ดู `save.ts`, `DuplicateCustomerDialog.tsx`)
 *   * ลบ = RPC `delete_job_opening` · ไฟล์ใน Storage DB ลงคิวให้ cron ลบ (ไม่ลบจากหน้านี้)
 *   * ช่องที่ schema ยังไม่มี 6 ช่อง ซ่อนด้วย `SHOW_PENDING_SCHEMA_COLUMNS` (config.ts)
 */
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { Alert, Button, Chip, Field, TierBadge, Toast, cx } from "@/components/ui";
import type { UserRole } from "@/lib/db/types";
import type { TermYears } from "@/lib/rules";
import { createClient } from "@/lib/supabase/client";

import { resolveBranch } from "./branchMatch";
import { checkContractNos, normalizeContractNo } from "./contractNo";
import {
  SERVICE_TIME_SLOTS,
  applyDraftPatch,
  canSave,
  checkDraft,
  createDraft,
  missingLabel,
} from "./draftRow";
import { buildDeleteConfirmText, contractDeleteBlockReason } from "./deleteRules";
import {
  EDIT_LOCK_REASONS,
  checkRenewalPickForEdit,
  contractEditBlockReason,
  draftFromSaved,
  isEditUnchanged,
  monthOfDate,
} from "./editRow";
import { applyFilters, type FilterableRow, type StatusFilter } from "./filters";
import { DuplicateCustomerDialog } from "./DuplicateCustomerDialog";
import type { DuplicateChoice, DuplicateCustomerMatch } from "./duplicateCustomer";
import { FileDialog } from "./FileDialog";
import { uploadAfterSave } from "./uploadAfterSave";
import { HistoryDialog } from "./HistoryDialog";
import { monthLabel } from "./months";
import { PdfIcon } from "./PdfIcon";
import { RenewalDialog } from "./RenewalDialog";
import { deleteContract, findLinkedRenewals, saveDraft, type SaveResult } from "./save";
import { describeTypeMismatch } from "./saveRules";
import { TeamPicker } from "./TeamPicker";
import { endDateWarning, formatMoney, tierFor } from "./rowCalc";
import type {
  CustomerTypeOption,
  DraftRow,
  MasterData,
  RenewalLink,
  SavedContract,
} from "./types";

type Props = {
  role: UserRole;
  month: string;
  monthChoices: string[];
  master: MasterData;
  saved: SavedContract[];
  truncated: boolean;
};

const INPUT =
  "w-full min-w-0 rounded-md border bg-surface px-1.5 py-1 text-[13px] text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent disabled:bg-surface-2 disabled:text-fg-faint";
const TH = "whitespace-nowrap border-b border-border bg-surface-2 px-2 py-2 text-left text-[12px] font-semibold text-fg-muted";
const TD = "border-b border-border px-1.5 py-1 align-middle";

const border = (bad: boolean) => (bad ? "border-danger" : "border-border-strong");

/** แถวที่กำลังแก้: `draft` = ค่าที่กำลังพิมพ์ · `original` = ค่าตอนกดแก้ (ไว้เทียบว่าแก้อะไรหรือยัง) */
type EditState = { draft: DraftRow; original: DraftRow };

type RenewalTarget = { kind: "draft"; key: string } | { kind: "edit"; contractId: string };

type FileTarget =
  | { kind: "saved"; contractId: string }
  | { kind: "draft"; key: string }
  | null;

export function NewContractsClient({ role, month, monthChoices, master, saved, truncated }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [filters, setFilters] = useState({
    zoneId: "",
    branchId: "",
    status: "" as StatusFilter,
    search: "",
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [banner, setBanner] = useState<{ variant: "ok" | "warn" | "danger"; text: string } | null>(
    null,
  );
  const [fileTarget, setFileTarget] = useState<FileTarget>(null);
  const [historyFor, setHistoryFor] = useState<SavedContract | null>(null);
  /** แถว (ร่าง หรือแถวที่กำลังแก้) ที่กำลังเลือกลูกค้าเดิม (Renew) */
  const [renewalFor, setRenewalFor] = useState<RenewalTarget | null>(null);
  /** แถวที่บันทึกแล้วซึ่งกำลังแก้ — key = contractId */
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  /** contractId ของแถวที่กำลังส่งบันทึก (กันกดซ้ำ) */
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  /** กล่องถามชื่อลูกค้าซ้ำ (AG001) — `resolve` ส่งคำตอบกลับให้ลูปบันทึกที่รออยู่ */
  const [dupPrompt, setDupPrompt] = useState<{
    contractNo: string;
    customerName: string;
    matches: DuplicateCustomerMatch[];
    resolve: (choice: DuplicateChoice) => void;
  } | null>(null);

  const branchById = useMemo(() => new Map(master.branches.map((b) => [b.id, b])), [master]);
  const typeLabel = useMemo(
    () => new Map(master.customerTypes.map((t) => [t.code, t.label])),
    [master],
  );
  const teamCode = useMemo(() => new Map(master.teams.map((t) => [t.id, t.code])), [master]);

  // ---------- ตรวจร่าง + แถวที่กำลังแก้ ทั้งตาราง ----------
  // เลขที่สัญญาซ้ำ = เทียบกับแถวที่บันทึกแล้วในเดือนด้วย · แถวที่กำลังแก้ใช้เลขที่ "ที่กำลังพิมพ์" แทนเลขเดิม
  // (ไม่งั้นแก้เลขที่แล้วชนกับเลขเดิมของตัวเอง)
  const editedSaved = useMemo(() => saved.filter((s) => edits[s.contractId]), [saved, edits]);
  const { draftChecks, editChecks } = useMemo(() => {
    const fixedNos = saved.filter((s) => !edits[s.contractId]).map((s) => s.contractNo);
    const editNos = editedSaved.map((s) => edits[s.contractId]!.draft.contractNo);
    const all = [...fixedNos, ...editNos, ...drafts.map((d) => d.contractNo)];
    const noErrors = checkContractNos(all);
    const editMap = new Map(
      editedSaved.map((s, i) => [
        s.contractId,
        checkDraft(edits[s.contractId]!.draft, master.branches, noErrors.get(fixedNos.length + i)),
      ]),
    );
    return {
      draftChecks: drafts.map((d, i) =>
        checkDraft(d, master.branches, noErrors.get(fixedNos.length + editNos.length + i)),
      ),
      editChecks: editMap,
    };
  }, [drafts, saved, edits, editedSaved, master.branches]);

  // ---------- แถวที่บันทึกแล้ว: คำนวณเพื่อกรอง/แสดง ----------
  const savedView = useMemo(
    () =>
      saved.map((s) => {
        const branch = branchById.get(s.branchId) ?? null;
        const warn = endDateWarning(s.startDate, s.endDate, s.termYears);
        const hasPdf = s.files.some((f) => f.kind === "contract_pdf");
        const filterable: FilterableRow = {
          customerName: s.customerName,
          contractNo: s.contractNo,
          startDate: s.startDate,
          branchId: s.branchId,
          zoneId: branch?.zoneId ?? null,
          hasPdf,
          missing: s.sellerName.trim() === "",
          pendingService: s.firstServiceDate === "",
          warned: warn !== null,
        };
        return { s, branch, warn, hasPdf, filterable };
      }),
    [saved, branchById],
  );

  const visibleSaved = useMemo(() => {
    const keep = new Set(
      applyFilters(
        savedView.map((v) => v.filterable),
        { month: "", ...filters },
      ),
    );
    return savedView.filter((v) => keep.has(v.filterable));
  }, [savedView, filters]);

  const totals = useMemo(() => {
    let value = 0;
    let isNew = 0;
    let renew = 0;
    let noFile = 0;
    let urgent = 0;
    let pending = 0;
    for (const v of savedView) {
      if (v.s.isUrgent) urgent += 1;
      if (v.filterable.pendingService) pending += 1;
      value += v.s.valueTotal;
      if (v.s.saleType === "renew") renew += 1;
      else isNew += 1;
      if (!v.hasPdf) noFile += 1;
    }
    return { count: savedView.length, value, isNew, renew, noFile, urgent, pending };
  }, [savedView]);

  const filtersActive =
    filters.zoneId !== "" || filters.branchId !== "" || filters.status !== "" || filters.search !== "";
  const branchChoices = filters.zoneId
    ? master.branches.filter((b) => b.zoneId === filters.zoneId)
    : master.branches;

  // ---------- แก้ร่าง ----------
  const patchDraft = useCallback((key: string, patch: Partial<DraftRow>) => {
    // วันสิ้นสุดอัตโนมัติ (ตามวันเริ่ม + ระยะ จนกว่าผู้ใช้แก้เอง) คำนวณใน applyDraftPatch
    setDrafts((rows) => rows.map((r) => (r.key === key ? applyDraftPatch(r, patch) : r)));
  }, []);

  // ---------- แก้แถวที่บันทึกแล้ว ----------
  const startEdit = (s: SavedContract) => {
    setBanner(null);
    setEdits((all) => {
      if (all[s.contractId]) return all;
      const draft = draftFromSaved(s, master);
      return { ...all, [s.contractId]: { draft, original: draft } };
    });
  };

  /** ยกเลิก = ทิ้งค่าที่แก้ ตารางกลับไปแสดงค่าเดิมจากฐานข้อมูล */
  const cancelEdit = (contractId: string) =>
    setEdits((all) => {
      const rest = { ...all };
      delete rest[contractId];
      return rest;
    });

  const patchEdit = useCallback((contractId: string, patch: Partial<DraftRow>) => {
    setEdits((all) => {
      const cur = all[contractId];
      return cur ? { ...all, [contractId]: { ...cur, draft: applyDraftPatch(cur.draft, patch) } } : all;
    });
  }, []);

  const setEditError = (contractId: string, message: string) =>
    setEdits((all) => {
      const cur = all[contractId];
      return cur ? { ...all, [contractId]: { ...cur, draft: { ...cur.draft, saveError: message } } } : all;
    });

  async function saveEdit(s: SavedContract) {
    const edit = edits[s.contractId];
    const check = editChecks.get(s.contractId);
    if (!edit || !check || savingEditId) return;
    setBanner(null);
    if (!canSave(check)) {
      setEditError(s.contractId, `ข้อมูลไม่ครบ ตรวจช่องที่ขึ้นขอบแดง (${missingLabel(check)})`);
      return;
    }
    setSavingEditId(s.contractId);
    const res = await saveDraft(supabase, edit.draft, check, { contractId: s.contractId });
    setSavingEditId(null);
    if (!res.ok) {
      setEditError(s.contractId, res.error);
      return;
    }
    cancelEdit(s.contractId);
    const no = edit.draft.contractNo.trim();
    const movedTo = monthOfDate(edit.draft.startDate);
    setToast(
      movedTo === month
        ? `แก้สัญญา ${no} แล้ว`
        : `แก้สัญญา ${no} แล้ว — วันเริ่มย้ายไปเดือน ${monthLabel(movedTo)} (ดูได้ที่เดือนนั้น)`,
    );
    router.refresh();
  }

  const removeDraft = (key: string) => setDrafts((rows) => rows.filter((r) => r.key !== key));

  // ---------- บันทึก ----------
  /** ถามผู้ใช้ว่าลูกค้าชื่อซ้ำเป็นรายเดิมหรือคนละราย (รอจนกว่าจะเลือก) */
  const askDuplicate = (d: DraftRow, matches: DuplicateCustomerMatch[]) =>
    new Promise<DuplicateChoice>((resolve) =>
      setDupPrompt({
        contractNo: d.contractNo.trim(),
        customerName: d.customerName.trim(),
        matches,
        resolve: (choice) => {
          setDupPrompt(null);
          resolve(choice);
        },
      }),
    );

  /** บันทึก 1 แถว · ชื่อซ้ำ (AG001) → ถามผู้ใช้ แล้วส่งซ้ำตามที่เลือก */
  async function saveRow(d: DraftRow, c: (typeof draftChecks)[number]): Promise<SaveResult> {
    const first = await saveDraft(supabase, d, c);
    if (first.ok || !first.duplicates) return first;
    const choice = await askDuplicate(d, first.duplicates);
    if (choice.kind === "cancel") {
      return {
        ok: false,
        error: "ยกเลิกแล้ว — พบลูกค้าชื่อซ้ำในสาขา ยังไม่ได้เลือกว่าเป็นรายเดิมหรือคนละราย กดบันทึกใหม่เพื่อเลือก",
      };
    }
    return saveDraft(
      supabase,
      d,
      c,
      choice.kind === "existing" ? { customerId: choice.customerId } : { confirmNewCustomer: true },
    );
  }

  async function saveAll() {
    setShowErrors(true);
    setBanner(null);
    const jobs = drafts.map((d, i) => ({ d, c: draftChecks[i]! }));
    const ready = jobs.filter((j) => canSave(j.c));
    if (jobs.length === 0) {
      setBanner({ variant: "warn", text: "ยังไม่มีแถวให้บันทึก — กด + เพิ่มแถว แล้วกรอกข้อมูล" });
      return;
    }
    if (ready.length === 0) {
      setBanner({ variant: "danger", text: "ไม่มีแถวที่ข้อมูลครบ ตรวจช่องที่ขึ้นขอบแดง" });
      return;
    }

    setSaving(true);
    let okCount = 0;
    const failedMessages = new Map<string, string>();
    const doneKeys = new Set<string>();
    let fileWarn = 0;
    const typeWarnings: string[] = [];

    for (const { d, c } of ready) {
      const res = await saveRow(d, c);
      if (!res.ok) {
        failedMessages.set(d.key, res.error);
        continue;
      }
      okCount += 1;
      doneKeys.add(d.key);
      if (res.customerTypeMismatch) {
        typeWarnings.push(
          describeTypeMismatch(d.contractNo.trim(), d.customerName.trim(), res.customerTypeMismatch, (code) =>
            typeLabel.get(code) ?? code,
          ),
        );
      }
      if (d.pendingPdf) {
        const up = await uploadAfterSave(supabase, res.contractId, d.pendingPdf);
        if (!up.ok) fileWarn += 1;
      }
    }
    setSaving(false);

    setDrafts((rows) =>
      rows
        .filter((r) => !doneKeys.has(r.key))
        .map((r) => (failedMessages.has(r.key) ? { ...r, saveError: failedMessages.get(r.key)! } : r)),
    );

    const skipped = jobs.length - ready.length;
    const failed = failedMessages.size;
    if (okCount > 0) {
      setToast(`บันทึกเข้าทะเบียนแล้ว ${okCount} แถว`);
      router.refresh();
    }
    if (failed > 0 || skipped > 0 || fileWarn > 0 || typeWarnings.length > 0) {
      const parts = [
        okCount > 0 ? `บันทึกสำเร็จ ${okCount} แถว` : null,
        failed > 0 ? `ไม่สำเร็จ ${failed} แถว (ดูข้อความใต้แถว)` : null,
        skipped > 0 ? `ข้าม ${skipped} แถวที่ข้อมูลไม่ครบ` : null,
        fileWarn > 0 ? `แนบไฟล์ไม่สำเร็จ ${fileWarn} แถว — แนบใหม่ได้จากปุ่มไฟล์แนบ` : null,
        ...typeWarnings,
      ].filter(Boolean);
      setBanner({ variant: okCount > 0 ? "warn" : "danger", text: parts.join(" · ") });
    } else {
      setBanner({ variant: "ok", text: `บันทึกเข้าทะเบียนครบ ${okCount} แถว` });
      setShowErrors(false);
    }
  }

  async function removeSaved(s: SavedContract) {
    setBanner(null);
    const blocked = contractDeleteBlockReason(s.status);
    if (blocked) {
      setBanner({ variant: "warn", text: `สัญญา ${s.contractNo}: ${blocked}` });
      return;
    }
    // สัญญา Renew ที่ผูกสัญญานี้อยู่ (อาจอยู่คนละเดือน) — ลบแล้วการผูกจะหาย ต้องเตือนก่อน
    const linked = await findLinkedRenewals(supabase, s.contractId);
    if (linked.error) {
      setBanner({
        variant: "danger",
        text: `ตรวจสัญญา Renew ที่ผูกอยู่ไม่ได้ จึงยังไม่ลบ: ${linked.error}`,
      });
      return;
    }
    if (!window.confirm(buildDeleteConfirmText(s.contractNo, s.customerName, linked.contractNos))) {
      return;
    }
    const res = await deleteContract(supabase, s.contractId);
    if (!res.ok) {
      setBanner({ variant: "danger", text: res.error });
      return;
    }
    setToast(`ลบสัญญา ${s.contractNo} แล้ว`);
    router.refresh();
  }

  const openFileDialog = fileTarget;
  const draftForDialog =
    openFileDialog?.kind === "draft" ? drafts.find((d) => d.key === openFileDialog.key) : null;
  const savedForDialog =
    openFileDialog?.kind === "saved"
      ? saved.find((s) => s.contractId === openFileDialog.contractId)
      : null;

  const readyCount = draftChecks.filter(canSave).length;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="m-0 text-xl font-bold">เปิดงาน · เพิ่มลูกค้าเข้าระบบ</h1>
        <p className="m-0 mt-1 text-[13px] text-fg-muted">
          บันทึกงานที่เปิดใหม่ → ไหลเข้าทะเบียนบริการให้หัวหน้างานใช้ต่อ
          {role === "admin" ? " · คุณบันทึกได้เฉพาะสาขาในขอบเขตของบัญชี" : ""}
        </p>
      </div>

      {/* ---------- ตัวกรอง ---------- */}
      <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3">
        <Field label="เดือนเปิดงาน" className="w-[160px]">
          {(c) => (
            <select
              {...c}
              value={month}
              onChange={(e) => router.push(`/customers/new?month=${e.target.value}`)}
            >
              {monthChoices.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="เขต" className="w-[120px]">
          {(c) => (
            <select
              {...c}
              value={filters.zoneId}
              onChange={(e) => setFilters((f) => ({ ...f, zoneId: e.target.value, branchId: "" }))}
            >
              <option value="">ทั้งหมด</option>
              {master.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="สาขา" className="w-[150px]">
          {(c) => (
            <select
              {...c}
              value={filters.branchId}
              onChange={(e) => setFilters((f) => ({ ...f, branchId: e.target.value }))}
            >
              <option value="">ทั้งหมด</option>
              {branchChoices.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="สถานะ" className="w-[190px]">
          {(c) => (
            <select
              {...c}
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }))
              }
            >
              <option value="">ทั้งหมด</option>
              <option value="ok">ครบแล้ว</option>
              <option value="pend">รอนัดบริการ</option>
              <option value="miss">ขาดข้อมูลจำเป็น</option>
              <option value="nofile">ยังไม่แนบไฟล์</option>
              <option value="warn">มีคำเตือนอื่น (ระยะสัญญา/วันที่)</option>
            </select>
          )}
        </Field>
        <Field label="กรองในตารางนี้" className="min-w-[180px] flex-1">
          {(c) => (
            <input
              {...c}
              type="search"
              autoComplete="off"
              value={filters.search}
              placeholder="พิมพ์ชื่อลูกค้า / เลขที่สัญญา (เฉพาะเดือนที่เลือก)"
              title="กรองแถวในตารางเปิดงานของเดือนที่เลือก — ค้นทั้งระบบใช้ช่องค้นหาบนแถบหัว"
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          )}
        </Field>
        {filtersActive ? (
          <Button
            size="sm"
            onClick={() => setFilters({ zoneId: "", branchId: "", status: "", search: "" })}
          >
            ✕ ล้างตัวกรอง
          </Button>
        ) : null}
        <Button size="sm" variant="primary" onClick={() => setDrafts((r) => [...r, createDraft()])}>
          + เพิ่มแถว
        </Button>
      </div>

      {/* ---------- ชิปสรุป (จากข้อมูลจริงของเดือนที่เลือก) ---------- */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="info">
          เดือนนี้ <span className="num">{totals.count}</span> สัญญา
        </Chip>
        <Chip tone="ok">
          New <span className="num">{totals.isNew}</span>
        </Chip>
        <Chip tone="na">
          Renew <span className="num">{totals.renew}</span>
        </Chip>
        <Chip tone="pend">
          เบิกด่วน <span className="num">{totals.urgent}</span>
        </Chip>
        <Chip tone="info">
          มูลค่ารวม <span className="num">{formatMoney(totals.value)}</span>
        </Chip>
        <Chip
          tone="pend"
          selected={filters.status === "pend"}
          onClick={() =>
            setFilters((f) => ({ ...f, status: f.status === "pend" ? "" : "pend" }))
          }
        >
          รอนัดบริการ <b className="num">{totals.pending}</b>
        </Chip>
        <Chip
          tone="pend"
          selected={filters.status === "nofile"}
          onClick={() =>
            setFilters((f) => ({ ...f, status: f.status === "nofile" ? "" : "nofile" }))
          }
        >
          <PdfIcon />
          ยังไม่แนบไฟล์ <b className="num">{totals.noFile}</b>
        </Chip>
        <Chip tone="na">
          แสดง <span className="num">{visibleSaved.length}</span> จาก{" "}
          <span className="num">{totals.count}</span> แถว
        </Chip>
      </div>

      {truncated ? (
        <Alert variant="warn">
          เดือนนี้มีสัญญามากกว่าที่แสดงได้ในหน้าเดียว — ใช้ตัวกรองสาขา/เขตเพื่อดูส่วนที่เหลือ
        </Alert>
      ) : null}
      {banner ? <Alert variant={banner.variant}>{banner.text}</Alert> : null}

      {/* ---------- ตาราง ---------- */}
      {/* relative: ให้ sr-only (absolute) ในตารางถูกกักในกล่องเลื่อน ไม่ดันหน้าให้เลื่อนแนวนอน */}
      <div className="relative overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
        <datalist id="branch-list">
          {master.branches.map((b) => (
            <option key={b.id} value={b.name} />
          ))}
        </datalist>
        <table className="w-full min-w-[2620px] border-collapse text-[13px]">
          <caption className="sr-only">ตารางเปิดงานของ {monthLabel(month)}</caption>
          <thead>
            <tr>
              <th scope="col" className={cx(TH, "w-[44px] text-center")}>ลำดับ</th>
              <th scope="col" className={cx(TH, "w-[130px]")}>เลขที่สัญญา</th>
              <th scope="col" className={cx(TH, "w-[300px]")}>รายชื่อ</th>
              <th scope="col" className={cx(TH, "w-[52px] text-center")}>เบิกด่วน</th>
              <th scope="col" className={cx(TH, "w-[110px]")}>ประเภทงาน</th>
              <th scope="col" className={cx(TH, "w-[150px]")}>ลูกค้าเดิม (Renew)</th>
              <th scope="col" className={cx(TH, "w-[140px]")}>ผู้ขาย</th>
              <th scope="col" className={cx(TH, "w-[100px]")}>ตำแหน่ง</th>
              <th scope="col" className={cx(TH, "w-[130px]")}>สาขา</th>
              <th scope="col" className={cx(TH, "w-[70px]")}>เขต</th>
              <th scope="col" className={cx(TH, "w-[130px]")}>วันที่รับ Mail</th>
              <th scope="col" className={cx(TH, "w-[130px]")}>วันที่บริการ</th>
              <th scope="col" className={cx(TH, "w-[96px]")}>เวลาบริการ</th>
              <th scope="col" className={cx(TH, "w-[90px]")}>ทีม</th>
              <th scope="col" className={cx(TH, "w-[170px]")}>ประเภท</th>
              <th scope="col" className={cx(TH, "w-[130px]")}>เริ่มสัญญา</th>
              <th scope="col" className={cx(TH, "w-[130px]")}>สิ้นสุด</th>
              <th scope="col" className={cx(TH, "w-[120px] text-right")}>มูลค่า 1 ปี</th>
              <th scope="col" className={cx(TH, "w-[120px] text-right")}>มูลค่า 3 ปี</th>
              <th scope="col" className={cx(TH, "w-[64px] text-center")}>Tier</th>
              <th scope="col" className={cx(TH, "w-[200px]")}>หมายเหตุ</th>
              <th scope="col" className={cx(TH, "w-[110px] text-center")}>ไฟล์แนบ</th>
              <th scope="col" className={cx(TH, "w-[170px] text-center")}>สถานะ</th>
              <th scope="col" className={cx(TH, "w-[116px]")}>
                <span className="sr-only">แก้ / ลบ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {/* ===== แถวที่บันทึกแล้ว ===== */}
            {visibleSaved.map((v, idx) => {
              const s = v.s;
              const tier = tierFor(s.valueTotal, s.termYears, master.tierRules);
              const hasPdf = v.hasPdf;
              const spCount = s.files.filter((f) => f.kind === "site_plan").length;

              // ----- แถวที่กำลังแก้: ใช้ช่องกรอก/ตัวตรวจ/Tier ชุดเดียวกับแถวร่าง (ล็อกสาขา/ชื่อ/ประเภทลูกค้า) -----
              const edit = edits[s.contractId];
              const editCheck = editChecks.get(s.contractId);
              if (edit && editCheck) {
                const ed = edit.draft;
                const editWarn = editCheck.termYears
                  ? endDateWarning(ed.startDate, ed.endDate, editCheck.termYears)
                  : null;
                return (
                  <DraftTableRow
                    key={s.contractId}
                    mode="edit"
                    rowNo={idx + 1}
                    d={ed}
                    c={editCheck}
                    branchName={v.branch?.zoneName.replace("เขต ", "") ?? ""}
                    branchBad={false}
                    err={(f) => Boolean(editCheck.errors[f])}
                    tier={tierFor(editCheck.valueTotal, editCheck.termYears, master.tierRules)}
                    warn={editWarn}
                    showErrors
                    master={master}
                    fileAttached={hasPdf}
                    fileExtra={spCount}
                    editing={{
                      saving: savingEditId === s.contractId,
                      unchanged: isEditUnchanged(edit.original, ed),
                      onSave: () => void saveEdit(s),
                      onCancel: () => cancelEdit(s.contractId),
                    }}
                    onPatch={(patch) => patchEdit(s.contractId, patch)}
                    onFile={() => setFileTarget({ kind: "saved", contractId: s.contractId })}
                    onRenewal={() => setRenewalFor({ kind: "edit", contractId: s.contractId })}
                    onRemove={() => cancelEdit(s.contractId)}
                  />
                );
              }
              const editBlocked = contractEditBlockReason(s.status);
              return (
                <tr key={s.contractId}>
                  <td className={cx(TD, "num text-center text-fg-muted")}>{idx + 1}</td>
                  <td className={cx(TD, "num")}>{s.contractNo}</td>
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 break-words">{s.customerName}</span>
                      {s.auditCountFailed ? (
                        <span
                          title="นับจำนวนครั้งที่แก้ไขไม่สำเร็จ ลองรีเฟรชหน้า"
                          className="flex-none whitespace-nowrap rounded-full bg-surface-3 px-2 py-0.5 text-[11.5px] text-danger"
                        >
                          ⟲ ประวัติ (โหลดไม่ได้)
                        </span>
                      ) : s.auditCount !== null ? (
                        <button
                          type="button"
                          onClick={() => setHistoryFor(s)}
                          title="ดูประวัติการแก้ไขของสัญญานี้ (เฉพาะ host)"
                          aria-label={`ดูประวัติการแก้ไข ${s.contractNo}`}
                          className="flex-none cursor-pointer whitespace-nowrap rounded-full bg-surface-3 px-2 py-0.5 text-[11.5px] text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          ⟲ ประวัติ (<span className="num">{s.auditCount}</span>)
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className={cx(TD, "text-center")}>
                    {s.isUrgent ? <Chip tone="pend">ด่วน</Chip> : <span className="text-fg-faint">—</span>}
                  </td>
                  <td className={TD}>
                    <Chip tone={s.saleType === "renew" ? "na" : "ok"}>
                      {s.saleType === "renew" ? "Renew" : "New"}
                    </Chip>
                  </td>
                  <td className={TD}>
                    {s.renewedFrom ? (
                      <Chip tone="ok">
                        🔗{" "}
                        {s.renewedFrom.contractNo !== null ? (
                          <span className="num">{s.renewedFrom.contractNo}</span>
                        ) : (
                          <span title="อ่านเลขที่สัญญาเก่าไม่ได้ ลองรีเฟรชหน้า">โหลดไม่ได้</span>
                        )}
                      </Chip>
                    ) : s.saleType === "renew" ? (
                      <Chip tone="miss">⚠ ยังไม่ผูก</Chip>
                    ) : (
                      <Chip tone="na">— งานใหม่ —</Chip>
                    )}
                  </td>
                  <td className={TD}>
                    {s.sellerName || <span className="text-danger">ยังไม่ใส่</span>}
                  </td>
                  <td className={TD}>{s.sellerRole === "am" ? "AM" : "Sale"}</td>
                  <td className={TD}>{v.branch?.name ?? "—"}</td>
                  <td className={TD}>{v.branch?.zoneName.replace("เขต ", "") ?? "—"}</td>
                  <td className={cx(TD, "num")}>{s.mailReceivedDate || "—"}</td>
                  <td className={cx(TD, "num")}>
                    {s.firstServiceDate || <Chip tone="pend">รอนัด</Chip>}
                  </td>
                  <td className={cx(TD, "num")}>{s.firstServiceTime || "—"}</td>
                  <td className={TD}>
                    {s.teamIds.map((id) => teamCode.get(id)).filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className={TD}>
                    {(s.customerTypeCode && typeLabel.get(s.customerTypeCode)) || "—"}
                  </td>
                  <td className={cx(TD, "num")}>{s.startDate}</td>
                  <td className={cx(TD, "num")}>{s.endDate || "—"}</td>
                  <td className={cx(TD, "num text-right")}>
                    {s.termYears === 1 ? formatMoney(s.valueTotal) : ""}
                  </td>
                  <td className={cx(TD, "num text-right")}>
                    {s.termYears === 3 ? formatMoney(s.valueTotal) : ""}
                  </td>
                  <td className={cx(TD, "text-center")}>
                    {tier ? (
                      <TierBadge tier={tier.tier} years={s.termYears} />
                    ) : (
                      <Chip tone="na">—</Chip>
                    )}
                  </td>
                  <td className={cx(TD, "max-w-[200px] truncate")} title={s.note}>
                    {s.note || <span className="text-fg-faint">—</span>}
                  </td>
                  <td className={cx(TD, "text-center")}>
                    <FileChip
                      attached={hasPdf}
                      extra={spCount}
                      onClick={() => setFileTarget({ kind: "saved", contractId: s.contractId })}
                    />
                  </td>
                  <td className={cx(TD, "text-center")}>
                    {s.status === "closed" ? (
                      <Chip tone="na" className="whitespace-nowrap">
                        🔒 ปิดสัญญาแล้ว
                      </Chip>
                    ) : s.status === "cancelled" ? (
                      <Chip tone="na">ยกเลิก</Chip>
                    ) : v.filterable.missing ? (
                      <Chip tone="miss">ขาด ผู้ขาย</Chip>
                    ) : v.warn ? (
                      <Chip tone="pend">{v.warn}</Chip>
                    ) : v.filterable.pendingService ? (
                      <Chip tone="pend">รอนัดบริการ</Chip>
                    ) : (
                      <Chip tone="ok">ครบ</Chip>
                    )}
                  </td>
                  <td className={cx(TD, "whitespace-nowrap text-center")}>
                    <button
                      type="button"
                      onClick={() => startEdit(s)}
                      disabled={editBlocked !== null}
                      aria-label={`แก้สัญญา ${s.contractNo}`}
                      title={editBlocked ?? "แก้สัญญานี้ (สาขาและชื่อลูกค้าแก้ไม่ได้)"}
                      className="mr-1 cursor-pointer rounded px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      แก้
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeSaved(s)}
                      disabled={contractDeleteBlockReason(s.status) !== null}
                      aria-label={`ลบสัญญา ${s.contractNo}`}
                      title={contractDeleteBlockReason(s.status) ?? "ลบสัญญา (ได้เฉพาะที่ยังไม่มีผลบริการ)"}
                      className="cursor-pointer rounded px-1.5 py-0.5 text-danger hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}

            {/* ===== แถวร่าง (กำลังกรอก) ===== */}
            {drafts.map((d, i) => {
              const c = draftChecks[i]!;
              const branch = resolveBranch(d.branchText, master.branches);
              const tier = tierFor(c.valueTotal, c.termYears, master.tierRules);
              const warn = c.termYears ? endDateWarning(d.startDate, d.endDate, c.termYears) : null;
              const err = (f: keyof typeof c.errors) => showErrors && Boolean(c.errors[f]);
              const branchBad =
                d.branchText.trim() !== "" && !branch ? true : showErrors && !!c.errors.branch;
              const rowNo = visibleSaved.length + i + 1;
              return (
                <DraftTableRow
                  key={d.key}
                  rowNo={rowNo}
                  d={d}
                  c={c}
                  branchName={branch?.zoneName.replace("เขต ", "") ?? ""}
                  branchBad={branchBad}
                  err={err}
                  tier={tier}
                  warn={warn}
                  showErrors={showErrors}
                  master={master}
                  onPatch={(patch) => patchDraft(d.key, patch)}
                  onFile={() => setFileTarget({ kind: "draft", key: d.key })}
                  onRenewal={() => setRenewalFor({ kind: "draft", key: d.key })}
                  onRemove={() => removeDraft(d.key)}
                />
              );
            })}

            {visibleSaved.length === 0 && drafts.length === 0 ? (
              <tr>
                <td colSpan={24} className="px-4 py-10 text-center text-[13px] text-fg-muted">
                  {saved.length === 0 ? (
                    <>
                      ยังไม่มีงานที่เปิดใน <b>{monthLabel(month)}</b> — กด <b>+ เพิ่มแถว</b>{" "}
                      เพื่อเริ่มบันทึกงานใหม่
                    </>
                  ) : (
                    <>ไม่พบแถวที่ตรงกับตัวกรอง — ลองกด ✕ ล้างตัวกรอง</>
                  )}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface px-3 py-2">
          <Button size="sm" onClick={() => setDrafts((r) => [...r, createDraft()])}>
            + เพิ่มแถว
          </Button>
          <span className="flex-1" />
          <span className="text-[12px] text-fg-muted">
            บันทึกได้ <b className="num">{readyCount}</b> จาก <b className="num">{drafts.length}</b>{" "}
            แถว · แถวขอบแดงขาดข้อมูลจำเป็น · ยังไม่แนบไฟล์ = เตือน แต่บันทึกต่อได้
          </span>
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            disabled={drafts.length === 0}
            onClick={() => void saveAll()}
          >
            บันทึกเข้าทะเบียน
          </Button>
        </div>
      </div>

      <p className="m-0 text-[11.5px] text-fg-muted">
        ทีม: <b>A–O</b> ทีมบริการประจำ · <b>Z</b> ทีมติดตั้งงานใหม่ · ช่อง เขต / Tier / วันสิ้นสุด
        ระบบคำนวณให้ (ไม่ต้องกรอก)
      </p>

      {/* ---------- กล่องโต้ตอบ ---------- */}
      {draftForDialog ? (
        <FileDialog
          mode="draft"
          supabase={supabase}
          title="ไฟล์แนบ · แถวที่กำลังกรอก"
          subtitle={draftForDialog.contractNo || "ยังไม่ใส่เลขที่สัญญา"}
          pending={draftForDialog.pendingPdf}
          onPick={(file) => patchDraft(draftForDialog.key, { pendingPdf: file })}
          onClose={() => setFileTarget(null)}
        />
      ) : null}
      {savedForDialog ? (
        <FileDialog
          mode="saved"
          supabase={supabase}
          title={`ไฟล์แนบ · ${savedForDialog.contractNo}`}
          subtitle={savedForDialog.customerName}
          contractId={savedForDialog.contractId}
          files={savedForDialog.files}
          locked={savedForDialog.status === "closed"}
          onChanged={() => router.refresh()}
          onClose={() => setFileTarget(null)}
        />
      ) : null}
      {dupPrompt ? (
        <DuplicateCustomerDialog
          customerName={dupPrompt.customerName}
          contractNo={dupPrompt.contractNo}
          matches={dupPrompt.matches}
          typeLabel={(code) => typeLabel.get(code) ?? code}
          onChoose={dupPrompt.resolve}
        />
      ) : null}
      {renewalFor ? (
        <RenewalDialog
          supabase={supabase}
          branchNameOf={(id) => branchById.get(id)?.name ?? ""}
          onClose={() => setRenewalFor(null)}
          onPick={(link: RenewalLink) => {
            const target = renewalFor;
            setRenewalFor(null);
            if (target.kind === "draft") {
              // ลูกค้าเดิม: ใช้ชื่อ/สาขาของลูกค้านั้น (ไม่สร้างลูกค้าใหม่ตอนบันทึก)
              patchDraft(target.key, {
                renewal: link,
                customerName: link.customerName,
                branchText: branchById.get(link.branchId)?.name ?? "",
              });
              return;
            }
            // แก้แถวที่บันทึกแล้ว: ลูกค้า/สาขาล็อกอยู่ — ผูกได้เฉพาะสัญญาเก่าของลูกค้าคนเดียวกัน
            const s = saved.find((x) => x.contractId === target.contractId);
            if (!s) return;
            const verdict = checkRenewalPickForEdit(link, s);
            if (!verdict.ok) {
              setEditError(target.contractId, verdict.error);
              return;
            }
            patchEdit(target.contractId, { renewal: link });
          }}
        />
      ) : null}
      {historyFor ? (
        <HistoryDialog
          supabase={supabase}
          contractId={historyFor.contractId}
          contractNo={historyFor.contractNo}
          onClose={() => setHistoryFor(null)}
        />
      ) : null}

      <Toast message={toast} onClose={() => setToast("")} />
    </div>
  );
}

/** ปุ่มไฟล์แนบ: แนบแล้ว = "[ไอคอน] PDF ✓" (ข้อความคงที่ — เจ้าของตัดสิน) · ยังไม่แนบ = เตือนสีเหลือง */
function FileChip({
  attached,
  extra,
  onClick,
}: {
  attached: boolean;
  extra: number;
  onClick: () => void;
}) {
  return (
    <Chip tone={attached ? "ok" : "pend"} onClick={onClick}>
      <PdfIcon />
      {attached ? "PDF ✓" : "แนบ"}
      {extra > 0 ? <span className="num">· SP {extra}</span> : null}
    </Chip>
  );
}

type DraftErr = (
  f:
    | "contractNo"
    | "customerName"
    | "saleName"
    | "branch"
    | "startDate"
    | "endDate"
    | "mailDate"
    | "serviceDate"
    | "value",
) => boolean;

/** ปุ่ม บันทึก/ยกเลิก ของแถวที่กำลังแก้ (มีเฉพาะ mode="edit") */
type EditingControls = {
  saving: boolean;
  /** ยังไม่ได้แก้อะไร — ปิดปุ่มบันทึก (ไม่ส่งคำสั่งเปล่าที่จะลงประวัติโดยไม่มีอะไรเปลี่ยน) */
  unchanged: boolean;
  onSave: () => void;
  onCancel: () => void;
};

function DraftTableRow({
  mode = "draft",
  fileAttached,
  fileExtra = 0,
  editing,
  rowNo,
  d,
  c,
  branchName,
  branchBad,
  err,
  tier,
  warn,
  showErrors,
  master,
  onPatch,
  onFile,
  onRenewal,
  onRemove,
}: {
  /** draft = แถวใหม่ที่กำลังกรอก · edit = แถวที่บันทึกแล้วที่กำลังแก้ (ล็อกสาขา/ชื่อลูกค้า/ประเภทลูกค้า) */
  mode?: "draft" | "edit";
  /** แถวที่กำลังแก้ใช้ไฟล์ที่แนบไว้จริงในฐานข้อมูลแทนไฟล์รออัปโหลด */
  fileAttached?: boolean;
  fileExtra?: number;
  editing?: EditingControls;
  rowNo: number;
  d: DraftRow;
  c: ReturnType<typeof checkDraft>;
  branchName: string;
  branchBad: boolean;
  err: DraftErr;
  tier: ReturnType<typeof tierFor>;
  warn: string | null;
  showErrors: boolean;
  master: MasterData;
  onPatch: (patch: Partial<DraftRow>) => void;
  onFile: () => void;
  onRenewal: () => void;
  onRemove: () => void;
}) {
  const hasErrors = !canSave(c);
  const isEdit = mode === "edit";
  const termLocked1 = d.value3y.trim() !== "";
  const termLocked3 = d.value1y.trim() !== "";
  const groups = useMemo(() => {
    const map = new Map<string, CustomerTypeOption[]>();
    for (const t of master.customerTypes) {
      map.set(t.groupLabel, [...(map.get(t.groupLabel) ?? []), t]);
    }
    return [...map.entries()];
  }, [master.customerTypes]);

  const money = (value: string, term: TermYears) => {
    const lock = term === 1 ? termLocked1 : termLocked3;
    return (
      <input
        inputMode="decimal"
        disabled={lock}
        aria-label={`มูลค่าสัญญา ${term} ปี`}
        value={value}
        placeholder={lock ? "" : "ยังไม่ใส่"}
        onChange={(e) =>
          onPatch(term === 1 ? { value1y: e.target.value } : { value3y: e.target.value })
        }
        onBlur={() => {
          const raw = value.replace(/[,\s]/g, "");
          if (/^\d+(\.\d{1,2})?$/.test(raw) && Number(raw) > 0) {
            const f = formatMoney(Number(raw));
            onPatch(term === 1 ? { value1y: f } : { value3y: f });
          }
        }}
        className={cx(INPUT, "num text-right", border(!lock && err("value")))}
      />
    );
  };

  return (
    <>
      <tr
        className={cx(
          isEdit && "bg-accent-soft",
          showErrors && hasErrors && "bg-danger-soft",
          warn && !hasErrors && "bg-warn-soft",
        )}
      >
        <td className={cx(TD, "num text-center text-fg-muted")}>{rowNo}</td>
        <td className={TD}>
          <input
            aria-label="เลขที่สัญญา"
            value={d.contractNo}
            autoComplete="off"
            title={c.errors.contractNo ?? ""}
            onChange={(e) => onPatch({ contractNo: normalizeContractNo(e.target.value) })}
            className={cx(INPUT, "num", border(err("contractNo") || (d.contractNo !== "" && Boolean(c.errors.contractNo))))}
          />
        </td>
        <td className={TD}>
          <input
            aria-label="ชื่อลูกค้า"
            value={d.customerName}
            autoComplete="off"
            readOnly={isEdit || d.renewal !== null}
            title={
              isEdit
                ? EDIT_LOCK_REASONS.customerName
                : d.renewal
                  ? "ลูกค้าเดิมตามสัญญาที่ผูกไว้ — แก้ชื่อไม่ได้"
                  : ""
            }
            onChange={(e) => onPatch({ customerName: e.target.value })}
            className={cx(
              INPUT,
              border(err("customerName")),
              (isEdit || d.renewal) && "bg-surface-2 text-fg-muted",
            )}
          />
        </td>
        <td className={cx(TD, "text-center")}>
          <input
            type="checkbox"
            aria-label="เบิกด่วน"
            checked={d.isUrgent}
            onChange={(e) => onPatch({ isUrgent: e.target.checked })}
          />
        </td>
        <td className={TD}>
          <div role="group" aria-label="ประเภทงาน" className="inline-flex overflow-hidden rounded-md border border-border-strong text-[12px]">
            {(["new", "renew"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={d.saleType === t}
                onClick={() => onPatch(t === "new" ? { saleType: t, renewal: null } : { saleType: t })}
                className={cx(
                  "cursor-pointer px-2 py-1 focus-visible:outline-2 focus-visible:outline-accent",
                  d.saleType === t ? "bg-accent text-accent-fg" : "bg-surface text-fg-muted hover:bg-surface-2",
                )}
              >
                {t === "new" ? "New" : "Renew"}
              </button>
            ))}
          </div>
        </td>
        <td className={TD}>
          {d.saleType === "new" ? (
            <Chip tone="na">— งานใหม่ —</Chip>
          ) : (
            <div className="flex items-center gap-1">
              <Chip tone={d.renewal ? "ok" : "miss"} onClick={onRenewal}>
                {d.renewal ? (
                  <>
                    🔗 <span className="num">{d.renewal.contractNo}</span>
                  </>
                ) : (
                  "⚠ ยังไม่ผูก · ค้นหา"
                )}
              </Chip>
              {d.renewal ? (
                <button
                  type="button"
                  aria-label="เลิกผูกลูกค้าเดิม"
                  title="เลิกผูกลูกค้าเดิม"
                  onClick={() => onPatch({ renewal: null })}
                  className="cursor-pointer rounded px-1 text-fg-muted hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  ✕
                </button>
              ) : null}
            </div>
          )}
        </td>
        <td className={TD}>
          <input
            aria-label="ผู้ขาย"
            value={d.saleName}
            autoComplete="off"
            placeholder="ยังไม่ใส่"
            onChange={(e) => onPatch({ saleName: e.target.value })}
            className={cx(INPUT, border(err("saleName")))}
          />
        </td>
        <td className={TD}>
          <select
            aria-label="ตำแหน่งผู้ขาย"
            value={d.sellerRole}
            onChange={(e) => onPatch({ sellerRole: e.target.value as "sale" | "am" })}
            className={cx(INPUT, "border-border-strong")}
          >
            <option value="sale">Sale</option>
            <option value="am">AM</option>
          </select>
        </td>
        <td className={TD}>
          <input
            aria-label="สาขา"
            list="branch-list"
            value={d.branchText}
            autoComplete="off"
            placeholder="พิมพ์ชื่อสาขา…"
            readOnly={isEdit || d.renewal !== null}
            title={
              isEdit
                ? EDIT_LOCK_REASONS.branch
                : d.renewal
                  ? "สาขาของลูกค้าเดิม — แก้ไม่ได้"
                  : branchBad
                    ? "ไม่พบสาขานี้ในรายการ — เลือกจากที่ระบบเดาให้"
                    : ""
            }
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => onPatch({ branchText: e.target.value })}
            className={cx(INPUT, border(branchBad), (isEdit || d.renewal) && "bg-surface-2 text-fg-muted")}
          />
        </td>
        <td className={cx(TD, "text-center")}>
          {branchName ? (
            <Chip tone="na">{branchName}</Chip>
          ) : (
            <span className="text-fg-faint">—</span>
          )}
        </td>
        <td className={TD}>
          <input
            type="date"
            aria-label="วันที่รับ Mail"
            value={d.mailReceivedDate}
            onChange={(e) => onPatch({ mailReceivedDate: e.target.value })}
            className={cx(INPUT, "num", border(err("mailDate")))}
          />
        </td>
        <td className={TD}>
          <input
            type="date"
            aria-label="วันที่บริการ"
            value={d.firstServiceDate}
            title="ยังไม่นัด = ปล่อยว่าง (สถานะ รอนัดบริการ) เติมทีหลังได้"
            onChange={(e) =>
              onPatch(
                e.target.value
                  ? { firstServiceDate: e.target.value }
                  : { firstServiceDate: "", firstServiceTime: "" },
              )
            }
            className={cx(INPUT, "num", border(err("serviceDate")), !d.firstServiceDate && "border-warn")}
          />
        </td>
        <td className={TD}>
          <select
            aria-label="เวลาบริการ"
            value={d.firstServiceTime}
            disabled={!d.firstServiceDate}
            onChange={(e) => onPatch({ firstServiceTime: e.target.value })}
            className={cx(INPUT, "num border-border-strong")}
          >
            <option value="">— เลือก —</option>
            {SERVICE_TIME_SLOTS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </td>
        <td className={TD}>
          <TeamPicker
            teams={master.teams}
            value={d.teamIds}
            label="ทีมที่ดูแล"
            onChange={(ids) => onPatch({ teamIds: ids })}
          />
        </td>
        <td className={TD}>
          <select
            aria-label="ประเภทลูกค้า"
            value={d.customerTypeCode}
            disabled={isEdit}
            title={isEdit ? EDIT_LOCK_REASONS.customerType : ""}
            onChange={(e) => onPatch({ customerTypeCode: e.target.value })}
            className={cx(INPUT, "border-border-strong")}
          >
            <option value="">— เลือก —</option>
            {groups.map(([label, items]) => (
              <optgroup key={label} label={label}>
                {items.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </td>
        <td className={TD}>
          <input
            type="date"
            aria-label="วันเริ่มสัญญา"
            value={d.startDate}
            onChange={(e) => onPatch({ startDate: e.target.value })}
            className={cx(INPUT, "num", border(err("startDate")))}
          />
        </td>
        <td className={TD}>
          <input
            type="date"
            aria-label="วันสิ้นสุดสัญญา"
            value={d.endDate}
            title={warn ?? "ระบบเติมให้ = วันเริ่ม + ระยะสัญญา − 1 วัน แก้ได้"}
            onChange={(e) => onPatch({ endDate: e.target.value, endTouched: true })}
            className={cx(INPUT, "num", err("endDate") ? "border-danger" : warn ? "border-warn" : "border-border-strong")}
          />
        </td>
        <td className={TD}>{money(d.value1y, 1)}</td>
        <td className={TD}>{money(d.value3y, 3)}</td>
        <td className={cx(TD, "text-center")}>
          {tier && c.termYears ? (
            <TierBadge tier={tier.tier} years={c.termYears} />
          ) : (
            <Chip tone="na">—</Chip>
          )}
        </td>
        <td className={TD}>
          <input
            aria-label="หมายเหตุ"
            value={d.note}
            maxLength={500}
            autoComplete="off"
            onChange={(e) => onPatch({ note: e.target.value })}
            className={cx(INPUT, "border-border-strong")}
          />
        </td>
        <td className={cx(TD, "text-center")}>
          <FileChip
            attached={fileAttached ?? d.pendingPdf !== null}
            extra={fileExtra}
            onClick={onFile}
          />
        </td>
        <td className={cx(TD, "text-center")}>
          {hasErrors ? (
            <Chip tone="miss">{showErrors || missingLabel(c) ? missingLabel(c) : "ยังไม่ครบ"}</Chip>
          ) : warn ? (
            <Chip tone="pend">{warn}</Chip>
          ) : c.pendingService ? (
            <Chip tone="pend">รอนัดบริการ</Chip>
          ) : (
            <Chip tone="ok">ครบ</Chip>
          )}
        </td>
        <td className={cx(TD, "text-center")}>
          {editing ? (
            <div className="flex flex-col gap-1">
              <Button
                size="sm"
                variant="primary"
                loading={editing.saving}
                disabled={editing.unchanged}
                title={editing.unchanged ? "ยังไม่ได้แก้อะไร" : "บันทึกการแก้ไขสัญญานี้"}
                aria-label={`บันทึกการแก้ไขสัญญา ${d.contractNo}`}
                onClick={editing.onSave}
              >
                บันทึก
              </Button>
              <Button
                size="sm"
                disabled={editing.saving}
                title="ยกเลิกการแก้ — คืนค่าเดิม"
                aria-label={`ยกเลิกการแก้สัญญา ${d.contractNo}`}
                onClick={editing.onCancel}
              >
                ยกเลิก
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`เอาแถวที่ ${rowNo} ออก`}
              title="เอาแถวนี้ออก (ยังไม่บันทึก)"
              className="cursor-pointer rounded px-1.5 py-0.5 text-fg-muted hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent"
            >
              ✕
            </button>
          )}
        </td>
      </tr>
      {d.saveError ? (
        <tr className="bg-danger-soft">
          <td />
          <td colSpan={23} className="px-2 py-1 text-[12.5px] text-danger" role="alert">
            {isEdit ? "แก้สัญญานี้ไม่สำเร็จ" : "บันทึกแถวนี้ไม่สำเร็จ"}: {d.saveError}
          </td>
        </tr>
      ) : null}
    </>
  );
}
