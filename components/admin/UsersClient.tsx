"use client";

/**
 * หน้า "จัดการผู้ใช้" ฝั่ง client (mockup FINAL `docs/mockup/admin-user-management.html`)
 *
 * Logic summary:
 *   * รับบัญชี + ตำแหน่งจาก server (page.tsx) · ทุกการเขียนเรียก server action (`userActions.ts`) ที่ตรวจ host ซ้ำ
 *     แล้ว `router.refresh()` ให้ได้ข้อมูลจริงกลับมา — หน้านี้ไม่เก็บ "ข้อมูลสมมติ" ในหน่วยความจำ
 *   * รหัสผ่านชั่วคราว (สร้าง/รีเซ็ต) อยู่ใน state ของ dialog เท่านั้น: แสดงครั้งเดียว ปิดแล้วหายทันที ไม่ใส่ URL/storage/log
 *   * ปุ่มของบัญชีเจ้าของ (ตำแหน่ง assignable=false) ปิดไว้ + มีเหตุผล · server ปฏิเสธซ้ำ (PS003) แม้ยิงตรง
 *   * ฟอร์มที่แก้ค้างลงทะเบียนด้วย `useUnsavedWork` (กันอัปเดตเวอร์ชันรีโหลดทับ)
 *   * M38: ป้าย "รอแจ้งผู้ใช้" = ผู้ใช้ยังไม่ได้อ่านแจ้งเตือน "ตำแหน่งถูกเปลี่ยน" (RPC `list_notification_read_status` ผ่าน userData.ts
 *     · host เท่านั้น · ไม่เห็นเนื้อหา) · RPC ล้ม = ไม่แสดงป้าย หน้ายังใช้ได้
 *   * บัญชีเจ้าของแก้จากหน้านี้ไม่ได้ (userAdmin PS003) จึงไม่มี "ตำแหน่งเจ้าของ" ในฟอร์มแก้ไข
 */
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";

import { Modal } from "@/components/customers-new/Modal";
import { useUnsavedWork } from "@/components/shell/unsaved-work";
import { Alert, Button, Chip, Field, Toast, cx, type ChipTone } from "@/components/ui";

import {
  createUserAction,
  resetPasswordAction,
  setActiveAction,
  updateUserAction,
} from "./userActions";
import {
  CONFIRM_PHRASE,
  EMPTY_FILTER,
  activeHostCount,
  canManageRow,
  computeStats,
  formatLastLogin,
  matchesFilter,
  nameOf,
  positionOf,
  selectablePositions,
  usernameLabel,
  validateCreate,
  validateEdit,
  type FieldErrors,
  type PositionOption,
  type UserFilter,
  type UserRoleName,
  type UserRow,
} from "./userLogic";

const ROLE_TONE: Record<UserRoleName, ChipTone> = {
  host: "info",
  admin: "ok",
  recorder: "pend",
  viewer: "na",
};

/** ปรับช่องกรอกบนมือถือให้ 16px (กัน iOS ซูมเอง) */
const MOBILE_INPUT = "max-[640px]:min-h-11 max-[640px]:text-base";
const MOBILE_BTN = "max-[640px]:min-h-11";

type PasswordView = {
  title: string;
  name: string;
  username: string;
  positionLabel: string;
  password: string;
  lead: string;
};

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; user: UserRow }
  | { kind: "confirmEdit"; user: UserRow; displayName: string; positionCode: string }
  | { kind: "reset"; user: UserRow }
  | { kind: "toggle"; user: UserRow }
  | { kind: "password"; view: PasswordView };

