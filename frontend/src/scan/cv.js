// Scanner image engine: clamped decoding, page finding, straightening, filters (OpenCV.js)
let cvPromise = null;
const stats = { made: 0, freed: 0 };
export const cvStats = () => ({ made: stats.made, freed: stats.freed, live: stats.made - stats.freed });

export function loadCV() {
  if (!cvPromise) {
    cvPromise = (async () => {
      let cv = (await import("@techstark/opencv-js")).default;
      if (cv && typeof cv.then === "function") cv = await cv;
      if (!cv.Mat) await new Promise((resolve) => { cv.onRuntimeInitialized = resolve; });
      return cv;
    })();
    cvPromise.catch(() => { cvPromise = null; });
  }
  return cvPromise;
}

/* ---------- rule 5: deterministic freeing of WebAssembly objects ---------- */
function arena() {
  const items = [];
  return {
    track(x) { items.push(x); stats.made++; return x; },
    free() {
      for (let i = items.length - 1; i >= 0; i--) {
        try { items[i].delete(); } catch { /* already freed */ }
        stats.freed++;
      }
      items.length = 0;
    },
  };
}

export function release(c) {
  if (c) { c.width = 0; c.height = 0; } // frees the canvas memory right away
}

/* ---------- rule 2: clamp what we decode ---------- */
export function pixelBudget() {
  const mem = navigator.deviceMemory || 2;
  return mem <= 2 ? 1400 : mem <= 4 ? 1800 : 2200;
}

async function peekSize(file) {
  const b = new Uint8Array(await file.slice(0, 131072).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8) { // JPEG: read the frame header
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return null;
  }
  if (b[0] === 0x89 && b[1] === 0x50) { // PNG
    const u32 = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    return { w: u32(16), h: u32(20) };
  }
  return null;
}

async function viaImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Could not read this photo"));
      i.src = url;
    });
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => { img.src = ""; } };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodeClamped(file, maxSide = pixelBudget()) {
  const size = await peekSize(file).catch(() => null);
  const k = size ? Math.min(1, maxSide / Math.max(size.w, size.h)) : 1;
  let dec;
  try {
    const opt = { imageOrientation: "from-image" };
    if (k < 1) { opt.resizeWidth = Math.max(Math.round(size.w * k), 1); opt.resizeQuality = "medium"; }
    const bmp = await createImageBitmap(file, opt); // the decoder downsizes, so no full-size bitmap
    dec = { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close?.() };
  } catch {
    dec = await viaImage(file);
  }
  const s = Math.min(1, maxSide / Math.max(dec.w, dec.h));
  const c = document.createElement("canvas");
  c.width = Math.max(Math.round(dec.w * s), 1);
  c.height = Math.max(Math.round(dec.h * s), 1);
  c.getContext("2d").drawImage(dec.src, 0, 0, c.width, c.height);
  dec.close();
  return c;
}

export const canvasToBlob = (c, type = "image/jpeg", q = 0.88) =>
  new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not save the image"))), type, q));

export async function makeThumb(canvas, side = 240) {
  const k = Math.min(1, side / Math.max(canvas.width, canvas.height));
  const t = document.createElement("canvas");
  t.width = Math.max(Math.round(canvas.width * k), 1);
  t.height = Math.max(Math.round(canvas.height * k), 1);
  t.getContext("2d").drawImage(canvas, 0, 0, t.width, t.height);
  const b = await canvasToBlob(t, "image/jpeg", 0.7);
  release(t);
  return b;
}

export function rotateCanvas(c, deg) {
  deg = ((deg % 360) + 360) % 360;
  if (!deg) return c;
  const o = document.createElement("canvas");
  const turned = deg % 180 !== 0;
  o.width = turned ? c.height : c.width;
  o.height = turned ? c.width : c.height;
  const x = o.getContext("2d");
  x.translate(o.width / 2, o.height / 2);
  x.rotate((deg * Math.PI) / 180);
  x.drawImage(c, -c.width / 2, -c.height / 2);
  return o;
}

/* ---------- rule 4: layout-aware page finding ---------- */
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

