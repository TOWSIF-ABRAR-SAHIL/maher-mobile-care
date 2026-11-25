import { NextRequest, NextResponse } from "next/server";
import {
  partsCostByService,
  PartConflictError,
  resolveServicePartInTx,
} from "@/lib/parts-data";
import { partsCostOf } from "@/lib/parts";
import { prisma } from "@/lib/prisma";
import { hasRepairCost } from "@/lib/refund-cost-choice";
import { optionalNote } from "@/lib/service-validation";
import { computeDue, parseBnNumber, RETURNED_STATUS } from "@/lib/utils";
import {
  cancelProductEntry,
  returnEntryProducts,
  withStockTransaction,
} from "@/lib/stock";
import { InventoryConflictError } from "@/lib/inventory";

export const dynamic = "force-dynamic";

const BULK_RESOLUTIONS = [
  "RETURNED",
  "MOVED_TO_STOCK",
  "DAMAGED",
  "KEPT_IN_LEDGER",
] as const;

/** Parse an optional integer money field; blank means "not supplied". */
function optionalAmount(
  value: unknown,
  label: string
): number | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseBnNumber(value);
  if (parsed === null) return "invalid";
  void label;
  return parsed;
}

/**
 * POST /api/services/[id]/refund
 *
 * Closes a job as Returned. Three extra choices are accepted on top of the
 * original full-refund flow:
 *
 * - `inspectionFee` keeps a diagnostic charge: cash back = advance − fee and
 *   the retained amount becomes the row's final bill/advance (due 0).
 * - `refundAmount` allows a full or custom cash refund on e.g. a warranty
 *   reversal; without a fee the original bill/advance stay for audit.
 * - `advanceAction: "transfer"` with `transferToId` moves the device's advance
 *   to an active sibling in the same visit (no cash leaves the drawer).
 *
 * `partResolution` resolves every attached ServicePart in the SAME transaction
 * as the return, so a half-finished stock write can never half-close a job.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const existing = await prisma.service.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    if (existing.archived) {
      return NextResponse.json(
        { error: "আর্কাইভ করা কাজ ফেরত দেওয়া যাবে না" },
        { status: 400 }
      );
    }
    if (existing.status === RETURNED_STATUS) {
      return NextResponse.json(
        { error: "এই কাজ আগেই ফেরত দেওয়া হয়েছে" },
        { status: 400 }
      );
    }

    // Parts-only jobs keep `expenseAmount === 0`; their repair cost lives in
    // ServicePart. Both sources must trigger the writeoff/keep decision.
    const partsCostLookup = await partsCostByService([id]);
    const partsCost = partsCostOf(partsCostLookup, id);

    const body = await req.json().catch(() => ({}));
    let note: string | null = null;
    let returnReason: string | null = null;
    try {
      note = optionalNote(body?.note, "ফেরত নোট");
      returnReason = optionalNote(body?.returnReason, "ফেরতের কারণ");
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "ফেরত নোট সঠিক নয়" },
        { status: 400 }
      );
    }

    const advance = Math.max(0, Math.round(existing.advance));
    const parsedFee = optionalAmount(body?.inspectionFee, "চেকিং ফি");
    if (parsedFee === "invalid") {
      return NextResponse.json(
        { error: "চেকিং ফি সঠিক টাকা দিন" },
        { status: 400 }
      );
    }
    const fee = parsedFee ?? 0;
    if (fee > advance) {
      return NextResponse.json(
        { error: "চেকিং ফি জমার চেয়ে বেশি হতে পারবে না" },
        { status: 400 }
      );
    }

    const action = body?.advanceAction;
    if (
      action !== undefined &&
      action !== null &&
      action !== "" &&
      action !== "cash" &&
      action !== "transfer"
    ) {
      return NextResponse.json(
        { error: "জমার সিদ্ধান্ত সঠিক নয়" },
        { status: 400 }
      );
    }
    const isTransfer = action === "transfer";
    if (isTransfer && fee > 0) {
      return NextResponse.json(
        { error: "ট্রান্সফারের সাথে চেকিং ফি নেওয়া যাবে না" },
        { status: 400 }
      );
    }

    let transferToId: number | null = null;
    let sibling: null | Awaited<ReturnType<typeof prisma.service.findUnique>> = null;
    if (isTransfer) {
      transferToId = Number(body?.transferToId);
      if (!Number.isInteger(transferToId) || transferToId <= 0 || transferToId === id) {
        return NextResponse.json(
          { error: "গ্রুপের অন্য ডিভাইস বেছে নিন" },
          { status: 400 }
        );
      }
      if (!existing.groupId) {
        return NextResponse.json(
          { error: "এই কাজটি কোনো গ্রুপ ভিজিটের অংশ নয়" },
          { status: 400 }
        );
      }
      sibling = await prisma.service.findUnique({ where: { id: transferToId } });
      if (
        !sibling ||
        sibling.archived ||
        sibling.status === RETURNED_STATUS ||
        sibling.groupId !== existing.groupId ||
        sibling.entryKind === "PRODUCT"
      ) {
        return NextResponse.json(
          { error: "একই গ্রুপের চলতি ডিভাইসে জমা স্থানান্তর করা যাবে" },
          { status: 400 }
        );
      }
    }

    const parsedRefund = optionalAmount(body?.refundAmount, "ফেরতের টাকা");
    if (parsedRefund === "invalid") {
      return NextResponse.json(
        { error: "ফেরতের টাকা সঠিক দিন" },
        { status: 400 }
      );
    }
    // A transfer is a book-keeping move, never cash out of the drawer.
    const refund = isTransfer ? 0 : (parsedRefund ?? Math.max(0, advance - fee));
    if (refund > advance) {
      return NextResponse.json(
        { error: "জমার চেয়ে বেশি টাকা ফেরত দেওয়া যাবে না" },
        { status: 400 }
      );
    }
    if (refund + fee > advance) {
      return NextResponse.json(
        { error: "ফি ও ফেরতের টাকা একসাথে জমার চেয়ে বেশি" },
        { status: 400 }
      );
    }
    // A retained inspection fee and a custom cash refund are two ways of
    // splitting the SAME advance. Accepting an arbitrary pair would store a
    // made-up final bill while stats recognise only the fee as income, so cash
    // silently disappears from the ledger. When a fee is present the cash
    // refund is fully determined: advance − fee.
    if (
      fee > 0 &&
      parsedRefund !== null &&
      !isTransfer &&
      refund !== advance - fee
    ) {
      return NextResponse.json(
        { error: "চেকিং ফি দেওয়ার সময় ফেরতের টাকা ফি বাদে জমার সমান হতে হবে" },
        { status: 400 }
      );
    }
    const retained = advance - refund;

    const rawResolution = String(body?.partResolution ?? "").trim().toUpperCase();
    const partResolution = BULK_RESOLUTIONS.includes(
      rawResolution as (typeof BULK_RESOLUTIONS)[number]
    )
      ? (rawResolution as (typeof BULK_RESOLUTIONS)[number])
      : null;
    if (rawResolution && !partResolution) {
      return NextResponse.json(
        { error: "পার্টস নিষ্পত্তি সঠিক নয়" },
        { status: 400 }
      );
    }

    // A returned job cannot be billed, but its repair cost may already have
    // left the shop (lump code or itemized parts). The UI must ask which one
    // happened; older callers that omit the field keep the cost as a loss.
    let expenseWrittenOff = existing.expenseWrittenOff;
    // A bulk part choice already says what happened to the repair cost:
    // supplier return / stock move / keeping the external part in its ledger
    // costs the shop nothing here (its supplier balance stays in /parts),
    // damage is carried by damageLoss. No second question is needed.
    if (partResolution) {
      expenseWrittenOff = partResolution !== "DAMAGED";
    } else if (
      hasRepairCost({
        expenseAmount: existing.expenseAmount,
        partsCost,
      })
    ) {
      const costAction = body?.expenseAction;
      if (costAction === "writeoff") {
        expenseWrittenOff = true;
      } else if (costAction === "keep") {
        expenseWrittenOff = false;
      } else if (costAction !== undefined && costAction !== null && costAction !== "") {
        return NextResponse.json(
          { error: "দোকান খরচের সিদ্ধান্ত সঠিক নয়" },
          { status: 400 }
        );
      }
    }

    // A product-only entry is cancelled as a whole (stock back, advance back);
    // the refund dialog normally calls /cancel for it, but the same choice is
    // accepted here so both buttons behave identically.
    if (existing.entryKind === "PRODUCT") {
      const result = await withStockTransaction((tx) =>
        cancelProductEntry(tx, id, body?.damaged === true)
      );
      const updated = await prisma.service.findUnique({ where: { id } });
      return NextResponse.json({ ...updated, cancel: result });
    }

    // "প্রোডাক্ট ফেরত নেবেন?" — only an explicit true returns the visit's
    // product lines. Omitting it leaves the products sold (the safe default).
    const returnProducts = body?.returnProducts === true;
    const finalRefundNote =
      note ??
      (isTransfer && sibling
        ? `জমা ডিভাইস #${sibling.id}-এ স্থানান্তরিত`
        : null);

    const { updated, productReturn, resolvedParts, transfer } =
      await withStockTransaction(async (tx) => {
        const returned =
          returnProducts && existing.groupId
            ? await returnEntryProducts(tx, existing.groupId)
            : { lines: 0, refund: 0 };

        const resolved: Awaited<ReturnType<typeof resolveServicePartInTx>>[] = [];
        if (partResolution) {
          const parts = await tx.servicePart.findMany({
            where: { serviceId: id },
            orderBy: { id: "asc" },
          });
          for (const part of parts) {
            const done = await resolveServicePartInTx(tx, part.id, {
              partStatus: partResolution,
              resolutionNote:
                returnReason ?? note ?? "সার্ভিস ফেরতের সাথে নিষ্পত্তি",
              ...(partResolution === "MOVED_TO_STOCK"
                ? { categoryName: "সার্ভিস পার্টস" }
                : {}),
            });
            if (done) resolved.push(done);
          }
        }

        let moved: { id: number; advance: number; due: number } | null = null;
        if (isTransfer && sibling && transferToId) {
          const newAdvance = Math.max(0, sibling.advance) + retained;
          const movedRow = await tx.service.update({
            where: { id: transferToId },
            data: {
              advance: newAdvance,
              due: computeDue(sibling.totalBill, newAdvance),
            },
          });
          moved = { id: movedRow.id, advance: movedRow.advance, due: movedRow.due };
        }

        // Only a fee return promotes the retained amount to the final bill;
        // a plain/custom refund keeps the original figures for audit.
        const feeMoney = fee > 0 ? { totalBill: retained, advance: retained } : {};
        // Claim the row with a status predicate inside the transaction. Two
        // concurrent refunds can both pass the early check above; only one may
        // write the ledger, so the loser rolls its stock/part writes back.
        const claimed = await tx.service.updateMany({
          where: { id, status: { not: RETURNED_STATUS } },
          data: {
            status: RETURNED_STATUS,
            returnedAt: new Date(),
            refundAmount: refund,
            refundNote: finalRefundNote,
            returnReason,
            inspectionFee: fee,
            expenseWrittenOff,
            // A returned job is no longer delivered; keep the status/date pair
            // consistent with the edit endpoint (which clears it on reopen).
            deliveredAt: null,
            due: 0,
            ...feeMoney,
          },
        });
        if (claimed.count === 0) {
          throw new Error("এই কাজ আগেই ফেরত দেওয়া হয়েছে");
        }
        const row = await tx.service.findUnique({ where: { id } });
        if (!row) throw new Error("কাজ পাওয়া যায়নি");
        return { updated: row, productReturn: returned, resolvedParts: resolved, transfer: moved };
      });
    return NextResponse.json({ ...updated, productReturn, resolvedParts, transfer });
  } catch (err) {
    if (err instanceof InventoryConflictError || err instanceof PartConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof Error && /ফি|ফেরত|জমা|পার্টস|নোট/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(`POST /api/services/${params.id}/refund failed:`, err);
    return NextResponse.json(
      { error: "ফেরত দেওয়া যায়নি" },
      { status: 500 }
    );
  }
}
