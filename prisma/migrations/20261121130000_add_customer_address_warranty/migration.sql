-- Optional customer address (visit-level) and device warranty (row-level).
-- Additive only: existing jobs keep NULL, so no historical money or report
-- figure changes and old snapshots without these columns still restore.
ALTER TABLE "Service" ADD COLUMN "customerAddress" TEXT;
ALTER TABLE "Service" ADD COLUMN "warranty" TEXT;
