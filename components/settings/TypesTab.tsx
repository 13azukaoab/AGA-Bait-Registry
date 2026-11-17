"use client";

/**
 * แท็บ "ประเภทลูกค้า" (mockup FINAL settings.html)
 *
 * Logic summary:
 *   * อ่านจาก `customer_types` (code, label, group_label, sort_order) · หมวดเรียงตามสมาชิกแรก
 *   * จัดเรียงลำดับ: เปิดโหมดแล้วกด ▲▼ (ย้ายในหมวด/ย้ายหมวด) → "บันทึกลำดับ" ส่งรหัสทุกตัวตามลำดับใหม่ครั้งเดียวผ่าน
 *     RPC `reorder_customer_types` (sort_order เป็น UNIQUE จึงสลับทีละแถวไม่ได้) · ไม่ตรงกับข้อมูลปัจจุบัน = CT001
 *   * เพิ่ม/แก้ชื่อ/ย้ายหมวด/ลบ — ลบได้เฉพาะประเภทที่ไม่มีลูกค้าใช้ (FK · 23503 แสดงข้อความไทย)
 *   * ⚠ ต่างจาก mockup (รอตัดสินใจ — ดูรายงาน): ตาราง `customer_types` ยังไม่มีคอลัมน์ `is_active` (ปิดใช้งาน) และ `hint` (คำอธิบาย)
 *     จึงไม่มีสวิตช์ปิดใช้/ช่องหมายเหตุ · ไม่มีปุ่ม "เพิ่มหมวด" แยก — พิมพ์ชื่อหมวดใหม่ในฟอร์ม "เพิ่มประเภท" ได้เลย
 */
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Modal } from "@/components/customers-new/Modal";
import { useUnsavedWork } from "@/components/shell/unsaved-work";
import { Alert, Button, Chip, Field, cx } from "@/components/ui";

import {
  createCustomerTypeAction,
  deleteCustomerTypeAction,
  reorderCustomerTypesAction,
  updateCustomerTypeAction,
} from "./settingsActions";
import type { SettingsData } from "./settingsData";
import { Card, DialogError, DialogFooter, MOBILE_BTN, MOBILE_INPUT } from "./parts";
import {
  flattenCodes,
  groupTypes,
  moveGroup,
  moveItem,
  validateType,
  type CustomerTypeRow,
  type TypeGroup,
} from "./settingsLogic";

const NEW_GROUP = "__new__";

type Dialog =
  | { kind: "form"; item: CustomerTypeRow | null }
  | { kind: "delete"; item: CustomerTypeRow };

