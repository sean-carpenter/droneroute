import { SITE_DRAWING_LIMITS } from "@droneroute/shared";
import { useMissionStore } from "@/store/missionStore";
import { initialWidthM } from "@/lib/drawings";
import { visibleArea } from "@/lib/mainMap";

/** A file that cannot become a drawing; the message is shown to the user. */
export class DrawingFileError extends Error {}

const MAX_PDF_BYTES = 50 * 1024 * 1024;
/** Longest side tried first, then smaller until the image fits the limit. */
const RENDER_SIZES = [SITE_DRAWING_LIMITS.maxImagePx, 3072, 2048, 1536];
/** Pixels at least this light in every channel count as paper. */
const PAPER = 235;

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export interface RenderedDrawing {
  image: string;
  widthPx: number;
  heightPx: number;
}

/** Make the white paper see-through so the map shows between the lines. */
function clearPaper(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] >= PAPER && px[i + 1] >= PAPER && px[i + 2] >= PAPER) {
      px[i + 3] = 0;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Render a one-page PDF to a PNG data URL in the browser. pdf.js is loaded on
 * first use, so it costs nothing until someone adds a drawing.
 */
export async function renderPdfDrawing(file: File): Promise<RenderedDrawing> {
  if (file.size > MAX_PDF_BYTES) {
    throw new DrawingFileError(`${file.name} is larger than 50 MB`);
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const data = new Uint8Array(await file.arrayBuffer());
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    doc = await pdfjs.getDocument({ data }).promise;
  } catch {
    throw new DrawingFileError(`${file.name} could not be opened as a PDF`);
  }
  try {
    if (doc.numPages !== 1) {
      throw new DrawingFileError(
        `Only one-page PDFs for now: ${file.name} has ${doc.numPages} pages`,
      );
    }
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    for (const longest of RENDER_SIZES) {
      const viewport = page.getViewport({
        scale: longest / Math.max(base.width, base.height),
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new DrawingFileError("This browser cannot draw the PDF");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      clearPaper(ctx, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/png");
      canvas.width = canvas.height = 0; // release the pixels right away
      if (image.length <= SITE_DRAWING_LIMITS.maxImageChars) {
        return {
          image,
          widthPx: Math.max(1, Math.floor(viewport.width)),
          heightPx: Math.max(1, Math.floor(viewport.height)),
        };
      }
    }
    throw new DrawingFileError(`${file.name} is too detailed to store`);
  } finally {
    void doc.destroy();
  }
}

/**
 * Render a dropped or picked PDF and lay it over the middle of the visible
 * map, selected so it can be moved, resized and rotated straight away.
 */
export async function addDrawingFromFile(file: File): Promise<void> {
  if (!isPdfFile(file)) {
    throw new DrawingFileError("Drawings must be PDF files");
  }
  const store = useMissionStore.getState();
  if (store.drawings.length >= SITE_DRAWING_LIMITS.maxDrawings) {
    throw new DrawingFileError(
      `A mission holds at most ${SITE_DRAWING_LIMITS.maxDrawings} drawings`,
    );
  }
  const view = visibleArea();
  if (!view) throw new DrawingFileError("The map is not ready yet");

  const rendered = await renderPdfDrawing(file);
  useMissionStore.getState().addDrawing({
    name: file.name.replace(/\.pdf$/i, "").slice(0, 200) || "Drawing",
    ...rendered,
    center: view.center,
    widthM: initialWidthM(view, rendered.widthPx, rendered.heightPx),
    rotationDeg: 0,
    opacity: 0.7,
    visible: true,
  });
}
