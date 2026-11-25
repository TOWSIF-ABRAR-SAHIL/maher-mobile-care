-- Phase 3: itemized repair parts per device. Additive only — no existing row
-- is rewritten, and any Service row without parts keeps its current cost
-- (`expenseAmount`), so every historical খরচ/লাভ figure stays identical.
--
-- `lineCost` is stored for audit but always recomputed by the server
-- (quantity × unitCost). No FK to Service: a restore may replace Service rows
-- (same policy as SaleItem / PaymentAllocation).

CREATE TABLE "ServicePart" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serviceId" INTEGER NOT NULL,
    "productId" INTEGER,
    "nameSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCost" INTEGER NOT NULL DEFAULT 0,
    "lineCost" INTEGER NOT NULL DEFAULT 0,
    "supplier" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ServicePart_serviceId_idx" ON "ServicePart"("serviceId");
CREATE INDEX "ServicePart_productId_idx" ON "ServicePart"("productId");
