-- Service part resolution (additive only).
--
-- Every existing part row is implicitly USED, so no historical device cost,
-- supplier bill or profit figure changes. The four states are:
-- USED (default, device cost), MOVED_TO_STOCK (stock, no device cost),
-- RETURNED (no device cost, excluded from supplier balance) and DAMAGED
-- (internal Service.damageLoss, still payable to the supplier).
ALTER TABLE "ServicePart" ADD COLUMN "partStatus" TEXT NOT NULL DEFAULT 'USED';
ALTER TABLE "ServicePart" ADD COLUMN "resolutionNote" TEXT;
ALTER TABLE "ServicePart" ADD COLUMN "targetProductId" INTEGER;
ALTER TABLE "ServicePart" ADD COLUMN "resolvedAt" DATETIME;

CREATE INDEX "ServicePart_partStatus_idx" ON "ServicePart"("partStatus");
