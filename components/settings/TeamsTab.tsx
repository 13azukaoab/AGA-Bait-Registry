"use client";

/**
 * แท็บ "ทีม" + เกณฑ์ Workload (mockup FINAL settings.html · M22 / M25 / M33)
 *
 * Logic summary:
 *   * ปุ่มเปิด/ปิดทีมเรียก RPC `set_team_active` (host เท่านั้น — TM006) · ทีมระบบ (Sup) ปิดไม่ได้ (TM002) → สวิตช์ล็อก + ไอคอนกุญแจ
 *   * `headcount` (คนภาคสนาม) 0 = แสดง "—" (ชม./คน หารศูนย์ไม่ได้) · แก้ได้ในฟอร์มแก้ไขทีม
 *   * เพิ่มทีม: รหัส 1–4 ตัว ไม่ซ้ำแบบไม่สนตัวพิมพ์ แก้ไม่ได้หลังสร้าง · ประเภททีมต้องเลือก · ทีมใหม่เป็นส่วนกลาง (เฟส 1)
 *   * เปลี่ยนเป็น "ทีมหัวหน้างาน" ขณะมีงานผูก = TM003 · ลบทีมที่มีงานผูก = TM001 (ให้ DB ตัดสิน — ไม่เดาจากตัวเลขในตาราง)
 *   * เกณฑ์ Workload: อ่าน/เขียนผ่าน `app_settings` (RPC `save_workload_threshold`) พิมพ์ "ยืนยันแก้ไข" ก่อนบันทึก
 *   * กดหัวคอลัมน์เรียงตารางได้ (ปุ่มใน <th aria-sort> · กดซ้ำสลับทิศ) · ตรรกะอยู่ `teamSort.ts` · ค่าเริ่มต้น = รหัสทีม A→Z
 *   * คอลัมน์ "สัญญาที่ใช้งานอยู่" = จำนวนสัญญาสถานะ active ที่ผูกกับทีม (mockup เรียก "งานเปิดอยู่เดือนนี้" — ดูรายงาน)
 */
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Modal } from "@/components/customers-new/Modal";
import { useUnsavedWork } from "@/components/shell/unsaved-work";
import { Alert, Button, Chip, Field, cx, type ChipTone } from "@/components/ui";
import { TEAM_KINDS, TEAM_KIND_LABEL, type TeamKind } from "@/lib/service/teamKind";

import {
  createTeamAction,
  deleteTeamAction,
  saveTeamWorkloadAction,
  saveWorkloadAction,
  setTeamActiveAction,
  updateTeamAction,
} from "./settingsActions";
import type { SettingsData } from "./settingsData";
import { Card, ConfirmField, DialogError, DialogFooter, MOBILE_BTN, MOBILE_INPUT, SwitchButton } from "./parts";
import {
  CONFIRM_PHRASE,
  WORKLOAD_MAX,
  canDeactivate,
  canOfferDelete,
  headcountLabel,
  teamWorkloadDraftValue,
  teamWorkloadLabel,
  validateTeam,
  validateTeamWorkloadDraft,
  validateWorkload,
  type TeamDraft,
  type TeamRow,
} from "./settingsLogic";
import {
  DEFAULT_TEAM_SORT,
  nextTeamSort,
  sortTeams,
  teamColumnOf,
  teamSortAnnouncement,
  type TeamSortColumn,
  type TeamSortKey,
  type TeamSortState,
} from "./teamSort";
import { formatMoney, parseMoney } from "./tierLogic";

const KIND_TONE: Record<TeamKind, ChipTone> = { service: "info", install: "ok", supervisor: "pend" };

type Dialog =
  | { kind: "form"; team: TeamRow | null }
  | { kind: "delete"; team: TeamRow }
  | { kind: "workload"; team: TeamRow };

