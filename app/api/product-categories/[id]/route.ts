import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  isInventoryValidationError,
  isUniqueConstraintError,
  validateCategoryName,
} from "@/lib/inventory";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: "ভুল ক্যাটাগরি" }, { status: 400 });
    }
    const existing = await prisma.productCategory.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "ক্যাটাগরি পাওয়া যায়নি" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const { name, nameKey } = validateCategoryName(
      (body as { name?: unknown })?.name
    );

    const clash = await prisma.productCategory.findUnique({
      where: { nameKey },
    });
    if (clash && clash.id !== id) {
      return NextResponse.json(
        { error: `"${clash.name}" ক্যাটাগরি আগেই আছে` },
        { status: 409 }
      );
    }

    const updated = await prisma.productCategory.update({
      where: { id },
      data: { name, nameKey },
    });
    return NextResponse.json({
      category: {
        id: updated.id,
        name: updated.name,
        createdAt: updated.createdAt.toISOString(),
      },
    });
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
    console.error("PUT /api/product-categories/[id] failed:", err);
    return NextResponse.json(
      { error: "ক্যাটাগরি বদলানো যায়নি" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: "ভুল ক্যাটাগরি" }, { status: 400 });
    }
    const existing = await prisma.productCategory.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "ক্যাটাগরি পাওয়া যায়নি" },
        { status: 404 }
      );
    }

    // Archived products count too: deleting the category would orphan their
    // history. The user must move or archive-to-trash differently — never a
    // silent cascade.
    const productCount = await prisma.product.count({
      where: { categoryId: id },
    });
    if (productCount > 0) {
      return NextResponse.json(
        {
          error: `এই ক্যাটাগরিতে ${productCount}টি প্রোডাক্ট আছে — আগে প্রোডাক্টগুলোর ক্যাটাগরি বদলান`,
        },
        { status: 409 }
      );
    }

    await prisma.productCategory.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/product-categories/[id] failed:", err);
    return NextResponse.json(
      { error: "ক্যাটাগরি মোছা যায়নি" },
      { status: 500 }
    );
  }
}
