"use client";

/**
 * TutorialSandbox — หน้าจำลอง “เข้าสู่ระบบ” และ “ตั้งรหัสผ่านใหม่” สำหรับบทเรียนส่วนกลาง
 *
 * หน้าจริงของสองหน้านี้อยู่นอกโครงหน้าหลักและผู้ใช้ผ่านมาแล้ว จึงจำลองให้ฝึก
 * ⚠ โหมดฝึก: ไม่มี fetch / RPC / server action ใดๆ ในไฟล์นี้ — ปุ่มเข้าสู่ระบบและปุ่มบันทึกรหัสไม่ทำอะไรเอง
 *   (ตัวบทเรียนดักการกดแล้วไปขั้นถัดไป) · รหัสที่พิมพ์เก็บในหน่วยความจำของหน้าเท่านั้น ไม่เขียน localStorage
 * ปุ่มหลักที่ให้ลองกดติด `data-tutorial-fake` (ตัวดักคลิกถือเป็นปุ่ม “หลอก”) · ช่องกรอก/ปุ่มตา/ปุ่มใส่รหัสตัวอย่างใช้งานได้จริงในหน้านี้
 */
import { useState } from "react";

import { evaluatePassword } from "./tour-logic";
import styles from "./tutorial.module.css";

type Props = {
  screen: "sandbox-login" | "sandbox-chpw";
  password: string;
  confirm: string;
  onChange: (next: { password: string; confirm: string }) => void;
  /** ข้อความผิดพลาดของขั้น guard */
  error: string | null;
};

const SAMPLE_PASSWORD = "Bait2026ok";

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function RuleIcon({ ok }: { ok: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ok ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <circle cx="12" cy="12" r="7" />}
    </svg>
  );
}

export function TutorialSandbox({ screen, password, confirm, onChange, error }: Props) {
  const [showPass, setShowPass] = useState(false);
  const rules = evaluatePassword(password, confirm);

  return (
    <div className={styles.sandbox} data-tutorial-sandbox>
      <div className={styles.sandboxBanner} role="status">
        โหมดฝึก · ข้อมูลทั้งหมดเป็นข้อมูลตัวอย่าง ไม่บันทึกลงระบบจริง
      </div>

      {screen === "sandbox-login" ? (
        <div className={styles.sandboxCard} data-tutorial-card>
          <h1 style={{ margin: "0 0 12px", fontSize: 20 }}>เข้าสู่ระบบ</h1>
          <label className={styles.field} data-tour="login-user">
            <span>ชื่อผู้ใช้ (รหัสพนักงาน)</span>
            <input className={styles.input} value="ag-01234" readOnly aria-readonly="true" />
          </label>
          <div className={styles.field} data-tour="login-pass">
            <span>รหัสผ่านชั่วคราว</span>
            <div className={styles.pwRow}>
              <input
                className={styles.input}
                type={showPass ? "text" : "password"}
                value="tempPass1"
                readOnly
                aria-readonly="true"
                aria-label="รหัสผ่านชั่วคราว"
              />
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSm}`}
                aria-label={showPass ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                onClick={() => setShowPass((v) => !v)}
              >
                <EyeIcon off={showPass} />
              </button>
            </div>
          </div>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPri}`}
            style={{ width: "100%" }}
            data-tour="login-btn"
            data-tutorial-fake
          >
            เข้าสู่ระบบ
          </button>
          <p className={styles.sandboxNote}>รหัสพนักงานในตัวอย่างเป็นข้อมูลสมมติ</p>
        </div>
      ) : (
        <div className={styles.sandboxCard} data-tutorial-card>
          <h1 style={{ margin: "0 0 4px", fontSize: 20 }}>ตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน</h1>
          <p className={styles.sandboxNote} style={{ margin: "0 0 12px", fontSize: 13 }}>
            บัญชีนี้ยังใช้รหัสชั่วคราว ต้องตั้งรหัสใหม่ก่อนเข้าหน้าอื่น
          </p>
          <label className={styles.field} data-tour="chpw-new">
            <span>รหัสผ่านใหม่</span>
            <input
              className={styles.input}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => onChange({ password: e.target.value, confirm })}
            />
          </label>
          <ul className={styles.rules} aria-live="polite">
            <li data-ok={rules.len}><RuleIcon ok={rules.len} />อย่างน้อย 8 ตัว</li>
            <li data-ok={rules.up}><RuleIcon ok={rules.up} />มีตัวพิมพ์ใหญ่</li>
            <li data-ok={rules.lo}><RuleIcon ok={rules.lo} />มีตัวพิมพ์เล็ก</li>
            <li data-ok={rules.num}><RuleIcon ok={rules.num} />มีตัวเลข</li>
          </ul>
          <label className={styles.field} data-tour="chpw-confirm">
            <span>ยืนยันรหัสผ่านใหม่</span>
            <input
              className={styles.input}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => onChange({ password, confirm: e.target.value })}
            />
          </label>
          <div className={styles.sandboxErr} role="alert">
            {error}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPri}`}
              data-tour="chpw-save"
              data-tutorial-fake
            >
              บันทึกรหัสผ่านใหม่
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={() => onChange({ password: SAMPLE_PASSWORD, confirm: SAMPLE_PASSWORD })}
            >
              ใส่รหัสตัวอย่าง
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
