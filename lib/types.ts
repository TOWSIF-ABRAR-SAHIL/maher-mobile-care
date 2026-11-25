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
  /** Internal work-done note for this device; never printed on a receipt. */
  solution?: string | null;
  /** Customer terms for the visit; printed only on the customer copy. */
  condition?: string | null;
  /** Set when an unfinished job is returned to the customer. */
  returnedAt: string | null;
  /** Full advance returned with a Returned job. Internal ledger value. */
  /** Cash handed back to the customer. */
  refundAmount: number;
  refundNote: string | null;
  /** Diagnostic fee retained on a returned job; final bill when fee > 0. */
  inspectionFee: number;
  /** Internal reason the customer returned the device. */
  returnReason: string | null;
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
  /** Optional delivery address for the visit; printed on customer slips. */
  customerAddress: string | null;
  /** Optional warranty term for this device; printed on customer slips. */
  warranty: string | null;
  /** Reserved for the not-yet-wired product-sale link (internal only). */
  saleRef?: string | null;
  /** Shared by every device row from one customer visit, or null. */
  groupId: string | null;
  /** DEVICE = repair job; PRODUCT = the visit's product-sale bill holder. */
  entryKind?: string;
  /** Product lines for this row (empty for a plain device/service job). */
  saleItems?: SaleItemDTO[];
  /** Expected handover date (YYYY-MM-DD), or null. */
  deliveryDate: string | null;
  /** Actual handover time, set automatically when status becomes Delivered. */
  deliveredAt: string | null;
  /** Manual bookkeeping tick: the shopkeeper checked this slip's money. */
  verified?: boolean;
  verifiedAt?: string | null;
  /**
   * Derived repair cost of this device's itemized parts, or `null` when it has
   * none (then its খরচ is the shop-expense lump). Internal only.
   */
  partsCost?: number | null;
  /** The device's part lines, when the caller asked for them (edit form). */
  parts?: ServicePartDTO[];
  serviceDate: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Whole-line resolution of a service part. Old rows are implicitly USED. */
export type ServicePartResolutionStatus =
  | "USED"
  | "MOVED_TO_STOCK"
  | "RETURNED"
  | "DAMAGED"
  | "KEPT_IN_LEDGER";

/**
 * One part used on one device. `lineCost` is the device's repair cost when it
 * has parts (it replaces that row's shop-expense lump). Internal only: no
 * receipt or PDF may show a part name, unit cost or total.
 */
export interface ServicePartDTO {
  id: number;
  serviceId: number;
  name: string;
  sku: string | null;
  quantity: number;
  unitCost: number;
  lineCost: number;
  supplier: string | null;
  /** Normalized supplier identity (trim + lowercase). */
  supplierKey: string | null;
  /** Stored price code (plain amounts encoded), null only on legacy rows. */
  priceCode: string | null;
  /** Purchase day "YYYY-MM-DD"; null only for a legacy unknown-date line. */
  purchaseDate: string | null;
  /** Whole-line paid marker (not a payment transaction). */
  paidAt: string | null;
  /** Append-only paid/unpaid history with timestamped reasons. */
  paidNote: string | null;
  note: string | null;
  /** USED (default), MOVED_TO_STOCK, RETURNED, DAMAGED or KEPT_IN_LEDGER. */
  partStatus: ServicePartResolutionStatus;
  resolutionNote: string | null;
  /** Product created/updated when the part entered general stock. */
  targetProductId: number | null;
  resolvedAt: string | null;
}

/** One row of the internal service-parts purchase ledger. */
export interface ServicePartLedgerRowDTO extends ServicePartDTO {
  service: {
    id: number;
    customerName: string;
    phone: string;
    model: string;
    technician: string;
    status: string;
    archived: boolean;
  } | null;
}

export interface ServicePartLedgerSummaryDTO {
  count: number;
  total: number;
  paidCount: number;
  paidTotal: number;
  unpaidCount: number;
  unpaidTotal: number;
  legacyCount: number;
  legacyAmount: number;
}

export interface ServicePartLedgerResponse {
  rows: ServicePartLedgerRowDTO[];
  summary: ServicePartLedgerSummaryDTO;
  suppliers: { name: string; key: string }[];
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
  /** Active bills + retained inspection fees on Returned jobs. */
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
  /** Active bills + retained inspection fees on Returned jobs. */
  bill: number;
  /** Advances (জমা) on non-returned jobs in this range. */
  advance: number;
  /** Normal shop expense (parts etc.) that still hit the shop; written-off
   *  return costs are excluded. */
  expense: number;
  /** Non-returned jobs only. */
  due: number;
  /** bill - expense - damageLoss - productCost. */
  profit: number;
  /** Internal cost of the sold product lines in this window. */
  productCost: number;
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
  kind?: string;
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  discount?: number;
  lineTotal: number;
  /** Waterfall part of the visit's জমা that paid this line. */
  advanceAllocated?: number;
  /** Internal cost at sale time. Never sent to the receipt renderer. */
  unitCost?: number;
  /** Last restock price snapshot at sale time. Internal only. */
  buyPrice?: number | null;
  /** Why the selling price was overridden. Internal only. */
  priceNote?: string | null;
  returnedAt?: string | null;
  restockedAt?: string | null;
  returnKind?: "CANCEL" | "RETURN" | "ARCHIVE" | string | null;
}

/* ------------------------------------------------------------------ */
/* Payments & purchases (Phase 2)                                      */
/* ------------------------------------------------------------------ */

export type PaymentMethodCode = "CASH" | "BKASH" | "OTHER";

export interface PaymentAllocationDTO {
  serviceId: number;
  amount: number;
}

export interface PaymentDTO {
  id: number;
  customerKey: string;
  customerName: string;
  phone: string;
  amount: number;
  method: PaymentMethodCode;
  note: string | null;
  paidAt: string;
  allocations: PaymentAllocationDTO[];
}

export interface OutstandingSlipDTO {
  id: number;
  customerName: string;
  phone: string;
  model: string;
  status: string;
  entryKind: string;
  serviceDate: string;
  totalBill: number;
  advance: number;
  due: number;
}

export interface CustomerLedgerResponse {
  customerKey: string;
  totalDue: number;
  slips: OutstandingSlipDTO[];
  payments: PaymentDTO[];
}

export interface PurchaseItemDTO {
  id: number;
  purchaseId: number;
  productId: number | null;
  nameSnapshot: string;
  skuSnapshot: string | null;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseDTO {
  id: number;
  purchaseType: "STOCK" | "SERVICE_PART";
  serviceId: number | null;
  supplier: string;
  supplierKey: string;
  invoiceNo: string | null;
  purchaseDate: string;
  total: number;
  paid: number;
  due: number;
  note: string | null;
  archived: boolean;
  items: PurchaseItemDTO[];
}

export interface PurchaseListResponse {
  purchases: PurchaseDTO[];
  summary: {
    count: number;
    total: number;
    paid: number;
    due: number;
  };
}
