// Builds the PDF on the phone
import { PDFDocument } from "pdf-lib";

export const MAX_OCR_PAGES = 40;
const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
const MARGINS = { none: 0, small: 20, big: 50 };

function layout(w, h, size, margin) {
  const m = MARGINS[margin] ?? 20;
  if (size === "fit") {
    const k = Math.min(1, 14000 / (Math.max(w, h) * 0.75));
    const iw = w * 0.75 * k, ih = h * 0.75 * k;
    return { pw: iw + 2 * m, ph: ih + 2 * m, x: m, y: m, iw, ih };
  }
  let [pw, ph] = SIZES[size] || SIZES.a4;
  if (w > h) [pw, ph] = [ph, pw];
  const s = Math.min((pw - 2 * m) / w, (ph - 2 * m) / h);
  const iw = w * s, ih = h * s;
  return { pw, ph, x: (pw - iw) / 2, y: (ph - ih) / 2, iw, ih };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/* ---------- rule 1: streamed PDF, no big array in memory ---------- */
// pages: [{ w, h, load: async () => Blob (JPEG) }]. Returns a Blob made of header text + the stored JPEG blobs.
export async function buildPdfStream(pages, { size, margin }, onStatus) {
  const parts = [];
  const offsets = [];
  let pos = 0;
  const add = (p) => { parts.push(p); pos += typeof p === "string" ? p.length : p.size; }; // text is plain ASCII
  const begin = (n) => { offsets[n] = pos; add(`${n} 0 obj\n`); };
  const f = (x) => x.toFixed(2);
  const n = pages.length;

  add("%PDF-1.4\n");
  begin(1); add("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  begin(2);
  add(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, k) => `${3 + 3 * k} 0 R`).join(" ")}] >>\nendobj\n`);

  for (let k = 0; k < n; k++) {
    onStatus(`Page ${k + 1} of ${n}`);
    const { w, h } = pages[k];
    const blob = await pages[k].load();
    const L = layout(w, h, size, margin);
    const pg = 3 + 3 * k, ct = pg + 1, im = pg + 2;

    begin(pg);
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(L.pw)} ${f(L.ph)}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>\nendobj\n`);

    const content = `q ${f(L.iw)} 0 0 ${f(L.ih)} ${f(L.x)} ${f(L.y)} cm /Im0 Do Q`;
    begin(ct);
    add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

    begin(im);
    add(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${blob.size} >>\nstream\n`);
    add(blob);
    add("\nendstream\nendobj\n");
    await tick();
  }

  const count = 3 + 3 * n;
  const xref = pos;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) table += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  add(table);
  add(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

/* ---------- searchable PDF (OCR): needs pdf-lib, so it is capped ---------- */
export async function buildPdfOcr(pages, { size, margin }, lang, onStatus) {
  const doc = await PDFDocument.create();
  let worker = null;
  let step = "";
  try {
    onStatus("Loading text recognition (the first time it downloads the language data)...");
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker(lang, 1, {
      logger: (m) => {
        if (m.status && typeof m.progress === "number") onStatus(`${step} · ${m.status} ${Math.round(m.progress * 100)}%`);
      },
    });
    for (let k = 0; k < pages.length; k++) {
      step = `Page ${k + 1} of ${pages.length}`;
      onStatus(step);
      const { w, h } = pages[k];
      const blob = await pages[k].load();
      const L = layout(w, h, size, margin);
      const page = doc.addPage([L.pw, L.ph]);
      const { data } = await worker.recognize(blob, {}, { pdf: true });
      const [embedded] = await doc.embedPdf(new Uint8Array(data.pdf));
      page.drawPage(embedded, { x: L.x, y: L.y, width: L.iw, height: L.ih });
      await tick();
    }
    onStatus("Saving the PDF...");
    return new Blob([await doc.save()], { type: "application/pdf" });
  } finally {
    if (worker) await worker.terminate();
  }
}