export function TypesTab({ data, onToast }: { data: SettingsData; onToast: (m: string) => void }) {
  const router = useRouter();
  const serverGroups = useMemo(() => groupTypes(data.customerTypes), [data.customerTypes]);
  const [groups, setGroups] = useState<TypeGroup[]>(serverGroups);
  const [sorting, setSorting] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const orderChanged = flattenCodes(groups).join("|") !== flattenCodes(serverGroups).join("|");
  useUnsavedWork(sorting && orderChanged);

  // ข้อมูลจาก server เปลี่ยน (หลัง refresh) → ใช้ลำดับจริงอีกครั้ง
  const [seen, setSeen] = useState(data.customerTypes);
  if (seen !== data.customerTypes) {
    setSeen(data.customerTypes);
    setGroups(serverGroups);
  }

  const close = () => {
    setDialog(null);
    setError("");
  };

  const saveOrder = () =>
    startTransition(async () => {
      const res = await reorderCustomerTypesAction(flattenCodes(groups));
      if (!res.ok) return onToast(res.message);
      setSorting(false);
      onToast("บันทึกลำดับแล้ว · บันทึกลงประวัติการแก้ไข");
      router.refresh();
    });

  const total = data.customerTypes.length;
  const allRows = data.customerTypes;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <Chip tone="info">
          {groups.length} หมวด · {total} ประเภท
        </Chip>
        <span className="ml-auto flex flex-wrap gap-2">
          {sorting && orderChanged ? (
            <>
              <Button className={MOBILE_BTN} onClick={() => setGroups(serverGroups)}>
                ยกเลิกการเรียง
              </Button>
              <Button className={MOBILE_BTN} variant="primary" loading={pending} onClick={saveOrder}>
                บันทึกลำดับ
              </Button>
            </>
          ) : null}
          <Button
            className={MOBILE_BTN}
            aria-pressed={sorting}
            onClick={() => {
              if (sorting) setGroups(serverGroups);
              setSorting((s) => !s);
            }}
          >
            {sorting ? "เสร็จการจัดเรียง" : "จัดเรียงลำดับ"}
          </Button>
          <Button variant="add" onClick={() => setDialog({ kind: "form", item: null })}>
            เพิ่มประเภท
          </Button>
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4 max-[900px]:grid-cols-1">
        <div className="flex flex-col gap-3">
          {groups.map((g, gi) => (
            <Card
              key={g.label}
              title={g.label}
              sub={`${g.items.length} ประเภท`}
              right={
                sorting ? (
                  <span className="flex gap-1">
                    <MoveBtn label={`ย้ายหมวด ${g.label} ขึ้น`} disabled={gi === 0} onClick={() => setGroups(moveGroup(groups, gi, -1))} up />
                    <MoveBtn label={`ย้ายหมวด ${g.label} ลง`} disabled={gi === groups.length - 1} onClick={() => setGroups(moveGroup(groups, gi, 1))} />
                  </span>
                ) : undefined
              }
            >
              <ul className="m-0 list-none p-0">
                {g.items.map((it, ii) => (
                  <li key={it.code} className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2 first:border-t-0 text-[13px]">
                    <span className="min-w-0 flex-1 break-words">{it.label}</span>
                    {sorting ? (
                      <span className="flex gap-1">
                        <MoveBtn label={`ย้าย ${it.label} ขึ้น`} disabled={ii === 0} onClick={() => setGroups(moveItem(groups, gi, ii, -1))} up />
                        <MoveBtn label={`ย้าย ${it.label} ลง`} disabled={ii === g.items.length - 1} onClick={() => setGroups(moveItem(groups, gi, ii, 1))} />
                      </span>
                    ) : (
                      <span className="flex gap-1">
                        <Button size="sm" className="max-[640px]:min-h-11" onClick={() => setDialog({ kind: "form", item: it })}>
                          แก้ไข
                        </Button>
                        <Button size="sm" variant="danger" className="max-[640px]:min-h-11" onClick={() => setDialog({ kind: "delete", item: it })}>
                          ลบ
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          {groups.length === 0 ? <Alert variant="warn">ยังไม่มีประเภทลูกค้า — กด &ldquo;เพิ่มประเภท&rdquo;</Alert> : null}
        </div>

        <div className="flex flex-col gap-3">
          <Card title="ตัวอย่างใน dropdown" sub="หน้าเปิดงาน / ทะเบียน">
            <div className="p-4">
              <select
                size={Math.min(16, total + groups.length)}
                aria-label="ตัวอย่างรายการประเภทลูกค้าใน dropdown"
                className="w-full rounded-lg border border-border-strong bg-surface p-1 text-[13px] text-fg"
              >
                {groups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.items.map((i) => (
                      <option key={i.code}>{i.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </Card>
          <Alert variant="info">
            ชื่อประเภทต้องไม่ซ้ำกันทั้งระบบ (ไม่สนเว้นวรรค/ตัวพิมพ์) · ลบได้เฉพาะประเภทที่ยังไม่มีลูกค้าใช้
            ถ้ามีลูกค้าใช้อยู่ให้เปลี่ยนชื่อแทน · <b>&ldquo;สถานที่ทางศาสนา&rdquo; มาก่อนเสมอ</b> (วัด/โบสถ์/มัสยิด)
            ไม่เข้าหมวดใดเลยให้ใช้ &ldquo;อื่นๆ&rdquo;
          </Alert>
        </div>
      </div>

      {dialog?.kind === "form" ? (
        <TypeForm
          item={dialog.item}
          groups={groups}
          all={allRows}
          error={error}
          pending={pending}
          onClose={close}
          onSubmit={(label, groupLabel) =>
            startTransition(async () => {
              setError("");
              const res = dialog.item
                ? await updateCustomerTypeAction({ code: dialog.item.code, label, groupLabel })
                : await createCustomerTypeAction({ label, groupLabel });
              if (!res.ok) return setError(res.message);
              close();
              onToast(dialog.item ? "บันทึกการแก้ไขแล้ว · บันทึกลงประวัติการแก้ไข" : "เพิ่มประเภทแล้ว · บันทึกลงประวัติการแก้ไข");
              router.refresh();
            })
          }
        />
      ) : null}

      {dialog?.kind === "delete" ? (
        <Modal title="ลบประเภทลูกค้า" onClose={close}>
          <p className="m-0 mb-2 text-[13px]">
            ลบประเภท &ldquo;{dialog.item.label}&rdquo;? ลบได้เฉพาะประเภทที่ยังไม่มีลูกค้าใช้ (ถ้ามีลูกค้าใช้อยู่ ระบบจะไม่ลบให้)
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
                  const res = await deleteCustomerTypeAction(dialog.item.code);
                  if (!res.ok) return setError(res.message);
                  close();
                  onToast("ลบประเภทแล้ว · บันทึกลงประวัติการแก้ไข");
                  router.refresh();
                })
              }
            >
              ลบประเภท
            </Button>
          </DialogFooter>
        </Modal>
      ) : null}
    </div>
  );
}

function MoveBtn({ label, disabled, onClick, up }: { label: string; disabled: boolean; onClick: () => void; up?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border border-border-strong bg-surface text-fg hover:bg-surface-2",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-40 max-[640px]:size-11",
      )}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {up ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
      </svg>
    </button>
  );
}

function TypeForm({
  item,
  groups,
  all,
  error,
  pending,
  onClose,
  onSubmit,
}: {
  item: CustomerTypeRow | null;
  groups: TypeGroup[];
  all: CustomerTypeRow[];
  error: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (label: string, groupLabel: string) => void;
}) {
  const [label, setLabel] = useState(item?.label ?? "");
  const [groupSel, setGroupSel] = useState(item?.groupLabel ?? groups[0]?.label ?? NEW_GROUP);
  const [newGroup, setNewGroup] = useState("");
  const [errors, setErrors] = useState<ReturnType<typeof validateType>>({});
  useUnsavedWork(label !== (item?.label ?? "") || newGroup !== "");

  const groupLabel = groupSel === NEW_GROUP ? newGroup : groupSel;
  const submit = () => {
    const found = validateType({ label, group: groupLabel }, all, item?.code);
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit(label.trim(), groupLabel.trim());
  };

  return (
    <Modal title={item ? "แก้ไขประเภทลูกค้า" : "เพิ่มประเภทลูกค้า"} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="ชื่อประเภท" required error={errors.label}>
          {(c) => (
            <input
              {...c}
              className={cx(c.className, MOBILE_INPUT)}
              type="text"
              maxLength={60}
              autoComplete="off"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          )}
        </Field>
        <Field label="หมวด" required error={groupSel === NEW_GROUP ? undefined : errors.group}>
          {(c) => (
            <select {...c} className={cx(c.className, MOBILE_INPUT)} value={groupSel} onChange={(e) => setGroupSel(e.target.value)}>
              {groups.map((g) => (
                <option key={g.label} value={g.label}>
                  {g.label}
                </option>
              ))}
              <option value={NEW_GROUP}>+ หมวดใหม่…</option>
            </select>
          )}
        </Field>
        {groupSel === NEW_GROUP ? (
          <Field label="ชื่อหมวดใหม่" required error={errors.group}>
            {(c) => (
              <input
                {...c}
                className={cx(c.className, MOBILE_INPUT)}
                type="text"
                maxLength={60}
                autoComplete="off"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
              />
            )}
          </Field>
        ) : null}
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
