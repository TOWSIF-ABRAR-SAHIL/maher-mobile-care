/* Shared DTOs between API routes and client components. */

export interface ServiceDTO {
  id: number;
  customerName: string;
  phone: string;
  model: string;
  technician: string;
  problem: string;
  totalBill: number;
  advance: number;
  due: number;
  status: string;
  shopExpense: string | null;
  expenseAmount: number;
  /** Internal only: parts-purchase shop name (never printed for customers). */
  partsShop: string | null;
  /** Set when an unfinished job is returned to the customer. */
  returnedAt: string | null;
  /** Full advance returned with a Returned job. Internal ledger value. */
  refundAmount: number;
  refundNote: string | null;
  /** Internal only: shop-borne repair/compensation for technician damage. */
  damageLoss: number;
  damageNote: string | null;
  serviceDate: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Shop roster entry (v1.1). `isActive=false` means the technician left. */
export interface TechnicianDTO {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface TechStat {
  technician: string;
  /** false = no longer on the roster but has rows on the shown date, so the
   *  card is greyed out instead of disappearing (day totals must reconcile). */
  isActive: boolean;
  count: number;
  bill: number;
}

export interface DayStats {
  /** Non-returned jobs only. */
  count: number;
  /** Non-returned jobs only. */
  bill: number;
  /** Non-returned jobs only. */
  due: number;
  /** Normal shop expense (parts etc.), including returned jobs. */
  expense: number;
  /** Internal damage loss, including returned jobs. */
  damageLoss: number;
  /** Cash returned today on Returned jobs. */
  refund: number;
  /** How many of the day's rows are Returned (not part of `count`). */
  returnedCount: number;
  codeCount: number;
}

export interface StatsResponse {
  date: string;
  techStats: TechStat[];
  today: DayStats;
}

export interface MonthlySummary {
  /** Non-returned jobs only. */
  count: number;
  /** Non-returned jobs only. */
  bill: number;
  /** Normal shop expense (parts etc.), including returned jobs. */
  expense: number;
  /** Non-returned jobs only. */
  due: number;
  /** bill - expense - damageLoss. */
  profit: number;
  /** Internal damage loss, including returned jobs. */
  damageLoss: number;
  /** Cash returned on Returned jobs. Already excluded from `bill`; memo only. */
  refund: number;
  /** How many rows are Returned (not part of `count`). */
  returnedCount: number;
}

export interface MonthlyResponse {
  from: string;
  to: string;
  summary: MonthlySummary;
}

/** Summary window mode — presets follow the navbar date, custom is free. */
export type RangeMode = "rolling30" | "thisMonth" | "lastMonth" | "custom";