export function TeamsTab({ data, onToast }: { data: SettingsData; onToast: (m: string) => void }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [sort, setSort] = useState<TeamSortState>(DEFAULT_TEAM_SORT);
  const [sortNotice, setSortNotice] = useState("");
  const teams = useMemo(() => sortTeams(data.teams, sort), [data.teams, sort]);
  const activeCount = teams.filter((t) => t.isActive).length;

  const close = () => {
    setDialog(null);
    setError("");
  };

  const onSort = (key: TeamSortKey) => {
    const next = nextTeamSort(sort, key);
    setSort(next);
    setSortNotice(teamSortAnnouncement(next));
  };

  const toggle = (t: TeamRow) => {
    setBusyId(t.id);
    startTransition(async () => {
      const res = await setTeamActiveAction(t.id, !t.isActive);
      setBusyId(null);
      if (!res.ok) return onToast(res.message);
      onToast(
        t.isActive
          ? `พักทีม ${t.code} แล้ว · ไม่ขึ้นให้เลือกในงานใหม่ (งานเดิมยังอยู่)`
          : `เปิดใช้งานทีม ${t.code} แล้ว`,
      );
      router.refresh();
    });
  };

  return (
    <div>
      <WorkloadCard hours={data.workloadHours} onToast={onToast} />

      <Card
        className="mt-4"
        title="รายชื่อทีม"
        sub={`${teams.length} ทีม · เปิดใช้งาน ${activeCount}`}
        right={
          <Button variant="add" onClick={() => setDialog({ kind: "form", team: null })}>
            เพิ่มทีม
          </Button>
        }
      >
        <div role="status" aria-live="polite" className="sr-only">
          {sortNotice}
        </div>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[13px] max-[640px]:min-w-[760px]">
            <thead>
              <tr className="bg-surface-2 text-left text-xs text-fg-muted">
                <SortTh col={teamColumnOf("code")} sort={sort} onSort={onSort} />
                <SortTh col={teamColumnOf("name")} sort={sort} onSort={onSort} />
                <SortTh col={teamColumnOf("kind")} sort={sort} onSort={onSort} />
                <SortTh col={teamColumnOf("headcount")} sort={sort} onSort={onSort} align="right" />
                <SortTh col={teamColumnOf("workload")} sort={sort} onSort={onSort} />
                <SortTh col={teamColumnOf("contracts")} sort={sort} onSort={onSort} align="right" className="max-[640px]:hidden" />
                <SortTh col={teamColumnOf("active")} sort={sort} onSort={onSort} />
                <th scope="col" className="px-3.5 py-2"><span className="sr-only">จัดการ</span></th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id} className={cx("border-t border-border align-middle", !t.isActive && "opacity-60")}>
                  <td className="px-3.5 py-2.5 font-semibold">
                    {t.code}
                    {t.isSystem ? (
                      <span className="ml-1.5 inline-flex items-center gap-1 text-xs font-normal text-fg-muted" title="ทีมระบบ ลบหรือปิดใช้ไม่ได้">
                        <LockIcon /> ทีมระบบ
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3.5 py-2.5">{t.name}</td>
                  <td className="px-3.5 py-2.5">
                    <Chip tone={KIND_TONE[t.kind]}>{TEAM_KIND_LABEL[t.kind]}</Chip>
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums" aria-label={t.headcount > 0 ? undefined : "ยังไม่ระบุจำนวนคน"}>
                    {headcountLabel(t.headcount)}
                  </td>
                  <td className="px-3.5 py-2.5" data-testid={`team-workload-${t.code}`}>
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <WorkloadBadge team={t} />
                      <button
                        type="button"
                        onClick={() => setDialog({ kind: "workload", team: t })}
                        aria-label={`ตั้งเกณฑ์ภาระงานของทีม ${t.code}`}
                        className={cx(
                          "inline-flex min-h-7 items-center rounded-md px-1.5 text-xs font-medium text-accent underline-offset-2 hover:underline",
                          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                          "max-[640px]:min-h-11",
                        )}
                      >
                        ตั้งเกณฑ์
                      </button>
                    </div>
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums max-[640px]:hidden">
                    {t.activeContracts === null ? "—" : formatMoney(t.activeContracts)}
                  </td>
                  <td className="px-3.5 py-2.5">
                    <SwitchButton
                      checked={t.isActive}
                      disabled={busyId === t.id || (t.isActive && !canDeactivate(t))}
                      label={`${t.isActive ? "ปิด" : "เปิด"}ใช้งานทีม ${t.code}`}
                      onClick={() => toggle(t)}
                    />
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" className="max-[640px]:min-h-11" onClick={() => setDialog({ kind: "form", team: t })}>
                        แก้ไข
                      </Button>
                      {canOfferDelete(t) ? (
                        <Button size="sm" variant="danger" className="max-[640px]:min-h-11" onClick={() => setDialog({ kind: "delete", team: t })}>
                          ลบ
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0 border-t border-border px-4 py-3 text-xs text-fg-muted">
          ในตารางเปิดงาน 1 สัญญาเลือกได้หลายทีมพร้อมกัน (เช่น A+E+Z) · ทีมที่ปิดใช้งานจะไม่อยู่ในตัวเลือกให้เลือกใหม่
          แต่สัญญาเดิมที่ผูกไว้ยังคงอยู่ · <b>ทีมระบบ</b> = ทีมพิเศษที่ระบบใช้ทำงาน ตอนนี้มีทีมเดียวคือ Sup (หัวหน้างาน)
          จึงลบหรือปิดใช้ไม่ได้ · ทีมอื่นลบได้เมื่อไม่มีงานผูกอยู่ ถ้ามีงานผูกอยู่ให้ปิดใช้งานแทน
        </p>
      </Card>

      {dialog?.kind === "form" ? (
        <TeamForm
          team={dialog.team}
          existingCodes={teams.map((t) => t.code)}
          error={error}
          pending={pending}
          onClose={close}
          onSubmit={(d) =>
            startTransition(async () => {
              setError("");
              if (d.kind === "") return;
              const headcount = Number(d.headcount.trim());
              const res = dialog.team
                ? await updateTeamAction({ teamId: dialog.team.id, name: d.name, kind: d.kind, headcount })
                : await createTeamAction({ code: d.code, name: d.name, kind: d.kind, headcount });
              if (!res.ok) return setError(res.message);
              close();
              onToast(dialog.team ? `บันทึกทีม ${dialog.team.code} แล้ว` : `เพิ่มทีม ${d.code.trim()} แล้ว · บันทึกลงประวัติการแก้ไข`);
              router.refresh();
            })
          }
        />
      ) : null}

      {dialog?.kind === "workload" ? (
        <TeamWorkloadDialog
          team={dialog.team}
          centralHours={data.workloadHours}
          onClose={close}
          onSaved={(msg) => {
            close();
            onToast(msg);
            router.refresh();
          }}
        />
      ) : null}

      {dialog?.kind === "delete" ? (
        <Modal title={`ลบทีม ${dialog.team.code}`} onClose={close}>
          <p className="m-0 mb-2 text-[13px]">
            ลบทีม {dialog.team.code} ({dialog.team.name})? ลบได้เมื่อไม่มีงานผูกอยู่ (สัญญา · การเข้าบริการ · ผู้ใช้)
            ถ้ามีงานผูกอยู่ ระบบจะไม่ลบให้ — ให้ปิดใช้งานทีมแทน
          </p>
          <DialogError message={error} />
          <DialogFooter>
            <Button className={MOBILE_BTN} onClick={close}>ยกเลิก</Button>
            <Button
              className={MOBILE_BTN}
              variant="danger"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  setError("");
                  const res = await deleteTeamAction(dialog.team.id);
                  if (!res.ok) return setError(res.message);
                  close();
                  onToast(`ลบทีม ${dialog.team.code} แล้ว · บันทึกลงประวัติการแก้ไข`);
                  router.refresh();
                })
              }
            >
              ลบทีม
            </Button>
          </DialogFooter>
        </Modal>
      ) : null}
    </div>
  );
}

