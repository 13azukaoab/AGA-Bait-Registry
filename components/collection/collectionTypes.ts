/**
 * ชนิดข้อมูลของหน้า "ลูกค้ารอเก็บสถานี" (/collection) — SPEC §7.8 · DECISIONS 2.42 / 2.50
 *
 * Logic summary:
 *   * 1 แถว = 1 สัญญาที่ "หมดแล้ว" และมีสถานี IG (เก็บคืนเฉพาะ IG · IC มอบลูกค้า · AG ไม่ต้องเก็บ)
 *   * ตัวเลข IG มาจาก view `v_contract_ig_collection` (M19b) — `igTotal` นับรวม IG ที่ย้ายไปสัญญา Renew แล้ว
 *     จึงใช้ `igBase = igTotal − moved` เป็นตัวหารบนจอ (collected + notCollected + remaining = igBase)
 *   * วัน/ทีมล่าสุดมาจาก view `v_ig_collection_monthly`
 */
import type { TeamKind } from "@/lib/service/teamKind";

export type ContractStatus = "active" | "expired_pending_collection" | "closed" | "cancelled";

/** การเก็บ/ไม่เก็บล่าสุดของสัญญา */
export interface LastAction {
  /** 'YYYY-MM-DD' */
  date: string;
  kind: "collected" | "not_collected";
  teamId: string | null;
  /** เหตุผลที่ไม่เก็บ (เฉพาะ kind = not_collected) */
  reasons: string[];
}

export interface CollectionRow {
  contractId: string;
  customerId: string;
  customerName: string;
  branchName: string;
  /** 'central' | 'province' — ใช้ตัดสินว่า recorder อยู่ในขอบเขตหรือไม่ (ตรง contract_in_scope ที่ DB) */
  division: string;
  contractNo: string;
  startDate: string;
  /** วันสิ้นสุดที่ใช้จริง (end_date ถ้ามี ไม่งั้น เริ่ม + N เดือน − 1 วัน) 'YYYY-MM-DD' */
  endDate: string;
  termMonths: number;
  status: ContractStatus;
  closedAt: string | null;
  cancelledAt: string | null;
  igTotal: number;
  collected: number;
  notCollected: number;
  moved: number;
  remaining: number;
  last: LastAction | null;
  /** เดือน 'YYYY-MM' ที่จัดการ IG ครบ (remaining = 0) — null ถ้ายังค้าง */
  finishMonth: string | null;
  /** จำนวนที่ทำ "เดือนนี้" (ตามวันที่เก็บ/เข้าไป) */
  collectedThisMonth: number;
  notCollectedThisMonth: number;
  /** ทีมประจำสัญญา (contract_teams) — ค่าเริ่มต้นในฟอร์ม */
  teamIds: string[];
}

export interface TeamOption {
  id: string;
  code: string;
  kind: TeamKind;
  isActive: boolean;
}

/** แถวสัญญาที่ถูกซ่อนเพราะมีเรื่องตกบริการรอชดเชย (mockup: โน้ต "ยังไม่ขึ้นรายการเก็บสถานี") */
export interface HeldContract {
  contractId: string;
  customerName: string;
  missedMonth: string;
}

export type StatusFilter = "open" | "wait" | "done" | "skip" | "all";

export type MonthFilter =
  | { kind: "all" }
  | { kind: "month"; month: string }
  | { kind: "range"; from: string; to: string };
