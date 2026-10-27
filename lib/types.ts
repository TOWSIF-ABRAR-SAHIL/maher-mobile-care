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
  /** Set when a return also cancels the shop's parts cost (reports skip it). */
  expenseWrittenOff: boolean;
  /**
   * Optional handset IMEI, stored as text. Internal only: never rendered in the
   * service list or on a customer receipt. Device unlock credentials are NOT
   * stored at all — they live only in the open form session.
   */
  imei: string | null;
  /** Shared by every device row from one customer visit, or null. */
  groupId: string | null;
  /** Expected handover date (YYYY-MM-DD), or null. */
  deliveryDate: string | null;
  /** Actual handover time, set automatically when status becomes Delivered. */
  deliveredAt: string | null;
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
  /** Advances (জমা) on non-returned jobs whose service date is this day. */
  advance: number;
  /** Normal shop expense (parts etc.) that still hit the shop; written-off
   *  return costs are excluded. */
  expense: number;
  /** Internal damage loss, including returned jobs. */
  damageLoss: number;
  /** Refunds on Returned jobs whose service date is this day (memo only). */
  refund: number;
  /** How many of the day's rows are Returned (not part of `count`). */
  returnedCount: number;
  codeCount: number;
}

export interface StatsResponse {
  date: string;
  /** Set only for range/all queries so the UI can label the shown window. */
  range?: { from: string; to: string };
  techStats: TechStat[];
  today: DayStats;
}

/** Cross-date delivery backlog as of a Dhaka day. Counts device rows, not
 *  visits: one customer visit can hold several overdue handsets. */
export interface OverdueResponse {
  date: string;
  count: number;
  totalDue: number;
  oldestDeliveryDate: string | null;
}

export interface MonthlySummary {
  /** Non-returned jobs only. */
  count: number;
  /** Non-returned jobs only. */
  bill: number;
  /** Advances (জমা) on non-returned jobs in this range. */
  advance: number;
  /** Normal shop expense (parts etc.) that still hit the shop; written-off
   *  return costs are excluded. */
  expense: number;
  /** Non-returned jobs only. */
  due: number;
  /** bill - expense - damageLoss. */
  profit: number;
  /** Internal damage loss, including returned jobs. */
  damageLoss: number;
  /** Refunds on Returned jobs by service date. `bill` already excludes them. */
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

/** Service-list date scope. `day` is the untouched legacy default. */
export type ListMode = "day" | "range" | "all";

/**
 * Response of the additive list scopes (`?from&to` / `?all=1`). Day mode
 * keeps the legacy `{ date, services }` shape, so `date`/`total`/`hasMore`
 * are optional here.
 */
export interface ServicesListResponse {
  date?: string;
  mode?: ListMode;
  from?: string;
  to?: string;
  /** SQL count() over the whole window — the aggregate behind the cap. */
  total?: number;
  offset?: number;
  shown?: number;
  hasMore?: boolean;
  services: ServiceDTO[];
}

/* ------------------------------------------------------------------ */
/* Inventory DTOs                                                       */
/* ------------------------------------------------------------------ */

/** 0 stock = out; 0 < stock <= threshold = low; above threshold = in. */
export type StockStatus = "in" | "low" | "out";

export interface ProductCategoryDTO {
  id: number;
  name: string;
  /** Non-archived products in this category (shown in the manager). */
  activeProductCount: number;
  /** Every product, including archived ones. Deletion is blocked while > 0. */
  productCount: number;
  createdAt: string;
}

export interface ProductDTO {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  categoryId: number;
  categoryName: string;
  brand: string | null;
  description: string | null;
  supplier: string | null;
  sellingPrice: number;
  /** Internal cost — never printed on a customer receipt. */
  purchasePrice: number;
  stock: number;
  lowStockThreshold: number;
  status: StockStatus;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductSummaryDTO {
  totalProducts: number;
  categories: number;
  units: number;
  lowStock: number;
  outOfStock: number;
  /** stock × purchasePrice, summed. Internal value. */
  inventoryValue: number;
}

export interface ProductListResponse {
  products: ProductDTO[];
  summary: ProductSummaryDTO;
  categories: ProductCategoryDTO[];
}

export type StockMovementType =
  | "OPENING"
  | "STOCK_IN"
  | "STOCK_OUT"
  | "ADJUSTMENT"
  | "SALE"
  | "RETURN";

export interface StockMovementDTO {
  id: number;
  productId: number;
  movementType: StockMovementType;
  /** Signed delta: +in, −out. */
  quantity: number;
  previousStock: number;
  newStock: number;
  reason: string | null;
  relatedServiceId: number | null;
  createdAt: string;
}

/** A product line on a sale/receipt (name and price are snapshots). */
export interface SaleItemDTO {
  id: number;
  serviceId: number;
  productId: number | null;
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Internal cost at sale time. Never sent to the receipt renderer. */
  unitCost?: number;
}