function orderQuad(p) {
  const s = p.map(([x, y]) => x + y);
  const d = p.map(([x, y]) => y - x);
  return [
    p[s.indexOf(Math.min(...s))], // top-left
    p[d.indexOf(Math.min(...d))], // top-right
    p[s.indexOf(Math.max(...s))], // bottom-right
    p[d.indexOf(Math.max(...d))], // bottom-left
  ];
}

// collect page-shaped regions from a binary picture, scored by size x rectangularity
function collect(cv, A, bin, w, h, out) {
  const contours = A.track(new cv.MatVector());
  const hier = A.track(new cv.Mat());
  cv.findContours(bin, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  for (let i = 0; i < contours.size(); i++) {
    const c = A.track(contours.get(i));
    const ratio = cv.contourArea(c) / (w * h);
    if (ratio < 0.15 || ratio > 0.97) continue; // too small, or just the photo frame
    const rect = cv.minAreaRect(c);
    const rectArea = rect.size.width * rect.size.height;
    if (rectArea <= 0) continue;
    const rectangularity = cv.contourArea(c) / rectArea;
    if (rectangularity < 0.75) continue; // not page-shaped

    let pts = null;
    const approx = A.track(new cv.Mat());
    cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true);
    if (approx.rows === 4 && cv.isContourConvex(approx)) {
      pts = [];
      for (let j = 0; j < 4; j++) pts.push([approx.data32S[j * 2], approx.data32S[j * 2 + 1]]);
    } else {
      try { pts = cv.RotatedRect.points(rect).map((p) => [p.x, p.y]); } catch { continue; }
    }
    out.push({ pts, score: ratio * rectangularity });
  }
}

// 4 corners as fractions (TL, TR, BR, BL), or null
export function detectDocument(cv, canvas) {
  const A = arena();
  const k = Math.min(1, 500 / Math.max(canvas.width, canvas.height));
  const w = Math.max(Math.round(canvas.width * k), 1);
  const h = Math.max(Math.round(canvas.height * k), 1);
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  small.getContext("2d").drawImage(canvas, 0, 0, w, h);
  const found = [];
  try {
    const src = A.track(cv.imread(small));
    const gray = A.track(new cv.Mat());
    const blur = A.track(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

    // strategy A: edges
    const edges = A.track(new cv.Mat());
    const k5 = A.track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
    cv.Canny(blur, edges, 50, 150);
    cv.dilate(edges, edges, k5);
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, k5);
    collect(cv, A, edges, w, h, found);

    // strategy B: bright paper against a darker surface
    const bin = A.track(new cv.Mat());
    const k15 = A.track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 15)));
    cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k15);
    cv.morphologyEx(bin, bin, cv.MORPH_OPEN, k15);
    collect(cv, A, bin, w, h, found);

    // strategy C: dark paper on a lighter surface
    const inv = A.track(new cv.Mat());
    cv.bitwise_not(bin, inv);
    collect(cv, A, inv, w, h, found);
  } finally {
    A.free();
    release(small);
  }
  if (!found.length) return null;
  found.sort((a, b) => b.score - a.score);
  return orderQuad(found[0].pts.map(([x, y]) => [clamp01(x / w), clamp01(y / h)]));
}

// fallback when no page outline is found: crop to the block of printed content
export function contentQuad(cv, canvas) {
  const A = arena();
  const k = Math.min(1, 500 / Math.max(canvas.width, canvas.height));
  const w = Math.max(Math.round(canvas.width * k), 1);
  const h = Math.max(Math.round(canvas.height * k), 1);
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  small.getContext("2d").drawImage(canvas, 0, 0, w, h);
  try {
    const src = A.track(cv.imread(small));
    const gray = A.track(new cv.Mat());
    const bin = A.track(new cv.Mat());
    const kern = A.track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(25, 25)));
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 15);
    cv.dilate(bin, bin, kern); // merge letters into text blocks
    const r = cv.boundingRect(bin);
    const ratio = (r.width * r.height) / (w * h);
    if (ratio < 0.2 || ratio > 0.95) return null;
    const px = w * 0.02, py = h * 0.02;
    const x0 = clamp01((r.x - px) / w), y0 = clamp01((r.y - py) / h);
    const x1 = clamp01((r.x + r.width + px) / w), y1 = clamp01((r.y + r.height + py) / h);
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  } catch {
    return null;
  } finally {
    A.free();
    release(small);
  }
}

