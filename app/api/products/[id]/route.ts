import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PRODUCT_INCLUDE, toProductDTO } from "@/lib/inventory-data";
import {
  isInventoryValidationError,
  isUniqueConstraintError,
  validateProductUpdate,
} from "@/lib/inventory";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: "ভুল প্রোডাক্ট" }, { status: 400 });
    }
    const product = await prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!product) {
      return NextResponse.json(
        { error: "প্রোডাক্ট পাওয়া যায়নি" },
        { status: 404 }
      );
    }
    return NextResponse.json({ product: toProductDTO(product) });
  } catch (err) {
    console.error("GET /api/products/[id] failed:", err);
    return NextResponse.json(
      { error: "প্রোডাক্ট লোড করা যায়নি" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: "ভুল প্রোডাক্ট" }, { status: 400 });
    }
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing || existing.archived) {
      return NextResponse.json(
        { error: "প্রোডাক্ট পাওয়া যায়নি" },
        { status: 404 }
      );
    }

    const body = await req.json();
    // No `stock` here on purpose: editing a product must never rewrite the
    // stock ledger. Only stock operations/sales touch it.
    const data = validateProductUpdate(body);

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
      const clash = await prisma.product.findFirst({
        where: { sku: data.sku, id: { not: id } },
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
      const clash = await prisma.product.findFirst({
        where: { barcode: data.barcode, id: { not: id } },
        select: { name: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: `বারকোড "${data.barcode}" আগেই ব্যবহার হয়েছে (${clash.name})` },
          { status: 409 }
        );
      }
    }

    const updated = await prisma.product.update({
      where: { id },
      data,
      include: PRODUCT_INCLUDE,
    });
    return NextResponse.json({ product: toProductDTO(updated) });
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
    console.error("PUT /api/products/[id] failed:", err);
    return NextResponse.json(
      { error: "প্রোডাক্ট বদলানো যায়নি" },
      { status: 500 }
    );
  }
}

/**
 * Soft-delete. History (sale lines, movements) must keep pointing at the
 * product, so the row is archived instead of removed.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: "ভুল প্রোডাক্ট" }, { status: 400 });
    }
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "প্রোডাক্ট পাওয়া যায়নি" },
        { status: 404 }
      );
    }
    if (existing.archived) {
      return NextResponse.json({ ok: true, archived: true });
    }

    await prisma.product.update({
      where: { id },
      data: { archived: true },
    });
    return NextResponse.json({ ok: true, archived: true });
  } catch (err) {
    console.error("DELETE /api/products/[id] failed:", err);
    return NextResponse.json(
      { error: "প্রোডাক্ট আর্কাইভ করা যায়নি" },
      { status: 500 }
    );
  }
}
