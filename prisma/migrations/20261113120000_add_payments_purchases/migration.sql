-- Phase 2: customer payments (money in), manual verification, and shop
-- purchases (money out). Additive only — no existing row is rewritten.

-- "যাচাই হয়েছে" is a manual bookkeeping flag, separate from paid (due = 0).
ALTER TABLE "Service" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Service" ADD COLUMN "verifiedAt" DATETIME;

-- Customer receipts. `customerKey` is the normalized phone digits, or
-- `name:<exact name>` when the phone has no digits.
CREATE TABLE "Payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerKey" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "note" TEXT,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Payment_customerKey_idx" ON "Payment"("customerKey");
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- How much of a receipt settled which slip. No FK to Service: restore may
-- replace Service rows (same policy as SaleItem).
CREATE TABLE "PaymentAllocation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paymentId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");
CREATE INDEX "PaymentAllocation_serviceId_idx" ON "PaymentAllocation"("serviceId");

-- Supplier bills. Never part of service expense/profit.
CREATE TABLE "Purchase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "supplier" TEXT NOT NULL,
    "supplierKey" TEXT NOT NULL,
    "invoiceNo" TEXT,
    "purchaseDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total" INTEGER NOT NULL DEFAULT 0,
    "paid" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "Purchase_purchaseDate_idx" ON "Purchase"("purchaseDate");
CREATE INDEX "Purchase_archived_idx" ON "Purchase"("archived");
CREATE INDEX "Purchase_supplierKey_idx" ON "Purchase"("supplierKey");

CREATE TABLE "PurchaseItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "purchaseId" INTEGER NOT NULL,
    "productId" INTEGER,
    "nameSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitCost" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");
CREATE INDEX "PurchaseItem_productId_idx" ON "PurchaseItem"("productId");

-- Money paid out to a supplier, oldest open bill first.
CREATE TABLE "PurchasePayment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "supplierKey" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "note" TEXT,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "PurchasePayment_supplierKey_idx" ON "PurchasePayment"("supplierKey");
CREATE INDEX "PurchasePayment_paidAt_idx" ON "PurchasePayment"("paidAt");

CREATE TABLE "PurchasePaymentAllocation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paymentId" INTEGER NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchasePaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PurchasePayment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PurchasePaymentAllocation_paymentId_idx" ON "PurchasePaymentAllocation"("paymentId");
CREATE INDEX "PurchasePaymentAllocation_purchaseId_idx" ON "PurchasePaymentAllocation"("purchaseId");