/* ---------- straighten ---------- */
export function warp(cv, canvas, quad, maxSide = pixelBudget()) {
  const A = arena();
  const pts = quad.map(([x, y]) => [x * canvas.width, y * canvas.height]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let outW = Math.max(dist(pts[0], pts[1]), dist(pts[3], pts[2]));
  let outH = Math.max(dist(pts[0], pts[3]), dist(pts[1], pts[2]));
  const k = Math.min(1, maxSide / Math.max(outW, outH, 1));
  outW = Math.max(Math.round(outW * k), 1);
  outH = Math.max(Math.round(outH * k), 1);
  try {
    const src = A.track(cv.imread(canvas));
    const dst = A.track(new cv.Mat());
    const from = A.track(cv.matFromArray(4, 1, cv.CV_32FC2, pts.flat()));
    const to = A.track(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH]));
    const M = A.track(cv.getPerspectiveTransform(from, to));
    cv.warpPerspective(src, dst, M, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    cv.imshow(out, dst);
    return out;
  } finally {
    A.free();
  }
}

/* ---------- filters (rule 3: adaptive thresholding) ---------- */
const odd = (n) => (n % 2 ? n : n + 1);

function estimateBackground(cv, A, gray, bg) {
  const small = A.track(new cv.Mat());
  const d = A.track(new cv.Mat());
  const m = A.track(new cv.Mat());
  const kernel = A.track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)));
  cv.resize(gray, small, new cv.Size(Math.max(gray.cols >> 2, 1), Math.max(gray.rows >> 2, 1)), 0, 0, cv.INTER_AREA);
  cv.dilate(small, d, kernel); // removes thin ink strokes
  cv.medianBlur(d, m, 15);
  cv.resize(m, bg, new cv.Size(gray.cols, gray.rows), 0, 0, cv.INTER_LINEAR);
}

export function enhance(cv, canvas, mode) {
  if (mode === "original") return canvas;
  const A = arena();
  try {
    const src = A.track(cv.imread(canvas));
    const gray = A.track(new cv.Mat());
    const bg = A.track(new cv.Mat());
    const norm = A.track(new cv.Mat());
    const dst = A.track(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    estimateBackground(cv, A, gray, bg);

    if (mode === "color") {
      const bg4 = A.track(new cv.Mat());
      cv.cvtColor(bg, bg4, cv.COLOR_GRAY2RGBA);
      cv.divide(src, bg4, norm, 255); // paper becomes white, shadows disappear
      cv.convertScaleAbs(norm, dst, 1.1, -8);
    } else {
      cv.divide(gray, bg, norm, 255);
      if (mode === "gray") {
        cv.convertScaleAbs(norm, dst, 1.15, -15);
      } else {
        // the block size follows the page size, the constant follows the page contrast
        const mean = A.track(new cv.Mat());
        const std = A.track(new cv.Mat());
        cv.meanStdDev(norm, mean, std);
        const sd = std.data64F[0];
        const smooth = A.track(new cv.Mat());
        cv.medianBlur(norm, smooth, 3); // removes speckle
        if (sd < 18) {
          cv.threshold(smooth, dst, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU); // low contrast page
        } else {
          const block = Math.max(15, Math.min(71, odd(Math.round(Math.min(canvas.width, canvas.height) / 22))));
          const C = Math.max(8, Math.min(22, Math.round(sd * 0.22)));
          cv.adaptiveThreshold(smooth, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, block, C);
        }
      }
    }
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    cv.imshow(out, dst);
    return out;
  } finally {
    A.free();
  }
}

// raw photo + corners + rotation + filter  ->  finished page (JPEG, size, small preview)
export async function renderPage(cv, it) {
  const src = await decodeClamped(it.raw);
  let c = it.quad ? warp(cv, src, it.quad) : src;
  if (c !== src) release(src);

  const rotated = rotateCanvas(c, it.rotate);
  if (rotated !== c) release(c);
  c = rotated;

  const done = enhance(cv, c, it.filter);
  if (done !== c) release(c);

  const blob = await canvasToBlob(done, "image/jpeg", it.filter === "bw" ? 0.92 : 0.88);
  const thumb = await makeThumb(done);
  const w = done.width, h = done.height;
  release(done);
  return { blob, w, h, thumb };
}