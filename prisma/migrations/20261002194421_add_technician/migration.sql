-- CreateTable
CREATE TABLE "Technician" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Technician_name_key" ON "Technician"("name");

-- CreateIndex
CREATE INDEX "Technician_isActive_idx" ON "Technician"("isActive");

-- Seed the technicians that were hardcoded in lib/utils.ts before v1.1, so
-- every existing install keeps working and `prisma migrate deploy` (which
-- scripts/run-tests.js runs for each throwaway test database) produces a
-- ready-to-use technician list with no extra setup step.
INSERT INTO "Technician" ("name", "isActive", "createdAt") VALUES
    ('NURUL', true, CURRENT_TIMESTAMP),
    ('RONI', true, CURRENT_TIMESTAMP),
    ('ASRAFUL', true, CURRENT_TIMESTAMP),
    ('NAYEM', true, CURRENT_TIMESTAMP);