/** หัวคอลัมน์ที่กดเรียงได้ — ปุ่มใน <th aria-sort> (คีย์บอร์ดกด Enter/Space ได้) · ไม่ตัดคำ · มือถือสูง ≥ 44px */
function SortTh({
  col,
  sort,
  onSort,
  align,
  className,
}: {
  col: TeamSortColumn;
  sort: TeamSortState;
  onSort: (key: TeamSortKey) => void;
  align?: "right";
  className?: string;
}) {
  const active = sort.key === col.key;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cx("px-3.5 py-1.5 font-medium", align === "right" && "text-right", active && "text-fg", className)}
    >
      <button
        type="button"
        onClick={() => onSort(col.key)}
        className="-mx-1.5 -my-1 inline-flex min-h-[30px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-transparent px-1.5 py-1 text-xs font-semibold text-inherit hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent max-[640px]:min-h-11"
      >
        {col.label}
        <span aria-hidden="true" className="inline-flex flex-col gap-px text-[10px] leading-none">
          <i className={cx("not-italic", active && sort.dir === "asc" ? "text-accent-strong" : "opacity-35")}>▲</i>
          <i className={cx("not-italic", active && sort.dir === "desc" ? "text-accent-strong" : "opacity-35")}>▼</i>
        </span>
      </button>
    </th>
  );
}

