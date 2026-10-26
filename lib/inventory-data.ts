import { prisma } from "./prisma";
import { stockStatus } from "./inventory";
import type { ProductCategoryDTO, ProductDTO } from "./types";

/** Shape used by /api/products and /api/products/[id]. */
export interface ProductRow {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  categoryId: number;
  category: { name: string };
  brand: string | null;
  description: string | null;
  supplier: string | null;
  sellingPrice: number;
  purchasePrice: number;
  stock: number;
  lowStockThreshold: number;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toProductDTO(row: ProductRow): ProductDTO {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    brand: row.brand,
    description: row.description,
    supplier: row.supplier,
    sellingPrice: row.sellingPrice,
    purchasePrice: row.purchasePrice,
    stock: row.stock,
    lowStockThreshold: row.lowStockThreshold,
    status: stockStatus(row.stock, row.lowStockThreshold),
    archived: row.archived,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const PRODUCT_INCLUDE = { category: { select: { name: true } } } as const;

/**
 * Category list with both counts. `activeProductCount` is what the shop sees;
 * `productCount` (including archived rows) is what blocks deletion so history
 * never loses its category.
 */
export async function categoryDTOs(): Promise<ProductCategoryDTO[]> {
  const [categories, products] = await Promise.all([
    prisma.productCategory.findMany({ orderBy: { name: "asc" } }),
    prisma.product.findMany({ select: { categoryId: true, archived: true } }),
  ]);

  const active = new Map<number, number>();
  const total = new Map<number, number>();
  for (const product of products) {
    total.set(product.categoryId, (total.get(product.categoryId) ?? 0) + 1);
    if (!product.archived) {
      active.set(product.categoryId, (active.get(product.categoryId) ?? 0) + 1);
    }
  }

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    activeProductCount: active.get(category.id) ?? 0,
    productCount: total.get(category.id) ?? 0,
    createdAt: category.createdAt.toISOString(),
  }));
}
