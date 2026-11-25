/**
 * Report PDF capture — the report sheet is laid out as fixed A4 pages already
 * (see ReportDocument), so each `[data-report-page]` becomes exactly one PDF
 * page. No canvas slicing through a table row, and every page keeps its own
 * heading and footer.
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

  const pages = Array.from(element.querySelectorAll<HTMLElement>("[data-report-page]"));
  if (!pages.length) throw new Error("রিপোর্ট তৈরি করা যায়নি");

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

  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: Math.max(pages[i].scrollWidth, 720),
      windowHeight: Math.max(pages[i].scrollHeight, 1050),
    });
    if (i > 0) pdf.addPage();
    const imgH = (canvas.height / canvas.width) * usableW;
    pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      margin,
      margin + Math.max(0, (usableH - imgH) / 2),
      usableW,
      imgH,
      undefined,
      "FAST"
    );
  }

  return pdf.output("blob");
}
