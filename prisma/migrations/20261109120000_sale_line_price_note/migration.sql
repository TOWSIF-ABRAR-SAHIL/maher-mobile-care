-- A price override on a sale line must say why. Additive and nullable: every
-- existing line keeps its data and reads back as "no override note".
ALTER TABLE "SaleItem" ADD COLUMN "priceNote" TEXT;
