import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { prisma } from "@/lib/prisma";
import { resolveBackupDir, resolveDatabaseFile } from "@/lib/db-path";
import { getCipherConfig } from "@/lib/shop-settings";
import {
  CORRUPTED_BACKUP_ERROR,
  UPLOAD_NAME_RE,
  allocateRestoreTempFile,
  cleanupRestoreTemp,
  inspectBackupFile,
  materializeUpload,
} from "@/lib/backup-restore-file";
import {
  encodeShopExpenseAmount,
  normalizeShopExpense,
} from "@/lib/expense-code";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Upload contract: .db, .sqlite, .sql and .maherbackup. Every upload is stored
// as a fresh `temp-restore-*.db`, quick-checked read-only, then removed with its
// `-wal`/`-shm` sidecars. Reported models use the public names Service, Product,
// CustomerPayment (Payment), SupplierExpense (Purchase), Technician and the
// reserved AuditLog (raw Service audit) — old snapshots may omit any of them.

// Only our own generated filenames — no paths, no traversal.
const NAME_RE = /^(maher-\d{8}-\d{6}(-\d{3})?|safety-\d{8}-\d{6}(-\d{3})?)\.db$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** Windows paths need forward slashes inside a SQLite literal. */
const sqlPath = (value: string) => value.replace(/\\/g, "/").replace(/'/g, "''");

/**
 * Emergency copy of the ACTIVE database, kept beside it as
 * `shop.db.pre-restore.bak`. This is deliberately separate from the timestamped
 * snapshot history: it is the one-click rollback if a restore goes wrong.
 * The local `maher-db-location.json` pointer is never touched.
 */
async function writeEmergencySnapshot(): Promise<string> {
  const target = join(dirname(resolveDatabaseFile()), "shop.db.pre-restore.bak");
  try {
    if (existsSync(target)) unlinkSync(target);
  } catch {
    /* VACUUM INTO below reports a real failure if the old copy is locked */
  }
  mkdirSync(dirname(target), { recursive: true });
  await prisma.$executeRawUnsafe(`VACUUM INTO '${sqlPath(target)}'`);
  return target;
}

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, "0")}`;
}

const SERVICE_REQUIRED = [
  "id", "customerName", "phone", "model", "technician", "problem",
  "totalBill", "advance", "due", "status", "shopExpense", "expenseAmount",
  "serviceDate", "archived", "createdAt", "updatedAt",
];
// Columns added after the original backup format. A v1.0.3 snapshot must
// still restore, so a missing optional column is skipped rather than rejecting
// the whole file. Nullable columns then default to NULL; refundAmount and
// damageLoss use their schema DEFAULT 0.
const SERVICE_OPTIONAL = [
  "partsShop",
  "returnedAt",
  "refundAmount",
  "refundNote",
  "inspectionFee",
  "returnReason",
  "damageLoss",
  "damageNote",
  "expenseWrittenOff",
  "groupId",
  "deliveryDate",
  "deliveredAt",
  "imei",
  "customerAddress",
  "warranty",
  "saleRef",
  "entryKind",
  "solution",
  "condition",
  "verified",
  "verifiedAt",
];

interface TableSpec {
  name: string;
  required: string[];
  optional: string[];
}

// Inventory tables travel with the same snapshot. If a very old snapshot does
// not have them, live inventory is left untouched rather than wiped.
const INVENTORY_TABLES: TableSpec[] = [
  {
    name: "ProductCategory",
    required: ["id", "name", "nameKey", "createdAt", "updatedAt"],
    optional: [],
  },
  {
    name: "Product",
    required: [
      "id", "name", "sku", "barcode", "categoryId", "brand", "description",
      "supplier", "sellingPrice", "purchasePrice", "stock",
      "lowStockThreshold", "archived", "createdAt", "updatedAt",
    ],
    optional: ["archivedAt"],
  },
  {
    name: "SaleItem",
    required: [
      "id", "serviceId", "productId", "nameSnapshot", "skuSnapshot",
      "quantity", "unitPrice", "lineTotal", "unitCost", "createdAt",
    ],
    optional: [
      "kind", "discount", "advanceAllocated", "buyPrice", "returnedAt",
      "restockedAt", "returnKind", "priceNote",
    ],
  },
  {
    name: "StockMovement",
    required: [
      "id", "productId", "movementType", "quantity", "previousStock",
      "newStock", "reason", "relatedServiceId", "createdAt",
    ],
    optional: [
      "saleItemId", "refType", "refId", "unitCost", "unitPrice", "note",
    ],
  },
];

const INVENTORY_DELETE_ORDER = [
  "SaleItem",
  "StockMovement",
  "Product",
  "ProductCategory",
];

/**
 * Phase 2 money tables. They travel with a snapshot exactly like inventory:
 * a snapshot that carries them replaces the live copies; a snapshot older than
 * Phase 2 leaves the live database with EMPTY payment/purchase history (those
 * rows cannot be reconciled with the restored Service table, so keeping them
 * would be worse than dropping them). Deleting is always safe because the
 * swap runs inside the same BEGIN IMMEDIATE transaction as the Service insert.
 */
const PHASE2_TABLES: TableSpec[] = [
  {
    name: "Payment",
    required: [
      "id", "customerKey", "customerName", "phone", "amount", "method",
      "note", "paidAt", "createdAt",
    ],
    optional: [],
  },
  {
    name: "PaymentAllocation",
    required: ["id", "paymentId", "serviceId", "amount", "createdAt"],
    optional: [],
  },
  {
    name: "Purchase",
    required: [
      "id", "supplier", "supplierKey", "invoiceNo", "purchaseDate", "total",
      "paid", "note", "archived", "createdAt", "updatedAt",
    ],
    optional: ["purchaseType", "serviceId"],
  },
  {
    name: "PurchaseItem",
    required: [
      "id", "purchaseId", "productId", "nameSnapshot", "skuSnapshot",
      "quantity", "unitCost", "lineTotal", "createdAt",
    ],
    optional: [],
  },
  {
    name: "PurchasePayment",
    required: [
      "id", "supplierKey", "supplier", "amount", "method", "note", "paidAt",
      "createdAt",
    ],
    optional: [],
  },
  {
    name: "PurchasePaymentAllocation",
    required: ["id", "paymentId", "purchaseId", "amount", "createdAt"],
    optional: [],
  },
];

const PHASE2_DELETE_ORDER = [
  "PaymentAllocation",
  "Payment",
  "PurchasePaymentAllocation",
  "PurchasePayment",
  "PurchaseItem",
  "Purchase",
];

const PHASE2_INSERT_ORDER = [
  "Payment",
  "PaymentAllocation",
  "Purchase",
  "PurchaseItem",
  "PurchasePayment",
  "PurchasePaymentAllocation",
];

/**
 * Phase 3 parts ledger. Same policy as Phase 2: a snapshot that carries
 * `ServicePart` replaces the live rows, while a pre-Phase-3 snapshot leaves the
 * shop with no itemized parts (a dangling cost cannot be reconciled with the
 * restored Service table). Rows without parts keep their `expenseAmount`, so
 * restoring an old snapshot never changes a reported figure.
 */
const PHASE3_TABLES: TableSpec[] = [
  {
    name: "ServicePart",
    required: [
      "id", "serviceId", "productId", "nameSnapshot", "skuSnapshot",
      "quantity", "unitCost", "lineCost", "supplier", "note", "createdAt",
    ],
    optional: [
      "supplierKey", "priceCode", "purchaseDate", "paidAt", "paidNote",
      "partStatus", "resolutionNote", "targetProductId", "resolvedAt",
    ],
  },
];

/**
 * POST /api/backup/restore { file }
 * Replaces live data with a snapshot. A pre-restore safety copy is taken
 * first, so a wrong restore is itself restorable. Single-user local app —
 * sequential statements on one connection are safe enough.
 */
export async function POST(req: NextRequest) {
  let attached = false;
  let tempAbs: string | null = null;
  let inventoryWarning: string | null = null;
  let phase2Warning: string | null = null;
  let phase3Warning: string | null = null;
  let source: "snapshot" | "upload" = "snapshot";
  try {
    const BACKUP_DIR = resolveBackupDir();
    mkdirSync(BACKUP_DIR, { recursive: true });

    let abs: string;
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      const candidate = form?.get("file");
      if (
        !candidate ||
        typeof candidate === "string" ||
        typeof candidate.arrayBuffer !== "function"
      ) {
        return NextResponse.json({ error: "ভুল ব্যাকআপ ফাইল" }, { status: 400 });
      }
      const name = candidate.name || "upload.db";
      if (!UPLOAD_NAME_RE.test(name)) {
        return NextResponse.json({ error: "ভুল ব্যাকআপ ফাইল" }, { status: 400 });
      }
      const uploaded = Buffer.from(await candidate.arrayBuffer());
      abs = allocateRestoreTempFile();
      tempAbs = abs;
      if (!materializeUpload(uploaded, name, abs)) {
        return NextResponse.json(
          { error: CORRUPTED_BACKUP_ERROR },
          { status: 400 }
        );
      }
      source = "upload";
    } else {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const file = String(body?.file ?? "");
      if (!NAME_RE.test(file)) {
        return NextResponse.json({ error: "ভুল ব্যাকআপ ফাইল" }, { status: 400 });
      }
      abs = resolve(BACKUP_DIR, file);
      if (!abs.startsWith(resolve(BACKUP_DIR)) || !existsSync(abs)) {
        return NextResponse.json(
          { error: "ব্যাকআপ ফাইল পাওয়া যায়নি" },
          { status: 404 }
        );
      }
    }

    // ShopSettings is never part of this swap. An uploaded snapshot may carry
    // its own ShopSettings table; none of the SQL below ever reads or writes
    // it, so the local id=1 row (branding + device fingerprint) stays intact.

    // 0) Read-only quick_check before anything else. A file with valid magic
    //    bytes but damaged pages must be refused with the exact shop message.
    const quick = inspectBackupFile(abs);
    if (!quick.ok) {
      return NextResponse.json(
        { error: quick.error ?? CORRUPTED_BACKUP_ERROR },
        { status: 400 }
      );
    }
    // Essential-table metadata is reported (not enforced): snapshots older
    // than the inventory/payment migrations must still be restorable.
    const essential = quick.essential;
    const missingEssential = quick.missingEssential;

    // 1) Inspect the snapshot (read-only): tables, columns, row counts.
    //    The column check is the important one — an old snapshot (e.g. taken
    //    before a migration added a column) passes the table check, and would
    //    otherwise be swapped in after DELETE, failing the INSERT and leaving
    //    live data empty.
    let incoming = 0;
    let missingCols: string[] = [];
    const snapshotCols = new Set<string>();
    const inventoryCols = new Map<string, Set<string>>();
    const inventoryCounts = new Map<string, number>();
    let hasInventory = false;
    const phase2Cols = new Map<string, Set<string>>();
    const phase2Counts = new Map<string, number>();
    let hasPhase2 = false;
    const phase3Cols = new Map<string, Set<string>>();
    const phase3Counts = new Map<string, number>();
    let hasPhase3 = false;
    let inspectionError: string | null = null;
    try {
      const snap = new Database(abs, { readonly: true });
      try {
        const hasTable = snap
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='Service'"
          )
          .get();
        if (!hasTable) throw new Error("not a service backup");

        const tableNames = new Set(
          (
            snap
              .prepare("SELECT name FROM sqlite_master WHERE type='table'")
              .all() as { name: string }[]
          ).map((row) => row.name)
        );

        const colsOf = (table: string) =>
          new Set(
            (
              snap.prepare(`PRAGMA table_info("${table}")`).all() as {
                name: string;
              }[]
            ).map((c) => c.name)
          );
        const countOf = (table: string) =>
          (
            snap.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as {
              n: number;
            }
          ).n;

        const serviceCols = colsOf("Service");
        for (const col of serviceCols) snapshotCols.add(col);
        missingCols = SERVICE_REQUIRED.filter((c) => !serviceCols.has(c));
        incoming = countOf("Service");

        hasInventory = INVENTORY_TABLES.every((spec) =>
          tableNames.has(spec.name)
        );
        if (hasInventory) {
          for (const spec of INVENTORY_TABLES) {
            const cols = colsOf(spec.name);
            const missing = spec.required.filter((c) => !cols.has(c));
            if (missing.length > 0) {
              throw new Error(
                `__missing__${spec.name}: ${missing.join(", ")}`
              );
            }
            inventoryCols.set(spec.name, cols);
            inventoryCounts.set(spec.name, countOf(spec.name));
          }
        }

        hasPhase2 = PHASE2_TABLES.every((spec) =>
          tableNames.has(spec.name)
        );
        if (hasPhase2) {
          for (const spec of PHASE2_TABLES) {
            const cols = colsOf(spec.name);
            const missing = spec.required.filter((c) => !cols.has(c));
            if (missing.length > 0) {
              throw new Error(
                `__missing__${spec.name}: ${missing.join(", ")}`
              );
            }
            phase2Cols.set(spec.name, cols);
            phase2Counts.set(spec.name, countOf(spec.name));
          }
        }

        hasPhase3 = PHASE3_TABLES.every((spec) =>
          tableNames.has(spec.name)
        );
        if (hasPhase3) {
          for (const spec of PHASE3_TABLES) {
            const cols = colsOf(spec.name);
            const missing = spec.required.filter((c) => !cols.has(c));
            if (missing.length > 0) {
              throw new Error(
                `__missing__${spec.name}: ${missing.join(", ")}`
              );
            }
            phase3Cols.set(spec.name, cols);
            phase3Counts.set(spec.name, countOf(spec.name));
          }
        }
      } finally {
        snap.close();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      inspectionError = message.startsWith("__missing__")
        ? message.slice("__missing__".length)
        : null;
      if (!inspectionError) {
        return NextResponse.json(
          { error: "ব্যাকআপ ফাইল নষ্ট" },
          { status: 400 }
        );
      }
    }
    if (inspectionError) {
      return NextResponse.json(
        {
          error: `পুরোনো বা অসম্পূর্ণ ব্যাকআপ — ফিরিয়ে আনা যাবে না (${inspectionError})`,
        },
        { status: 400 }
      );
    }
    if (missingCols.length > 0) {
      return NextResponse.json(
        {
          error: `পুরোনো বা অসম্পূর্ণ ব্যাকআপ — ফিরিয়ে আনা যাবে না (${missingCols.join(
            ", "
          )} কলাম নেই)`,
        },
        { status: 400 }
      );
    }

    // New snapshots carry optional columns; old ones omit them. Skipping a
    // nullable column leaves NULL; skipping refundAmount/damageLoss applies
    // their DEFAULT 0, which is exactly the pre-v1.1.2 behaviour.
    const insertCols = [
      ...SERVICE_REQUIRED,
      ...SERVICE_OPTIONAL.filter((c) => snapshotCols.has(c)),
    ];
    const insertColList = insertCols.join(", ");

    const inventoryInsertCols = (spec: TableSpec): string => {
      const cols = inventoryCols.get(spec.name)!;
      return [
        ...spec.required,
        ...spec.optional.filter((c) => cols.has(c)),
      ].join(", ");
    };

    const phase2InsertCols = (spec: TableSpec): string => {
      const cols = phase2Cols.get(spec.name)!;
      return [
        ...spec.required,
        ...spec.optional.filter((c) => cols.has(c)),
      ].join(", ");
    };

    const phase3InsertCols = (spec: TableSpec): string => {
      const cols = phase3Cols.get(spec.name)!;
      return [
        ...spec.required,
        ...spec.optional.filter((c) => cols.has(c)),
      ].join(", ");
    };

    // 2a) Emergency rollback copy beside the active DB file. This is the
    //     `shop.db.pre-restore.bak` the shopkeeper can rename back manually.
    const emergency = await writeEmergencySnapshot();

    // 2b) Timestamped safety copy in the snapshot history.
    const safety = `safety-${stamp()}.db`;
    const safetyAbs = join(BACKUP_DIR, safety);
    // Windows paths (C:\..., spaces) are normalized to forward slashes —
    // SQLite accepts them, backslashes do not survive quoting reliably.
    const q = (s: string) => s.replace(/\\/g, "/").replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${q(safetyAbs)}'`);

    // 3) Swap live table contents with the snapshot's — atomically.
    //    ATTACH must run outside a transaction (SQLite rule). From there,
    //    BEGIN IMMEDIATE … COMMIT means any failure (or a power cut) rolls
    //    back every DELETE too: live data can never be left empty by a
    //    half-finished restore.
    await prisma.$executeRawUnsafe(`ATTACH DATABASE '${q(abs)}' AS snap`);
    attached = true;
    await prisma.$executeRawUnsafe("BEGIN IMMEDIATE");
    try {
      if (hasInventory) {
        // Children first: SaleItem/StockMovement then Product → Category.
        for (const table of INVENTORY_DELETE_ORDER) {
          await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
        }
      }
      // Payment/purchase history always resets: it cannot be reconciled with
      // a Service table from a snapshot that predates Phase 2.
      for (const table of PHASE2_DELETE_ORDER) {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
      }
      // Parts belong to Service rows: wiped first so a snapshot swap can never
      // leave a parts row pointing at a replaced Service id.
      for (const table of PHASE3_TABLES) {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table.name}"`);
      }
      await prisma.$executeRawUnsafe(`DELETE FROM Service`);
      const inserted = await prisma.$executeRawUnsafe(
        `INSERT INTO Service (${insertColList}) SELECT ${insertColList} FROM snap.Service`
      );
      if (inserted !== incoming) {
        throw new Error(`restored ${inserted} rows, expected ${incoming}`);
      }

      if (hasInventory) {
        const order = ["ProductCategory", "Product", "SaleItem", "StockMovement"];
        for (const table of order) {
          const spec = INVENTORY_TABLES.find((s) => s.name === table)!;
          const cols = inventoryInsertCols(spec);
          const expected = inventoryCounts.get(table) ?? 0;
          const written = await prisma.$executeRawUnsafe(
            `INSERT INTO "${table}" (${cols}) SELECT ${cols} FROM snap."${table}"`
          );
          if (written !== expected) {
            throw new Error(
              `restored ${written} ${table} rows, expected ${expected}`
            );
          }
        }
      } else {
        // Old snapshot without inventory tables: the sale/stock history cannot
        // come back, so those two tables start empty. Products (and their
        // current stock) are kept, and one adjustment per product makes the
        // empty ledger reconcile with the retained quantity.
        await prisma.$executeRawUnsafe(`DELETE FROM SaleItem`);
        await prisma.$executeRawUnsafe(`DELETE FROM StockMovement`);
        await prisma.$executeRawUnsafe(
          `INSERT INTO StockMovement
             ("productId", "movementType", "quantity", "previousStock", "newStock", "reason")
           SELECT "id", 'ADJUSTMENT', "stock", 0, "stock", 'পুরোনো ব্যাকআপের পর স্টক সমন্বয়'
           FROM "Product"
           WHERE "stock" > 0`
        );
        inventoryWarning =
          "পুরোনো ব্যাকআপ — প্রোডাক্ট বিক্রয় ও স্টক হিস্ট্রি খালি হয়েছে; বর্তমান প্রোডাক্ট তালিকা ও স্টক রাখা হয়েছে।";
      }

      if (hasPhase2) {
        for (const table of PHASE2_INSERT_ORDER) {
          const spec = PHASE2_TABLES.find((s) => s.name === table)!;
          const cols = phase2InsertCols(spec);
          const expected = phase2Counts.get(table) ?? 0;
          const written = await prisma.$executeRawUnsafe(
            `INSERT INTO "${table}" (${cols}) SELECT ${cols} FROM snap."${table}"`
          );
          if (written !== expected) {
            throw new Error(
              `restored ${written} ${table} rows, expected ${expected}`
            );
          }
        }
      } else {
        phase2Warning =
          "পুরোনো ব্যাকআপ — কাস্টমার পেমেন্ট ও দোকানের ক্রয়ের হিস্ট্রি খালি হয়েছে।";
      }

      if (hasPhase3) {
        const spec = PHASE3_TABLES[0];
        const cols = phase3InsertCols(spec);
        const expected = phase3Counts.get(spec.name) ?? 0;
        const written = await prisma.$executeRawUnsafe(
          `INSERT INTO "ServicePart" (${cols}) SELECT ${cols} FROM snap."ServicePart"`
        );
        if (written !== expected) {
          throw new Error(
            `restored ${written} ServicePart rows, expected ${expected}`
          );
        }
      } else {
        phase3Warning =
          "পুরোনো ব্যাকআপ — ডিভাইসের পার্টস খাতা খালি হয়েছে; পুরোনো রেকর্ডের খরচ আগের মতো থাকবে।";
      }

      await prisma.$executeRawUnsafe("COMMIT");
    } catch (err) {
      try {
        await prisma.$executeRawUnsafe("ROLLBACK");
      } catch {
        /* transaction already gone — nothing left to roll back */
      }
      throw err;
    }

    // Old snapshots stored a plain number in shopExpense. Convert those rows
    // to the canonical code after the restore, so the dashboard never exposes
    // a restored numeric cost. Best-effort: a restore must not be reported as
    // failed just because this post-processing hit an unrelated error; the
    // next app start (first-run) repeats the same normalization.
    let normalizedExpenses = 0;
    try {
      // ShopSettings is deliberately not restored, so the active cipher is
      // the one the restored codes were written with. Using the default
      // keypad map here would silently mis-decode a custom-word snapshot.
      const cipher = await getCipherConfig();
      const rows = await prisma.service.findMany({
        select: { id: true, shopExpense: true, expenseAmount: true },
      });
      const changes: {
        id: number;
        shopExpense: string | null;
        expenseAmount: number;
      }[] = [];
      for (const row of rows) {
        const normalized = normalizeShopExpense(row.shopExpense, cipher);
        if (normalized.kind === "invalid") continue;
        if (normalized.kind === "empty" && row.expenseAmount < 0) continue;
        let nextCode = normalized.stored;
        let nextAmount = normalized.amount ?? 0;
        // Preserve an amount-only row by rebuilding its code.
        if (
          normalized.kind === "empty" &&
          Number.isSafeInteger(row.expenseAmount) &&
          row.expenseAmount > 0
        ) {
          try {
            nextCode = encodeShopExpenseAmount(row.expenseAmount, cipher);
            nextAmount = row.expenseAmount;
          } catch {
            continue;
          }
        }
        if (
          nextCode !== (row.shopExpense ?? null) ||
          nextAmount !== row.expenseAmount
        ) {
          changes.push({
            id: row.id,
            shopExpense: nextCode,
            expenseAmount: nextAmount,
          });
        }
      }
      if (changes.length > 0) {
        await prisma.$transaction(
          changes.map((change) =>
            prisma.service.update({
              where: { id: change.id },
              data: {
                shopExpense: change.shopExpense,
                expenseAmount: change.expenseAmount,
              },
            })
          )
        );
        normalizedExpenses = changes.length;
      }
    } catch (err) {
      console.error("Expense normalization after restore failed:", err);
    }

    const live = await prisma.service.count();
    const productsCount = await prisma.product.count();
    return NextResponse.json({
      ok: true,
      restored: live,
      incoming,
      servicesCount: live,
      productsCount,
      safety,
      emergency,
      source,
      normalizedExpenses,
      inventory: hasInventory,
      essential,
      missingEssential,
      detectedTables: quick.tables,
      detectedCounts: quick.counts,
      ...((inventoryWarning || phase2Warning || phase3Warning)
        ? {
            warning: [inventoryWarning, phase2Warning, phase3Warning]
              .filter(Boolean)
              .join(" "),
          }
        : {}),
    });
  } catch (err) {
    console.error("POST /api/backup/restore failed:", err);
    return NextResponse.json(
      { error: "ফিরিয়ে আনা যায়নি" },
      { status: 500 }
    );
  } finally {
    if (attached) {
      try {
        await prisma.$executeRawUnsafe(`DETACH DATABASE snap`);
      } catch {
        /* connection will reset on next restart */
      }
    }
    if (tempAbs) cleanupRestoreTemp(tempAbs);
  }
}
