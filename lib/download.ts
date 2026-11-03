/** Small browser-only helper shared by the report exports and the backup
 *  download. Kept separate from `lib/export.ts` so downloading a PDF or a
 *  backup never pulls the SheetJS workbook writer into the chunk. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