export function UsersClient({
  users,
  positions,
  currentUserId,
}: {
  users: UserRow[];
  positions: PositionOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<UserFilter>(EMPTY_FILTER);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState("");
  const [flashId, setFlashId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const stats = useMemo(() => computeStats(users), [users]);
  const rows = useMemo(() => users.filter((u) => matchesFilter(u, filter)), [users, filter]);
  const selectable = useMemo(() => selectablePositions(positions), [positions]);

  const closeDialog = () => {
    setDialog(null); // รหัสชั่วคราวใน dialog หายไปพร้อม state
    setError("");
  };

  const done = (message: string, userId?: string) => {
    setToast(message);
    if (userId) {
      setFlashId(userId);
      window.setTimeout(() => setFlashId(null), 2500);
    }
    router.refresh();
  };

  const posLabel = (code: string | null) => positionOf(positions, code)?.shortNameTh ?? "ยังไม่ตั้งตำแหน่ง";
  const posFull = (code: string | null) => positionOf(positions, code)?.nameTh ?? "ยังไม่ตั้งตำแหน่ง";

  // ---- การกระทำ (ทุกอันผ่าน server action) ----
  const runCreate = (draft: { username: string; displayName: string; positionCode: string }) => {
    setError("");
    startTransition(async () => {
      const res = await createUserAction(draft);
      if (!res.ok) return setError(res.message);
      setDialog({
        kind: "password",
        view: {
          title: "สร้างบัญชีแล้ว",
          name: draft.displayName.trim(),
          username: res.username,
          positionLabel: posFull(draft.positionCode),
          password: res.temporaryPassword,
          lead: `ส่งรหัสนี้ให้ ${draft.displayName.trim()} ด้วยตัวเอง (โทร/แชตส่วนตัว)`,
        },
      });
      done("สร้างบัญชีแล้ว · บันทึกลงประวัติการแก้ไข", res.userId);
    });
  };

  const runReset = (u: UserRow) => {
    setError("");
    startTransition(async () => {
      const res = await resetPasswordAction(u.userId);
      if (!res.ok) return setError(res.message);
      setDialog({
        kind: "password",
        view: {
          title: "รีเซ็ตรหัสแล้ว",
          name: nameOf(u),
          username: u.username,
          positionLabel: posFull(u.positionCode),
          password: res.temporaryPassword,
          lead: "ส่งให้ผู้ใช้ด้วยตัวเอง",
        },
      });
      done("รีเซ็ตรหัสแล้ว · บันทึกลงประวัติการแก้ไข", u.userId);
    });
  };

  const runToggle = (u: UserRow) => {
    setError("");
    startTransition(async () => {
      const res = await setActiveAction(u.userId, !u.isActive);
      if (!res.ok) return setError(res.message);
      closeDialog();
      done(
        `${u.isActive ? "ปิด" : "เปิด"}บัญชี ${usernameLabel(u.username)} แล้ว · บันทึกลงประวัติการแก้ไข`,
        u.userId,
      );
    });
  };

  const runUpdate = (u: UserRow, displayName: string, positionCode: string, confirm: string) => {
    setError("");
    startTransition(async () => {
      const res = await updateUserAction({ userId: u.userId, displayName, positionCode, confirm });
      if (!res.ok) return setError(res.message);
      const changed = positionCode !== (u.positionCode ?? "");
      closeDialog();
      done(
        changed
          ? `บันทึกแล้ว · ระบบจะแจ้ง ${displayName.trim()} ตอนเข้าสู่ระบบครั้งถัดไป · บันทึกลงประวัติการแก้ไข`
          : "บันทึกการแก้ไขแล้ว · บันทึกลงประวัติการแก้ไข",
        u.userId,
      );
    });
  };

  const cards: { key: string; label: string; value: number; sub: string }[] = [
    { key: "", label: "ทั้งหมด", value: stats.total, sub: "ทุกบัญชี" },
    ...positions
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => ({ key: p.code, label: p.shortNameTh, value: stats.byPosition[p.code] ?? 0, sub: "ใช้งานอยู่" })),
    { key: "off", label: "ปิดบัญชี", value: stats.off, sub: "เข้าสู่ระบบไม่ได้" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-start gap-3.5">
        <div className="min-w-[240px] flex-1">
          <h1 className="m-0 text-xl font-semibold">จัดการผู้ใช้</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            สร้างบัญชีให้ทีมงานและกำหนดตำแหน่ง — ไม่มีหน้าสมัครเอง ·{" "}
            <Chip tone="pend">
              <LockIcon /> เฉพาะผู้ดูแลระบบ (PM / OM / เจ้าของ)
            </Chip>
          </p>
        </div>
        <Button variant="add" onClick={() => setDialog({ kind: "create" })}>
          สร้างบัญชี
        </Button>
      </div>

      <div
        role="group"
        aria-label="สรุปจำนวนบัญชีตามตำแหน่ง"
        className="my-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3"
      >
        {cards.map((c) => {
          const on = filter.card === c.key;
          return (
            <button
              key={c.key || "all"}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter((f) => ({ ...f, card: f.card === c.key && c.key !== "" ? "" : c.key }))}
              className={cx(
                "cursor-pointer rounded-lg border bg-surface px-4 py-3 text-left transition-colors hover:border-border-strong",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                on ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-border",
              )}
            >
              <div className="text-xs text-fg-muted">{c.label}</div>
              <div className="mt-0.5 text-[26px] font-bold leading-tight">{c.value}</div>
              <div className="mt-0.5 text-xs text-fg-muted">{c.sub}</div>
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2.5">
        <Field label="ค้นหา" className="min-w-[200px] flex-1">
          {(c) => (
            <input
              {...c}
              className={cx(c.className, MOBILE_INPUT)}
              type="search"
              placeholder="ชื่อ-นามสกุล / รหัสพนักงาน"
              value={filter.query}
              onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
            />
          )}
        </Field>
        <Field label="ตำแหน่ง">
          {(c) => (
            <select
              {...c}
              className={cx(c.className, MOBILE_INPUT)}
              value={filter.positionCode}
              onChange={(e) => setFilter((f) => ({ ...f, positionCode: e.target.value }))}
            >
              <option value="">ทุกตำแหน่ง</option>
              {positions.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.nameTh}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="สถานะ">
          {(c) => (
            <select
              {...c}
              className={cx(c.className, MOBILE_INPUT)}
              value={filter.status}
              onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as UserFilter["status"] }))}
            >
              <option value="">ทั้งหมด</option>
              <option value="on">ใช้งาน</option>
              <option value="off">ปิดบัญชี</option>
            </select>
          )}
        </Field>
      </div>

      <div className="relative overflow-x-auto rounded-lg border border-border bg-surface shadow-[var(--shadow)]">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2 text-left text-xs text-fg-muted">
              <th scope="col" className="px-3.5 py-2.5 font-medium">ชื่อ-นามสกุล</th>
              <th scope="col" className="px-3.5 py-2.5 font-medium">ตำแหน่ง</th>
              <th scope="col" className="px-3.5 py-2.5 font-medium">สถานะ</th>
              <th scope="col" className="px-3.5 py-2.5 font-medium max-[640px]:hidden">เข้าใช้ล่าสุด</th>
              <th scope="col" className="px-3.5 py-2.5"><span className="sr-only">จัดการ</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const manageable = canManageRow(u, positions);
              const lockedWhy = "บัญชีเจ้าของ แก้ไข รีเซ็ตรหัส หรือปิดจากหน้านี้ไม่ได้";
              const isMe = u.userId === currentUserId;
              return (
                <tr
                  key={u.userId}
                  className={cx(
                    "border-t border-border align-middle",
                    !u.isActive && "opacity-60",
                    flashId === u.userId && "bg-accent-soft",
                  )}
                >
                  <td className="px-3.5 py-2.5">
                    <div className="font-medium">
                      {nameOf(u)}
                      {isMe ? " (คุณ)" : ""}
                    </div>
                    <div className="text-xs text-fg-muted">{usernameLabel(u.username)}</div>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <Chip tone={ROLE_TONE[u.role]}>{posLabel(u.positionCode)}</Chip>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center gap-1">
                      <Chip tone={u.isActive ? "ok" : "na"}>{u.isActive ? "ใช้งาน" : "ปิดบัญชี"}</Chip>
                      {u.mustChangePassword ? <Chip tone="pend">รอเปลี่ยนรหัส</Chip> : null}
                      {u.hasUnreadPositionChange ? (
                        <span title={noticeTitle(u)}>
                          <Chip tone="pend">รอแจ้งผู้ใช้</Chip>
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3.5 py-2.5 text-fg-muted max-[640px]:hidden">{formatLastLogin(u.lastLogin)}</td>
                  <td className="px-3.5 py-2.5 text-right">
                    <div className="flex flex-wrap justify-end gap-1" title={manageable ? undefined : lockedWhy}>
                      <RowButton disabled={!manageable} onClick={() => setDialog({ kind: "edit", user: u })}>
                        แก้ไข
                      </RowButton>
                      <RowButton disabled={!manageable} onClick={() => setDialog({ kind: "reset", user: u })}>
                        รีเซ็ตรหัส
                      </RowButton>
                      <RowButton
                        disabled={!manageable}
                        danger={u.isActive}
                        onClick={() => setDialog({ kind: "toggle", user: u })}
                      >
                        {u.isActive ? "ปิดบัญชี" : "เปิดบัญชี"}
                      </RowButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-fg-muted">
            ไม่พบบัญชีที่ตรงกับตัวกรอง ลองล้างคำค้นหาหรือเปลี่ยนตัวกรอง
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 border-t border-border bg-surface-2 px-3.5 py-2 text-xs text-fg-muted">
          <span>
            แสดง {rows.length} จาก {users.length} บัญชี
          </span>
          <span className="flex-1" />
          <span>ทุกการสร้าง/แก้ไข/ปิดบัญชี บันทึกในประวัติการแก้ไขอัตโนมัติ</span>
        </div>
      </div>

      <p className="mt-3.5 rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-xs text-fg-muted">
        <b className="text-fg">ผู้ชมทั่วไปไม่ต้องมีบัญชี</b> — ผู้บริหาร/ฝ่ายขาย/คนนอกดูหน้าสรุปตัวเลขได้โดยไม่ต้องเข้าสู่ระบบ ·
        ทีมบริการหน้างานไม่มีบัญชีในเฟส 1 (ส่งสรุปงานให้หัวหน้างานกรอกแทน)
      </p>

      <div className="mt-4 rounded-lg border border-border bg-surface shadow-[var(--shadow)]">
        <h3 className="m-0 border-b border-border px-4 py-3 text-sm font-semibold">แต่ละตำแหน่งทำอะไรได้</h3>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3.5 px-4 py-3.5 text-[12.5px]">
          <PermBlock title="PM · OM · เจ้าของ" tone="info" items={["จัดการผู้ใช้", "ตั้งค่าเกณฑ์ Tier / ประเภทลูกค้า / ทีม", "ปิดเดือน และแก้เดือนที่ปิดแล้ว", "ลงข้อมูล Port ต่างจังหวัด", "ดูประวัติการแก้ไข · Dashboard Sync", "สามตำแหน่งนี้สิทธิ์เท่ากัน ต่างแค่ชื่อที่แสดง"]} />
          <PermBlock title="แอดมิน (Admin)" tone="ok" items={["ดูทุกเขต", "เพิ่ม/แก้ลูกค้า สัญญา สถานี และแนบไฟล์สัญญา", "ลบได้เฉพาะรายการที่ยังไม่มีผลบริการ", "ไม่แก้ผลบริการ · ไม่ปิดเดือน"]} />
          <PermBlock title="หัวหน้างาน (Supervisor)" tone="pend" items={["ดูทุกเขต", "กรอก/แก้/ลบผลบริการประจำเดือน (รวมกล่อง AG)", "ปิดเดือน และแก้เดือนที่ปิดแล้ว (ส่วนกลาง)", "ไม่เพิ่ม/แก้ลูกค้าและสัญญา"]} />
        </div>
        <p className="m-0 px-4 pb-3.5 text-xs text-fg-muted">
          ต้องการตำแหน่งใหม่ (เช่น ผู้ช่วย PM) เพิ่มได้ภายหลังโดยไม่ต้องแก้ระบบ — เลือกสิทธิ์ให้เท่ากับตำแหน่งที่มีอยู่
        </p>
      </div>

      {/* ---------------- dialogs ---------------- */}
      {dialog?.kind === "create" ? (
        <Modal title="สร้างบัญชีใหม่" onClose={closeDialog}>
          <UserForm
            mode="create"
            positions={selectable}
            existingUsernames={users.map((u) => u.username)}
            error={error}
            pending={pending}
            onCancel={closeDialog}
            onSubmit={(d) => runCreate({ username: d.username, displayName: d.displayName, positionCode: d.positionCode })}
            allUsers={users}
            allPositions={positions}
          />
        </Modal>
      ) : null}

      {dialog?.kind === "edit" ? (
        <Modal title={`แก้ไขบัญชี · ${usernameLabel(dialog.user.username)}`} onClose={closeDialog}>
          <UserForm
            mode="edit"
            user={dialog.user}
            isMe={dialog.user.userId === currentUserId}
            positions={selectable}
            existingUsernames={[]}
            error={error}
            pending={pending}
            onCancel={closeDialog}
            allUsers={users}
            allPositions={positions}
            onSubmit={(d) => {
              const u = dialog.user;
              if (d.positionCode === (u.positionCode ?? "")) {
                runUpdate(u, d.displayName, d.positionCode, "");
              } else {
                // เปลี่ยนตำแหน่ง = เปลี่ยนสิทธิ์ → ขั้นยืนยัน
                setError("");
                setDialog({ kind: "confirmEdit", user: u, displayName: d.displayName, positionCode: d.positionCode });
              }
            }}
          />
        </Modal>
      ) : null}

      {dialog?.kind === "confirmEdit" ? (
        <ConfirmPositionChange
          dialog={dialog}
          fromLabel={posFull(dialog.user.positionCode)}
          toLabel={posFull(dialog.positionCode)}
          error={error}
          pending={pending}
          onBack={() => {
            setError("");
            setDialog({ kind: "edit", user: dialog.user });
          }}
          onClose={closeDialog}
          onConfirm={(confirm) => runUpdate(dialog.user, dialog.displayName, dialog.positionCode, confirm)}
        />
      ) : null}

      {dialog?.kind === "reset" ? (
        <Modal title="รีเซ็ตรหัสผ่าน" onClose={closeDialog}>
          <p className="m-0 mb-2 text-[13px]">
            รีเซ็ตรหัสผ่านของ {nameOf(dialog.user)} ({usernameLabel(dialog.user.username)})?
          </p>
          <ul className="my-2 list-disc pl-5 text-[13px] text-fg-muted">
            <li>ระบบสุ่มรหัสชั่วคราวใหม่ — รหัสเดิมใช้ไม่ได้ทันที</li>
            <li>ผู้ใช้ต้องเปลี่ยนรหัสตอนเข้าครั้งต่อไป</li>
          </ul>
          {!dialog.user.isActive ? (
            <Alert variant="warn">บัญชีนี้ปิดอยู่ — รีเซ็ตแล้วยังล็อกอินไม่ได้จนกว่าจะเปิดบัญชี</Alert>
          ) : null}
          <DialogError message={error} />
          <DialogFooter>
            <Button className={MOBILE_BTN} onClick={closeDialog}>ยกเลิก</Button>
            <Button className={MOBILE_BTN} variant="primary" loading={pending} onClick={() => runReset(dialog.user)}>
              รีเซ็ตรหัส
            </Button>
          </DialogFooter>
        </Modal>
      ) : null}

      {dialog?.kind === "toggle" ? (
        <ToggleDialog
          user={dialog.user}
          isMe={dialog.user.userId === currentUserId}
          lastHost={dialog.user.role === "host" && activeHostCount(users, dialog.user.userId) === 0}
          error={error}
          pending={pending}
          onClose={closeDialog}
          onConfirm={() => runToggle(dialog.user)}
        />
      ) : null}

      {dialog?.kind === "password" ? <PasswordDialog view={dialog.view} onClose={closeDialog} onToast={setToast} /> : null}

      <Toast message={toast} onClose={() => setToast("")} durationMs={4500} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ชิ้นส่วนย่อย
// ---------------------------------------------------------------------------

/** tooltip ของป้าย "รอแจ้งผู้ใช้": จำนวนที่ยังไม่อ่าน + วันที่เก่าสุด */
function noticeTitle(u: UserRow): string {
  const n = u.unreadCount ?? 0;
  const since = u.oldestUnreadAt ? ` ตั้งแต่ ${formatLastLogin(u.oldestUnreadAt)}` : "";
  return `ยังไม่อ่านแจ้งเตือนเปลี่ยนตำแหน่ง ${n} รายการ${since}`;
}

function RowButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Button
      size="sm"
      variant={danger ? "danger" : "secondary"}
      disabled={disabled}
      onClick={onClick}
      className="max-[640px]:min-h-11 max-[640px]:px-3 max-[640px]:text-[13px]"
    >
      {children}
    </Button>
  );
}

function PermBlock({ title, tone, items }: { title: string; tone: ChipTone; items: string[] }) {
  return (
    <div>
      <Chip tone={tone}>{title}</Chip>
      <ul className="mb-0 mt-1.5 list-disc pl-[18px] leading-[1.7] text-fg-muted">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function DialogError({ message }: { message: string }) {
  return message ? (
    <div className="mt-3">
      <Alert variant="danger">{message}</Alert>
    </div>
  ) : null;
}

function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-3">{children}</div>;
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

type FormDraft = { username: string; displayName: string; positionCode: string };

function UserForm({
  mode,
  user,
  isMe,
  positions,
  allPositions,
  allUsers,
  existingUsernames,
  error,
  pending,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit";
  user?: UserRow;
  isMe?: boolean;
  positions: PositionOption[];
  allPositions: PositionOption[];
  allUsers: UserRow[];
  existingUsernames: string[];
  error: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (d: FormDraft) => void;
}) {
  const initial: FormDraft = {
    username: user?.username ?? "",
    displayName: user?.displayName ?? "",
    positionCode: user?.positionCode ?? "",
  };
  const [draft, setDraft] = useState<FormDraft>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const dirty =
    draft.username !== initial.username ||
    draft.displayName !== initial.displayName ||
    draft.positionCode !== initial.positionCode;
  useUnsavedWork(dirty);

  const submit = () => {
    const found =
      mode === "create"
        ? validateCreate(draft, allPositions, existingUsernames)
        : validateEdit({ displayName: draft.displayName, positionCode: draft.positionCode, confirm: CONFIRM_PHRASE }, user!, allPositions, allUsers);
    // แก้ไข: ขั้นคำยืนยันอยู่ dialog ถัดไป จึงส่งคำยืนยันสมมติเข้าตรวจเฉพาะช่องอื่น
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit(draft);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3"
    >
      {isMe ? (
        <Alert variant="warn">นี่คือบัญชีของคุณ — ถ้าลดสิทธิ์ตัวเอง คุณจะเข้าหน้านี้ไม่ได้อีก</Alert>
      ) : null}
      <Field
        label="รหัสพนักงาน (ใช้เข้าสู่ระบบ)"
        required={mode === "create"}
        error={errors.username}
        hint={
          mode === "edit"
            ? "แก้รหัสพนักงานไม่ได้ (ใช้เข้าสู่ระบบ + อ้างอิงในประวัติการแก้ไข)"
            : "ตัวอย่าง AG-01234 · ห้ามซ้ำ · สร้างแล้วเปลี่ยนไม่ได้"
        }
      >
        {(c) => (
          <input
            {...c}
            className={cx(c.className, MOBILE_INPUT)}
            type="text"
            maxLength={20}
            autoComplete="off"
            autoCapitalize="none"
            placeholder="เช่น AG-01234"
            readOnly={mode === "edit"}
            value={mode === "edit" ? usernameLabel(draft.username) : draft.username}
            onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
          />
        )}
      </Field>
      <Field label="ชื่อ - นามสกุล (เจ้าของรหัสพนักงาน)" required error={errors.displayName}>
        {(c) => (
          <input
            {...c}
            className={cx(c.className, MOBILE_INPUT)}
            type="text"
            maxLength={100}
            autoComplete="off"
            placeholder="เช่น นภา แสงทอง"
            value={draft.displayName}
            onChange={(e) => setDraft((d) => ({ ...d, displayName: e.target.value }))}
          />
        )}
      </Field>
      <Field
        label="ตำแหน่ง"
        required
        error={errors.positionCode}
        hint="PM · OM ดูแลระบบได้เต็ม · ผู้ชมทั่วไปไม่ต้องมีบัญชี"
      >
        {(c) => (
          <select
            {...c}
            className={cx(c.className, MOBILE_INPUT)}
            value={draft.positionCode}
            onChange={(e) => setDraft((d) => ({ ...d, positionCode: e.target.value }))}
          >
            <option value="">— เลือกตำแหน่ง —</option>
            {positions.map((p) => (
              <option key={p.code} value={p.code}>
                {p.nameTh}
              </option>
            ))}
          </select>
        )}
      </Field>
      {mode === "create" ? (
        <Alert variant="ok">ระบบจะสุ่มรหัสผ่านชั่วคราวให้หลังกดสร้าง · ผู้ใช้ต้องเปลี่ยนรหัสตอนเข้าครั้งแรก</Alert>
      ) : null}
      <DialogError message={error} />
      <DialogFooter>
        <Button className={MOBILE_BTN} onClick={onCancel}>ยกเลิก</Button>
        <Button className={MOBILE_BTN} variant="primary" type="submit" loading={pending}>
          {mode === "create" ? "สร้างบัญชี" : "บันทึก"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ConfirmPositionChange({
  dialog,
  fromLabel,
  toLabel,
  error,
  pending,
  onBack,
  onClose,
  onConfirm,
}: {
  dialog: { user: UserRow };
  fromLabel: string;
  toLabel: string;
  error: string;
  pending: boolean;
  onBack: () => void;
  onClose: () => void;
  onConfirm: (confirm: string) => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  useUnsavedWork(confirm !== "");
  const u = dialog.user;
  return (
    <Modal title="ยืนยันเปลี่ยนตำแหน่ง" onClose={onClose}>
      <p className="m-0 mb-1 text-[13px]">
        เปลี่ยนตำแหน่งของ {nameOf(u)} ({usernameLabel(u.username)})
      </p>
      <p className="m-0 mb-3 text-[13px] font-medium">
        {fromLabel} &nbsp;→&nbsp; {toLabel}
      </p>
      <Alert variant="warn">
        สิทธิ์ใช้งานของเขาจะเปลี่ยนทันที · ระบบจะแจ้งเขาตอนเข้าสู่ระบบครั้งถัดไป · ระบบจดไว้ในประวัติการแก้ไข
        (ใครแก้ เมื่อไหร่ จากอะไรเป็นอะไร พร้อมตำแหน่งของผู้แก้ ณ ตอนนั้น)
      </Alert>
      <div className="mt-3">
        <Field label={`ยืนยันการแก้ไข — พิมพ์คำว่า "${CONFIRM_PHRASE}" เพื่อเปลี่ยนตำแหน่ง`} error={err}>
          {(c) => (
            <input
              {...c}
              className={cx(c.className, MOBILE_INPUT)}
              type="text"
              autoComplete="off"
              placeholder={CONFIRM_PHRASE}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>
      </div>
      <DialogError message={error} />
      <DialogFooter>
        <Button className={MOBILE_BTN} onClick={onBack}>กลับไปแก้</Button>
        <Button
          className={MOBILE_BTN}
          variant="primary"
          loading={pending}
          onClick={() => {
            if (confirm.trim() !== CONFIRM_PHRASE) {
              setErr(`พิมพ์คำว่า "${CONFIRM_PHRASE}" ให้ตรงก่อนจึงจะเปลี่ยนได้`);
              return;
            }
            setErr("");
            onConfirm(confirm);
          }}
        >
          ยืนยันเปลี่ยน
        </Button>
      </DialogFooter>
    </Modal>
  );
}

function ToggleDialog({
  user,
  isMe,
  lastHost,
  error,
  pending,
  onClose,
  onConfirm,
}: {
  user: UserRow;
  isMe: boolean;
  lastHost: boolean;
  error: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const label = `${nameOf(user)} (${usernameLabel(user.username)})`;
  if (user.isActive && (isMe || lastHost)) {
    return (
      <Modal title="ปิดบัญชีไม่ได้" onClose={onClose}>
        <Alert variant="danger">
          {isMe
            ? "ปิดบัญชีตัวเองไม่ได้ — ให้ผู้ดูแลระบบคนอื่นเป็นคนปิดให้"
            : "ปิดบัญชีไม่ได้ — ต้องมีผู้ดูแลระบบ (PM / OM / เจ้าของ) ที่ใช้งานอยู่อย่างน้อย 1 คน (สร้างคนใหม่ก่อน)"}
        </Alert>
        <DialogFooter>
          <Button className={MOBILE_BTN} variant="primary" onClick={onClose}>เข้าใจแล้ว</Button>
        </DialogFooter>
      </Modal>
    );
  }
  return (
    <Modal title={user.isActive ? "ปิดบัญชี" : "เปิดบัญชี"} onClose={onClose}>
      {user.isActive ? (
        <>
          <p className="m-0 mb-2 text-[13px]">ปิดบัญชีของ {label}?</p>
          <ul className="my-2 list-disc pl-5 text-[13px] text-fg-muted">
            <li>ล็อกอินไม่ได้ทันที (session ที่เปิดอยู่ถูกตัดออก)</li>
            <li>ข้อมูลที่เคยกรอกและประวัติการแก้ไขยังอยู่ครบ — ไม่ลบ</li>
            <li>เปิดบัญชีคืนได้ทุกเมื่อ</li>
          </ul>
        </>
      ) : (
        <>
          <p className="m-0 mb-2 text-[13px]">เปิดบัญชีของ {label} กลับมาใช้งาน?</p>
          <Alert variant="warn">ถ้าไม่ได้เข้าใช้นานหรือจำรหัสไม่ได้ แนะนำให้กด &ldquo;รีเซ็ตรหัส&rdquo; หลังเปิดบัญชี</Alert>
        </>
      )}
      <DialogError message={error} />
      <DialogFooter>
        <Button className={MOBILE_BTN} onClick={onClose}>ยกเลิก</Button>
        <Button
          className={MOBILE_BTN}
          variant={user.isActive ? "danger" : "primary"}
          loading={pending}
          onClick={onConfirm}
        >
          {user.isActive ? "ปิดบัญชี" : "เปิดบัญชี"}
        </Button>
      </DialogFooter>
    </Modal>
  );
}

function PasswordDialog({
  view,
  onClose,
  onToast,
}: {
  view: PasswordView;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const copy = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(view.password).then(
        () => onToast("คัดลอกรหัสแล้ว"),
        () => onToast("คัดลอกไม่ได้ — เลือกข้อความแล้วคัดลอกเอง"),
      );
    } else {
      onToast("คัดลอกไม่ได้ — เลือกข้อความแล้วคัดลอกเอง");
    }
  };
  return (
    <Modal title={view.title} onClose={onClose}>
      <dl className="m-0 mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-fg-muted">ชื่อ-นามสกุล</dt>
        <dd className="m-0">{view.name}</dd>
        <dt className="text-fg-muted">รหัสพนักงาน</dt>
        <dd className="m-0">{usernameLabel(view.username)}</dd>
        <dt className="text-fg-muted">ตำแหน่ง</dt>
        <dd className="m-0">{view.positionLabel}</dd>
      </dl>
      <div className="mb-1 text-[13px]">รหัสผ่านชั่วคราว</div>
      <div className="mb-3 flex items-center gap-2.5 rounded-lg border border-dashed border-border-strong bg-surface-2 px-3.5 py-3">
        <code className="flex-1 break-all font-mono text-xl font-semibold tracking-[0.06em]">{view.password}</code>
        <Button size="sm" className={MOBILE_BTN} onClick={copy}>คัดลอก</Button>
      </div>
      <Alert variant="warn">
        รหัสนี้แสดงครั้งเดียว ปิดหน้าต่างแล้วดูไม่ได้อีก (ถ้าหายให้กด &ldquo;รีเซ็ตรหัส&rdquo;) — {view.lead}
      </Alert>
      <DialogFooter>
        <Button className={MOBILE_BTN} variant="primary" onClick={onClose}>เสร็จสิ้น</Button>
      </DialogFooter>
    </Modal>
  );
}
