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
  serviceDate: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TechStat {
  technician: string;
  count: number;
  bill: number;
}

export interface DayStats {
  count: number;
  bill: number;
  due: number;
  expense: number;
  codeCount: number;
}

export interface StatsResponse {
  date: string;
  techStats: TechStat[];
  today: DayStats;
}

export interface MonthlySummary {
  count: number;
  bill: number;
  expense: number;
  due: number;
  profit: number;
}

export interface MonthlyResponse {
  from: string;
  to: string;
  summary: MonthlySummary;
}

/** Summary window mode — presets follow the navbar date, custom is free. */
export type RangeMode = "rolling30" | "thisMonth" | "lastMonth" | "custom";
