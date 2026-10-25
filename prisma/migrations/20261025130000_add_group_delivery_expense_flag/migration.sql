-- Multiple devices per visit, expected/actual delivery dates, and a flag that
-- cancels a returned job's parts cost from reports while keeping it for audit.
ALTER TABLE "Service" ADD COLUMN "expenseWrittenOff" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Service" ADD COLUMN "groupId" TEXT;
ALTER TABLE "Service" ADD COLUMN "deliveryDate" DATETIME;
ALTER TABLE "Service" ADD COLUMN "deliveredAt" DATETIME;

CREATE INDEX "Service_groupId_idx" ON "Service"("groupId");
