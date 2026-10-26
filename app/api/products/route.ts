import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  categoryDTOs,
  PRODUCT_INCLUDE,
  toProductDTO,
} from "@/lib/inventory-data";
import {
  isInventoryValidationError,
  isUniqueConstraintError,
  validateProductCreate,
} from "@/lib/inventory";
import type { ProductListResponse, StockStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

type SortKey = "name" | "recent" | "stock" | "selling";

function readSort(raw: string | null): SortKey {
  return raw === "recent" || raw === "stock" || raw === "selling"
    ? raw
    : "name";
}

function readStatus(raw: string | null): StockStatus | null {
  return raw === "in" || raw === "low" || raw === "out" ? raw : null;
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const q = (params.get("q") ?? "").trim();
    const status = readStatus(params.get("status"));
    const sort = readSort(params.get("sort"));
    const categoryRaw = params.get("categoryId");
    const categoryId =
      categoryRaw && /^\d+$/.test(categoryRaw) ? Number(categoryRaw) : null;

    const where: Prisma.ProductWhereInput = { archived: false };
    if (categoryId) where.categoryId = categoryId;
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { sku: { contains: q } },
        { barcode: { contains: q } },
        { brand: { contains: q } },
        { category: { name: { contains: q } } },
      ];
    }

    // Per-row status needs a two-column comparison, which SQLite/Prisma
    // cannot express in WHERE. Fetch the (already narrowed) rows, compute the
    // status in JS, then apply the status filter/sort.
    const rows = await prisma.product.findMany({
      where,
      include: PRODUCT_INCLUDE,
    });

    let products = rows.map(toProductDTO);
    if (status) products = products.filter((p) => p.status === status);

    products.sort((a, b) => {
      switch (sort) {
        case "recent":
          return b.id - a.id;
        case "stock":
          return b.stock - a.stock || a.name.localeCompare(b.name, "bn");
        case "selling":
          return b.sellingPrice - a.sellingPrice || a.name.localeCompare(b.name, "bn");
        default:
          return a.name.localeCompare(b.name, "bn");
      }
    });

    // Cards describe the whole non-archived inventory, not the filtered view:
    // filtering to "out of stock" must not make total products look zero.
    const all = await prisma.product.findMany({
      where: { archived: false },
      select: { stock: true, lowStockThreshold: true, purchasePrice: true },
    });
    const summary = {
      totalProducts: all.length,
      categories: (await prisma.productCategory.count()),
      units: 0,
      lowStock: 0,
      outOfStock: 0,
      inventoryValue: 0,
    };
    for (const product of all) {
      const stock = Math.max(0, product.stock);
      summary.units += stock;
      summary.inventoryValue += stock * Math.max(0, product.purchasePrice);
      if (stock === 0) summary.outOfStock += 1;
      else if (stock <= Math.max(0, product.lowStockThreshold)) {
        summary.lowStock += 1;
      }
    }

    const body: ProductListResponse = {
      products,
      summary,
      categories: await categoryDTOs(),
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("GET /api/products failed:", err);
    return NextResponse.json(
      { error: "প্রোডাক্ট লোড করা যায়নি" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = validateProductCreate(body);

    const category = await prisma.productCategory.findUnique({
      where: { id: data.categoryId },
      select: { id: true },
    });
    if (!category) {
      return NextResponse.json(
        { error: "সঠিক ক্যাটাগরি বাছুন" },
        { status: 400 }
      );
    }

    if (data.sku) {
      const clash = await prisma.product.findUnique({
        where: { sku: data.sku },
        select: { name: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: `SKU "${data.sku}" আগেই ব্যবহার হয়েছে (${clash.name})` },
          { status: 409 }
        );
      }
    }
    if (data.barcode) {
      const clash = await prisma.product.findUnique({
        where: { barcode: data.barcode },
        select: { name: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: `বারকোড "${data.barcode}" আগেই ব্যবহার হয়েছে (${clash.name})` },
          { status: 409 }
        );
      }
    }

    const { openingStock, ...fields } = data;
    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: { ...fields, stock: openingStock },
        include: PRODUCT_INCLUDE,
      });
      // The opening quantity is a real ledger event, not a hidden default.
      if (openingStock > 0) {
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            movementType: "OPENING",
            quantity: openingStock,
            previousStock: 0,
            newStock: openingStock,
            reason: "ওপেনিং স্টক",
          },
        });
      }
      return product;
    });

    return NextResponse.json({ product: toProductDTO(created) }, { status: 201 });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return NextResponse.json(
        { error: "SKU বা বারকোড আগেই ব্যবহার হয়েছে" },
        { status: 409 }
      );
    }
    if (isInventoryValidationError(err)) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }
    console.error("POST /api/products failed:", err);
    return NextResponse.json(
      { error: "প্রোডাক্ট যোগ করা যায়নি" },
      { status: 500 }
    );
  }
}
