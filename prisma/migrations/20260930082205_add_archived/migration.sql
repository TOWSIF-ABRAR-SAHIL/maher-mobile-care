-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Service" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "technician" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "totalBill" INTEGER NOT NULL DEFAULT 0,
    "advance" INTEGER NOT NULL DEFAULT 0,
    "due" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "shopExpense" TEXT,
    "expenseAmount" INTEGER NOT NULL DEFAULT 0,
    "serviceDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Service" ("advance", "createdAt", "customerName", "due", "expenseAmount", "id", "model", "phone", "problem", "serviceDate", "shopExpense", "status", "technician", "totalBill", "updatedAt") SELECT "advance", "createdAt", "customerName", "due", "expenseAmount", "id", "model", "phone", "problem", "serviceDate", "shopExpense", "status", "technician", "totalBill", "updatedAt" FROM "Service";
DROP TABLE "Service";
ALTER TABLE "new_Service" RENAME TO "Service";
CREATE INDEX "Service_serviceDate_idx" ON "Service"("serviceDate");
CREATE INDEX "Service_technician_idx" ON "Service"("technician");
CREATE INDEX "Service_status_idx" ON "Service"("status");
CREATE INDEX "Service_archived_idx" ON "Service"("archived");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
