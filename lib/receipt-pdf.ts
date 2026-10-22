import { whatsAppHref } from "@/lib/contact";
import { dhakaDateKey } from "@/lib/dhaka";
import type { ServiceDTO } from "@/lib/types";

/** File name used both for the shared PDF and the download fallback. */
export function receiptPdfFileName(service: ServiceDTO): string {
  const date = service.serviceDate
    ? dhakaDateKey(service.serviceDate)
    : "unknown-date";
  return `MAHER-Bill-${service.id}-${date}.pdf`;
}

/** Capture an already-rendered receipt node and turn it into a local PDF.
 *  Both libraries are loaded lazily so the dashboard's first paint stays
 *  exactly as light as before. */
export async function createReceiptPdf(element: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
    scrollX: 0,
    scrollY: 0,
    windowWidth: Math.max(element.scrollWidth, 640),
  });

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  const margin = 10;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2;
  const ratio = Math.min(
    maxWidth / canvas.width,
    maxHeight / canvas.height
  );
  const width = canvas.width * ratio;
  const height = canvas.height * ratio;

  pdf.addImage(
    canvas.toDataURL("image/png"),
    "PNG",
    margin + (maxWidth - width) / 2,
    margin,
    width,
    height,
    undefined,
    "FAST"
  );

  return pdf.output("blob");
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The browser needs a moment to start the download before the URL is freed.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export type PdfShareResult =
  | "shared"
  | "cancelled"
  | "downloaded"
  | "downloaded-no-chat";

type ShareNavigator = Navigator & {
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: {
    files?: File[];
    title?: string;
    text?: string;
  }) => Promise<void>;
};

/**
 * Share the generated file through the OS share sheet (WhatsApp is one of the
 * targets), or fall back to downloading it and opening the customer's specific
 * wa.me chat. A wa.me link itself can never attach a file — the user always
 * makes the final Send tap inside WhatsApp.
 */
export async function shareReceiptPdf(
  service: ServiceDTO,
  blob: Blob
): Promise<PdfShareResult> {
  const fileName = receiptPdfFileName(service);
  const file = new File([blob], fileName, { type: "application/pdf" });
  const nav = navigator as ShareNavigator;

  let canShareFile = false;
  try {
    canShareFile =
      typeof nav.share === "function" &&
      typeof nav.canShare === "function" &&
      nav.canShare({ files: [file] });
  } catch {
    canShareFile = false;
  }

  if (canShareFile) {
    try {
      await nav.share!({
        files: [file],
        title: `MAHER MOBILE CARE — বিল #${service.id}`,
        text: `বিল নং ${service.id} (${service.model}) — ${service.customerName}`,
      });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      // NotAllowedError can happen if the async PDF render outlived Chrome's
      // user-activation window. Download + open the chat instead of failing.
    }
  }

  downloadBlob(blob, fileName);

  // Do not pass "noopener" here: window.open returns null for a noopener
  // window even when it succeeds, which would look like a popup block.
  const chatWindow = window.open(whatsAppHref(service), "_blank");
  if (chatWindow) {
    chatWindow.opener = null;
    return "downloaded";
  }
  return "downloaded-no-chat";
}
