import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  isServiceValidationError,
  validateServiceCreate,
} from "@/lib/service-validation";
import { activeTechnicianNames } from "@/lib/technicians";

export const dynamic = "force-dynamic";

const MAX_DEVICES = 8;

/**
 * POST /api/services/batch
 *
 * One customer visit can bring several devices. Customer/phone/technician/
 * date are shared; each device keeps its own model, problem, bill, status and
 * expected delivery date, so totals, dues and technician stats still work per
 * device. All rows are created in one transaction with a shared `groupId` for
 * the combined receipt.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "ভুল ডেটা" }, { status: 400 });
    }
    const shared = body as Record<string, unknown>;
    const devices = shared.devices;
    if (!Array.isArray(devices) || devices.length === 0) {
      return NextResponse.json(
        { error: "অন্তত একটি ডিভাইস দিন" },
        { status: 400 }
      );
    }
    if (devices.length > MAX_DEVICES) {
      return NextResponse.json(
        { error: `একবারে সর্বোচ্চ ${MAX_DEVICES}টি ডিভাইস সেভ করা যাবে` },
        { status: 400 }
      );
    }

    const activeTechnicians = await activeTechnicianNames();
    const payloads = devices.map((device) => {
      const d =
        device && typeof device === "object" && !Array.isArray(device)
          ? (device as Record<string, unknown>)
          : {};
      // Customer/phone/technician/day are shared, but the expected handover
      // date belongs to the individual device. Fall back to the shared value
      // so older callers that only send one date keep working.
      const deviceDeliveryDate =
        typeof d.deliveryDate === "string" && d.deliveryDate.trim() !== ""
          ? d.deliveryDate
          : shared.deliveryDate;
      return validateServiceCreate(
        {
          // Shared fields come from the top level, never from a device row.
          customerName: shared.customerName,
          phone: shared.phone,
          technician: shared.technician,
          serviceDate: shared.serviceDate,
          deliveryDate: deviceDeliveryDate,
          model: d.model,
          problem: d.problem,
          totalBill: d.totalBill,
          advance: d.advance,
          status: d.status,
          shopExpense: d.shopExpense,
          partsShop: d.partsShop,
          // Optional and per device — a blank IMEI stays NULL for that row.
          imei: d.imei,
        },
        { allowedTechnicians: activeTechnicians }
      );
    });

    const groupId = `g-${randomUUID()}`;
    const now = new Date();
    const services = await prisma.$transaction(
      payloads.map((p) => {
        const { serviceDateKey: _serviceDateKey, ...data } = p;
        void _serviceDateKey;
        return prisma.service.create({
          data: {
            ...data,
            groupId,
            deliveredAt: data.status === "Delivered" ? now : null,
          },
        });
      })
    );

    return NextResponse.json({ groupId, services }, { status: 201 });
  } catch (err) {
    if (isServiceValidationError(err)) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "সঠিক তথ্য দিন" },
        { status: 400 }
      );
    }
    console.error("POST /api/services/batch failed:", err);
    return NextResponse.json(
      { error: "একসাথে সেভ করা যায়নি" },
      { status: 500 }
    );
  }
}
