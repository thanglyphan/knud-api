import { PDFToImage } from "pdf-to-image-generator";
import type { ImagePageOutput } from "pdf-to-image-generator";

/**
 * Konverterer PDF til bilder (PNG) for bruk med GPT-4 Vision
 * @param base64Data - Base64-kodet PDF (med eller uten data URL prefix)
 * @returns Array av base64 data URLs for bildene (maks 2 sider)
 */
export async function convertPdfToImages(base64Data: string): Promise<string[]> {
  // Fjern data URL prefix hvis det finnes
  const pureBase64 = base64Data.replace(/^data:application\/pdf;base64,/, "");
  const buffer = Buffer.from(pureBase64, "base64");
  
  // Last inn PDF
  const pdfConverter = new PDFToImage();
  await pdfConverter.load(buffer);
  
  // Finn antall sider (maks 2)
  const totalPages = pdfConverter.document.numPages;
  const pagesToConvert = Math.min(totalPages, 2);
  
  // Konverter til bilder (PNG) - kun de første sidene
  const pages = Array.from({ length: pagesToConvert }, (_, i) => i + 1);
  const images: ImagePageOutput[] = await pdfConverter.convert({
    pages,
    viewportScale: 2.0, // God oppløsning for OCR/lesing
    type: "png",
  });
  
  // Returner som base64 data URLs
  return images
    .filter((img): img is ImagePageOutput & { content: Buffer } => img.content !== undefined)
    .map((img) => `data:image/png;base64,${img.content.toString("base64")}`);
}
