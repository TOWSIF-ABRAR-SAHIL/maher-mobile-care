import { NextRequest, NextResponse } from "next/server";
import {
  BACKUP_MODELS,
  cleanupRestoreTemp,
  inspectBackupFile,
  materializeUpload,
  allocateRestoreTempFile,
} from "@/lib/backup-restore-file";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Read-only metadata preview for the restore modal. The file is written to a
 * disposable `temp-restore-*` path, quick-checked and deleted in the same
 * request — nothing here touches the live database or its pointer file.
 */
export async function POST(req: NextRequest) {
  let temp: string | null = null;
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "ভুল ব্যাকআপ ফাইল" }, { status: 400 });
    }
    const form = await req.formData().catch(() => null);
    const candidate = form?.get("file");
    if (
      !candidate ||
      typeof candidate === "string" ||
      typeof candidate.arrayBuffer !== "function"
    ) {
      return NextResponse.json({ error: "ভুল ব্যাকআপ ফাইল" }, { status: 400 });
    }
    const name = candidate.name || "upload.db";
    const bytes = Buffer.from(await candidate.arrayBuffer());
    temp = allocateRestoreTempFile();
    if (!materializeUpload(bytes, name, temp)) {
      return NextResponse.json({ error: "ভুল ব্যাকআপ ফাইল" }, { status: 400 });
    }
    const result = inspectBackupFile(temp);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "ব্যাকআপ ফাইল পড়া যায়নি" },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      fileName: name,
      sizeBytes: bytes.length,
      sizeKB: Math.max(1, Math.round(bytes.length / 1024)),
      records: result.servicesCount,
      servicesCount: result.servicesCount,
      productsCount: result.productsCount,
      tables: result.tables,
      essential: result.essential,
      missingEssential: result.missingEssential,
      counts: result.counts,
      models: BACKUP_MODELS.map((m) => m.name),
    });
  } catch (err) {
    console.error("POST /api/backup/inspect failed:", err);
    return NextResponse.json(
      { error: "ব্যাকআপ ফাইল পড়া যায়নি" },
      { status: 500 }
    );
  } finally {
    if (temp) cleanupRestoreTemp(temp);
  }
}
