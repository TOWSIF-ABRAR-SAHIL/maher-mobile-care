-- Clean-slate first launch.
--
-- 20261002194421_add_technician seeded four demo names so old installs kept
-- their hardcoded roster. That INSERT stays untouched to preserve the applied
-- migration checksum. This additive migration clears those defaults only while
-- the database is still untouched: no ledger, inventory, payment or purchase
-- rows and no technician beyond the four seeded names. A live shop with data
-- keeps its roster exactly as it is.
DELETE FROM "Technician"
WHERE "name" IN ('NURUL', 'RONI', 'ASRAFUL', 'NAYEM')
  AND (SELECT COUNT(*) FROM "Technician") = 4
  AND NOT EXISTS (SELECT 1 FROM "Service")
  AND NOT EXISTS (SELECT 1 FROM "Payment")
  AND NOT EXISTS (SELECT 1 FROM "Purchase")
  AND NOT EXISTS (SELECT 1 FROM "Product")
  AND NOT EXISTS (SELECT 1 FROM "ProductCategory")
  AND NOT EXISTS (SELECT 1 FROM "ServicePart")
  AND NOT EXISTS (SELECT 1 FROM "SaleItem")
  AND NOT EXISTS (SELECT 1 FROM "StockMovement");