function WorkloadBadge({ team }: { team: TeamRow }) {
  const label = teamWorkloadLabel(team);
  return label.custom ? (
    <span className="font-semibold tabular-nums">{label.text}</span>
  ) : (
    <span className="text-xs text-fg-muted">{label.text}</span>
  );
}

/**
 * Dialog ตั้งเกณฑ์ภาระงานรายทีม (host) — ใส่ตัวเลข หรือกด "กลับไปใช้ค่ากลาง" (ส่ง null) · ต้องพิมพ์ "ยืนยันแก้ไข" ก่อนบันทึก
 * บันทึกผ่าน saveTeamWorkloadAction → RPC save_team_workload_hours (DB ตรวจ host + ช่วงค่า + ยืนยันซ้ำ)
 */
function TeamWorkloadDialog({
  team,
  centralHours,
  onClose,
  onSaved,
}: {
  team: TeamRow;
  centralHours: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const initialText = team.workloadHours === null ? "" : formatMoney(team.workloadHours);
  const initialCentral = team.workloadHours === null;
  const [text, setText] = useState(initialText);
  const [useCentral, setUseCentral] = useState(initialCentral);
  const [confirm, setConfirm] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [serverError, setServerError] = useState("");
  const [pending, startTransition] = useTransition();

  const fieldError = validateTeamWorkloadDraft(text, useCentral);
  const value = teamWorkloadDraftValue(text, useCentral);
  const dirty = useCentral !== initialCentral || (!useCentral && value !== team.workloadHours);
  useUnsavedWork(dirty);

  const save = () => {
    if (confirm.trim() !== CONFIRM_PHRASE) {
      setConfirmError(`พิมพ์คำว่า "${CONFIRM_PHRASE}" ให้ตรงก่อนจึงจะบันทึกได้`);
      return;
    }
    setConfirmError("");
    setServerError("");
    startTransition(async () => {
      const res = await saveTeamWorkloadAction({ teamId: team.id, hours: value, confirm });
      if (!res.ok) return setServerError(res.message);
      onSaved(
        res.workloadHours === null
          ? `ทีม ${team.code} กลับไปใช้ค่ากลางแล้ว · บันทึกลงประวัติการแก้ไข`
          : `บันทึกเกณฑ์ทีม ${team.code} ${formatMoney(res.workloadHours)} ชม./คน/เดือนแล้ว · บันทึกลงประวัติการแก้ไข`,
      );
    });
  };

  return (
    <Modal title={`เกณฑ์ภาระงานทีม ${team.code}`} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && fieldError === null) save();
        }}
      >
        <p className="m-0 text-xs text-fg-muted">
          ค่ากลาง (ใช้กับทีมที่ไม่ได้ตั้งเอง) = <b className="tabular-nums">{formatMoney(centralHours)}</b> ชม./คน/เดือน
        </p>
        <Field
          label="เกณฑ์ของทีมนี้ (ชม./คน/เดือน)"
          error={dirty ? (fieldError ?? undefined) : undefined}
          hint={useCentral ? "ตอนนี้ทีมนี้ใช้ค่ากลาง — พิมพ์ตัวเลขเพื่อตั้งเฉพาะทีม" : `ตั้งได้ 0.01–${WORKLOAD_MAX} ทศนิยมไม่เกิน 2 ตำแหน่ง`}
        >
          {(c) => (
            <input
              {...c}
              className={cx(c.className, MOBILE_INPUT)}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="เช่น 40"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setUseCentral(e.target.value.trim() === "");
              }}
            />
          )}
        </Field>
        <div>
          <Button
            className={MOBILE_BTN}
            size="sm"
            disabled={useCentral}
            onClick={() => {
              setUseCentral(true);
              setText("");
            }}
          >
            กลับไปใช้ค่ากลาง
          </Button>
        </div>
        {dirty && fieldError === null ? (
          <Alert variant="warn">
            {value === null
              ? `ทีม ${team.code} จะกลับไปใช้ค่ากลาง ${formatMoney(centralHours)} ชม./คน/เดือน`
              : `ทีม ${team.code} จะใช้เกณฑ์ ${formatMoney(value)} ชม./คน/เดือน แทนค่ากลาง`}
          </Alert>
        ) : null}
        <ConfirmField phrase={CONFIRM_PHRASE} value={confirm} onChange={setConfirm} error={confirmError} />
        <DialogError message={serverError} />
        <DialogFooter>
          <Button className={MOBILE_BTN} onClick={onClose}>ยกเลิก</Button>
          <Button
            className={MOBILE_BTN}
            variant="primary"
            type="submit"
            loading={pending}
            disabled={!dirty || fieldError !== null}
          >
            บันทึก
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function TeamForm({
  team,
  existingCodes,
  error,
  pending,
  onClose,
  onSubmit,
}: {
  team: TeamRow | null;
  existingCodes: string[];
  error: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (d: TeamDraft) => void;
}) {
  const initial: TeamDraft = {
    code: team?.code ?? "",
    name: team?.name ?? "",
    kind: team?.kind ?? "",
    headcount: String(team?.headcount ?? 0),
  };
  const [d, setD] = useState<TeamDraft>(initial);
  const [errors, setErrors] = useState<ReturnType<typeof validateTeam>>({});
  useUnsavedWork(JSON.stringify(d) !== JSON.stringify(initial));
  const mode = team ? "edit" : "create";
  const kindLocked = team?.isSystem === true;

  return (
    <Modal title={team ? `แก้ไขทีม ${team.code}` : "เพิ่มทีม"} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const found = validateTeam(d, mode, existingCodes);
          setErrors(found);
          if (Object.keys(found).length === 0) onSubmit(d);
        }}
      >
        <Field
          label="รหัสทีม"
          required={!team}
          error={errors.code}
          hint={team ? "แก้รหัสไม่ได้ (ถูกอ้างในสัญญาและข้อมูลภาระงานรายทีม)" : "ตัวอักษร/ตัวเลข 1–4 ตัว ซ้ำไม่ได้ (ไม่สนตัวพิมพ์) · สร้างแล้วแก้ไม่ได้"}
        >
          {(c) => (
            <input
              {...c}
              className={cx(c.className, MOBILE_INPUT)}
              type="text"
              maxLength={4}
              autoComplete="off"
              readOnly={!!team}
              value={d.code}
              onChange={(e) => setD((x) => ({ ...x, code: e.target.value }))}
            />
          )}
        </Field>
        <Field label="ชื่อ / คำอธิบาย" required error={errors.name}>
          {(c) => (
            <input
              {...c}
              className={cx(c.className, MOBILE_INPUT)}
              type="text"
              maxLength={60}
              autoComplete="off"
              value={d.name}
              onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))}
            />
          )}
        </Field>
        <Field
          label="ประเภททีม"
          required
          error={errors.kind}
          hint={kindLocked ? "ทีมระบบ เปลี่ยนประเภทไม่ได้" : "เปลี่ยนเป็นทีมหัวหน้างานไม่ได้ถ้าทีมนี้มีงานผูกอยู่"}
        >
          {(c) => (
            <select
              {...c}
              className={cx(c.className, MOBILE_INPUT)}
              disabled={kindLocked}
              value={d.kind}
              onChange={(e) => setD((x) => ({ ...x, kind: e.target.value as TeamKind }))}
            >
              <option value="">— เลือกประเภท —</option>
              {TEAM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {TEAM_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="จำนวนคนภาคสนาม" error={errors.headcount} hint="0 = ยังไม่ระบุ (ชม./คน จะแสดง —)">
          {(c) => (
            <input
              {...c}
              className={cx(c.className, MOBILE_INPUT)}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              value={d.headcount}
              onChange={(e) => setD((x) => ({ ...x, headcount: e.target.value }))}
            />
          )}
        </Field>
        <DialogError message={error} />
        <DialogFooter>
          <Button className={MOBILE_BTN} onClick={onClose}>ยกเลิก</Button>
          <Button className={MOBILE_BTN} variant="primary" type="submit" loading={pending}>
            บันทึก
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}

function WorkloadCard({ hours, onToast }: { hours: number; onToast: (m: string) => void }) {
  const router = useRouter();
  const [text, setText] = useState(formatMoney(hours));
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [serverError, setServerError] = useState("");
  const [pending, startTransition] = useTransition();

  const value = parseMoney(text);
  const fieldError = validateWorkload(value);
  const dirty = value !== hours;
  useUnsavedWork(dirty);

  const save = () => {
    if (confirm.trim() !== CONFIRM_PHRASE) {
      setConfirmError(`พิมพ์คำว่า "${CONFIRM_PHRASE}" ให้ตรงก่อนจึงจะบันทึกได้`);
      return;
    }
    setConfirmError("");
    setServerError("");
    startTransition(async () => {
      const res = await saveWorkloadAction({ hours: value ?? 0, confirm });
      if (!res.ok) return setServerError(res.message);
      setOpen(false);
      setConfirm("");
      onToast(`บันทึกเกณฑ์ Workload ${formatMoney(res.saved)} ชม./คน/เดือนแล้ว · บันทึกลงประวัติการแก้ไข`);
      router.refresh();
    });
  };

  return (
    <Card title="เกณฑ์ Workload" sub="ใช้กับทุกทีม · ทุกคนเห็นค่าเดียวกัน">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3.5">
        <div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-label="เกณฑ์ Workload (ชั่วโมงต่อคนต่อเดือน)"
              aria-invalid={dirty && fieldError ? true : undefined}
              aria-describedby="wlErr"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={cx(
                "w-[110px] rounded-lg border bg-surface px-2.5 py-1.5 text-right text-[13px] tabular-nums text-fg",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                MOBILE_INPUT,
                dirty && fieldError ? "border-danger" : "border-border-strong",
              )}
            />
            <span className="text-xs text-fg-muted">ชม. / คน / เดือน</span>
          </div>
          <div id="wlErr" role="alert" className="mt-1 text-xs text-danger">
            {dirty && fieldError ? fieldError : ""}
          </div>
          {dirty && !fieldError ? <div className="mt-1 text-xs text-fg-muted">เดิม {formatMoney(hours)}</div> : null}
        </div>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button className={MOBILE_BTN} size="sm" disabled={!dirty} onClick={() => setText(formatMoney(hours))}>
            ยกเลิกการแก้
          </Button>
          <Button variant="save" disabled={!dirty || fieldError !== null} onClick={() => setOpen(true)}>
            บันทึกเกณฑ์…
          </Button>
        </span>
      </div>
      <p className="m-0 border-t border-border px-4 py-3 text-xs text-fg-muted">
        ชั่วโมงงานต่อคนภาคสนามต่อเดือนที่ถือว่าเต็มกำลัง ใช้เทียบกับงานที่ทีมถือ (ช่วงที่ตั้งได้ 0.01–{WORKLOAD_MAX}) ·
        ผู้ดูแลระบบ (PM / OM / เจ้าของ) แก้ได้ ตำแหน่งอื่นดูได้อย่างเดียว
      </p>

      {open ? (
        <Modal title="บันทึกเกณฑ์ Workload" onClose={() => setOpen(false)}>
          <p className="m-0 mb-1.5 text-xs text-fg-muted">สิ่งที่จะเปลี่ยน</p>
          <p className="m-0 mb-3 text-[13px]">
            เกณฑ์ Workload <b className="tabular-nums">{formatMoney(hours)}</b> → <b className="tabular-nums">{value === null ? "—" : formatMoney(value)}</b> ชม./คน/เดือน
          </p>
          <Alert variant="warn">การเปลี่ยนเกณฑ์มีผลกับการแสดง Workload ของทุกทีมทันที</Alert>
          <div className="mt-3">
            <ConfirmField phrase={CONFIRM_PHRASE} value={confirm} onChange={setConfirm} error={confirmError} />
          </div>
          <DialogError message={serverError} />
          <DialogFooter>
            <Button className={MOBILE_BTN} onClick={() => setOpen(false)}>ยกเลิก</Button>
            <Button className={MOBILE_BTN} variant="primary" loading={pending} onClick={save}>
              บันทึก
            </Button>
          </DialogFooter>
        </Modal>
      ) : null}
    </Card>
  );
}
