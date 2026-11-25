-- Phase 3: distinguish inventory stock bills from repair-part bills.
-- Existing purchases remain STOCK and keep their current behavior.
ALTER TABLE "Purchase" ADD COLUMN "purchaseType" TEXT NOT NULL DEFAULT 'STOCK';
ALTER TABLE "Purchase" ADD COLUMN "serviceId" INTEGER;

CREATE INDEX "Purchase_purchaseType_idx" ON "Purchase"("purchaseType");
CREATE INDEX "Purchase_serviceId_idx" ON "Purchase"("serviceId");
