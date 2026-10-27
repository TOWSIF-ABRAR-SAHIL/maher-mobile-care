/**
 * Report PDF capture — unlike `createReceiptPdf` (one receipt page) this
 * slices the captured canvas across A4 pages, so a long range report stays
 * at readable size instead of shrinking onto a single sheet.
 *
 * Bengali is safe: html2canvas rasterises the already-rendered DOM, and the
 * document awaits `document.fonts.ready` before capturing.
 */
export async function createReportPdf(element: HTMLElement): Promise<Blob> {
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
    windowWidth: Math.max(element.scrollWidth, 720),
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
  const usableW = pageWidth - margin * 2;
  const usableH = pageHeight - margin * 2;
  const pxPerMm = canvas.width / usableW;
  const pagePx = Math.floor(usableH * pxPerMm);

  let offset = 0;
  let page = 0;
  while (offset < canvas.height) {
    const sliceH = Math.min(pagePx, canvas.height - offset);
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = sliceH;
    const ctx = slice.getContext("2d");
    if (!ctx) throw new Error("রিপোর্ট ক্যানভাস তৈরি করা যায়নি");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, offset, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
    if (page > 0) pdf.addPage();
    pdf.addImage(
      slice.toDataURL("image/png"),
      "PNG",
      margin,
      margin,
      usableW,
      sliceH / pxPerMm,
      undefined,
      "FAST"
    );
    offset += sliceH;
    page += 1;
  }

  return pdf.output("blob");
}
