-- Service parts purchase ledger (additive only).
--
-- Five nullable columns turn an itemized part line into a purchase record:
-- supplier identity, the keypad price code, the real purchase date and the
-- paid marker/history. Existing rows keep NULL in every new column, which the
-- app treats as "legacy, unknown date": never counted in Paid/Unpaid totals
-- and never silently rewritten. No existing value is changed here.

ALTER TABLE "ServicePart" ADD COLUMN "supplierKey" TEXT;
ALTER TABLE "ServicePart" ADD COLUMN "priceCode" TEXT;
ALTER TABLE "ServicePart" ADD COLUMN "purchaseDate" DATETIME;
ALTER TABLE "ServicePart" ADD COLUMN "paidAt" DATETIME;
ALTER TABLE "ServicePart" ADD COLUMN "paidNote" TEXT;

CREATE INDEX "ServicePart_purchaseDate_idx" ON "ServicePart"("purchaseDate");
CREATE INDEX "ServicePart_supplierKey_idx" ON "ServicePart"("supplierKey");
CREATE INDEX "ServicePart_paidAt_idx" ON "ServicePart"("paidAt");
