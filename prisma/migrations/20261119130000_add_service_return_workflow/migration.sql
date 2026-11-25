-- Customer device return workflow (additive only).
--
-- Existing rows keep a zero fee and no reason, so no historical bill, profit or
-- report figure changes. A fee return records the retained diagnostic charge
-- here and promotes it to the row's final bill/advance when the refund is made.
ALTER TABLE "Service" ADD COLUMN "inspectionFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Service" ADD COLUMN "returnReason" TEXT;
