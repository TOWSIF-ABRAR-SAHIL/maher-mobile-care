import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { categoryDTOs } from "@/lib/inventory-data";
import {
  categoryNameKey,
  isInventoryValidationError,
  isUniqueConstraintError,
  validateCategoryName,
} from "@/lib/inventory";
import type { ProductCategoryDTO } from "@/lib/types";

// Inventory counts must never be served from Next's route cache.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ categories: await categoryDTOs() });
  } catch (err) {
    console.error("GET /api/product-categories failed:", err);
    return NextResponse.json(
      { error: "ক্যাটাগরি লোড করা যায়নি" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, nameKey } = validateCategoryName(
      (body as { name?: unknown })?.name
    );

    const existing = await prisma.productCategory.findUnique({
      where: { nameKey },
    });
    if (existing) {
      return NextResponse.json(
        { error: `"${existing.name}" ক্যাটাগরি আগেই আছে` },
        { status: 409 }
      );
    }

    const created = await prisma.productCategory.create({
      data: { name, nameKey: categoryNameKey(name) },
    });
    return NextResponse.json(
      {
        category: {
          id: created.id,
          name: created.name,
          activeProductCount: 0,
          productCount: 0,
          createdAt: created.createdAt.toISOString(),
        } satisfies ProductCategoryDTO,
      },
      { status: 201 }
    );
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return NextResponse.json(
        { error: "এই নামের ক্যাটাগরি আগেই আছে" },
        { status: 409 }
      );
    }
    if (isInventoryValidationError(err)) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }
    console.error("POST /api/product-categories failed:", err);
    return NextResponse.json(
      { error: "ক্যাটাগরি যোগ করা যায়নি" },
      { status: 500 }
    );
  }
}
