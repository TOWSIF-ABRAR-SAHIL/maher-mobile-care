-- Stock sync: product sale lines become real inventory sales.
-- Additive only — every existing Service/SaleItem row keeps its data and gets
-- a deterministic default. No table is rebuilt or dropped.

-- One product-sale bill holder per visit. Legacy rows are all DEVICE jobs.
ALTER TABLE "Service" ADD COLUMN "entryKind" TEXT NOT NULL DEFAULT 'DEVICE';
CREATE INDEX "Service_entryKind_idx" ON "Service"("entryKind");

-- Product line bookkeeping.
ALTER TABLE "SaleItem" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PRODUCT';
ALTER TABLE "SaleItem" ADD COLUMN "discount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SaleItem" ADD COLUMN "advanceAllocated" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SaleItem" ADD COLUMN "buyPrice" INTEGER;
ALTER TABLE "SaleItem" ADD COLUMN "returnedAt" DATETIME;
ALTER TABLE "SaleItem" ADD COLUMN "restockedAt" DATETIME;
ALTER TABLE "SaleItem" ADD COLUMN "returnKind" TEXT;

-- Ledger audit fields. `relatedServiceId` stays NULL for new movements so the
-- legacy dedupe index never blocks a second sale/return cycle.
ALTER TABLE "StockMovement" ADD COLUMN "saleItemId" INTEGER;
ALTER TABLE "StockMovement" ADD COLUMN "refType" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "refId" INTEGER;
ALTER TABLE "StockMovement" ADD COLUMN "unitCost" INTEGER;
ALTER TABLE "StockMovement" ADD COLUMN "unitPrice" INTEGER;
ALTER TABLE "StockMovement" ADD COLUMN "note" TEXT;
CREATE INDEX "StockMovement_saleItemId_idx" ON "StockMovement"("saleItemId");
CREATE INDEX "StockMovement_refType_refId_idx" ON "StockMovement"("refType", "refId");

-- Archive timestamp (the boolean remains the source of truth).
ALTER TABLE "Product" ADD COLUMN "archivedAt" DATETIME;

-- Reconcile the ledger with the on-hand quantity. A product whose movements do
-- not sum to its stock (e.g. rows edited before the ledger existed) gets one
-- ADJUSTMENT row so future sales still explain themselves. Products that
-- already reconcile produce no row.
INSERT INTO "StockMovement"
  ("productId", "movementType", "quantity", "previousStock", "newStock", "reason")
SELECT
  p."id",
  'ADJUSTMENT',
  p."stock" - COALESCE(SUM(m."quantity"), 0),
  COALESCE(SUM(m."quantity"), 0),
  p."stock",
  'স্টক লেজার মিলন'
FROM "Product" p
LEFT JOIN "StockMovement" m ON m."productId" = p."id"
GROUP BY p."id", p."stock"
HAVING p."stock" <> COALESCE(SUM(m."quantity"), 0);
