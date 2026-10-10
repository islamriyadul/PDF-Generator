// Image helpers: edge detection, perspective fix, filters (OpenCV.js)
let cvPromise = null;

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

export async function fileToCanvas(file, maxSide = 2400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Could not read this photo"));
      i.src = url;
    });
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(Math.round(img.naturalWidth * k), 1);
    c.height = Math.max(Math.round(img.naturalHeight * k), 1);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const blobToCanvas = (blob) => fileToCanvas(blob, 100000);

export const canvasToBlob = (c, type = "image/jpeg", q = 0.9) =>
  new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not save the image"))), type, q));

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

// Returns 4 corners as fractions (0..1) in the order TL, TR, BR, BL, or null
export function detectDocument(cv, canvas) {
  const k = Math.min(1, 500 / Math.max(canvas.width, canvas.height));
  const w = Math.max(Math.round(canvas.width * k), 1);
  const h = Math.max(Math.round(canvas.height * k), 1);
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  small.getContext("2d").drawImage(canvas, 0, 0, w, h);

  const src = cv.imread(small);
  const gray = new cv.Mat(), blur = new cv.Mat(), edges = new cv.Mat(), dil = new cv.Mat();
  const contours = new cv.MatVector(), hier = new cv.Mat();
  let best = null;
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    cv.Canny(blur, edges, 50, 150);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(edges, dil, kernel);
    kernel.delete();
    cv.findContours(dil, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let bestArea = w * h * 0.15; // the page must cover at least 15% of the picture
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area > bestArea) {
        const approx = new cv.Mat();
        cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          bestArea = area;
          best = [];
          for (let j = 0; j < 4; j++) best.push([approx.data32S[j * 2] / w, approx.data32S[j * 2 + 1] / h]);
        }
        approx.delete();
      }
      c.delete();
    }
  } finally {
    src.delete(); gray.delete(); blur.delete(); edges.delete(); dil.delete();
    contours.delete(); hier.delete();
  }
  return best ? orderQuad(best) : null;
}

// Crop and straighten the page defined by the 4 corners
export function warp(cv, canvas, quad) {
  const pts = quad.map(([x, y]) => [x * canvas.width, y * canvas.height]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let outW = Math.max(dist(pts[0], pts[1]), dist(pts[3], pts[2]));
  let outH = Math.max(dist(pts[0], pts[3]), dist(pts[1], pts[2]));
  const k = Math.min(1, 2600 / Math.max(outW, outH, 1));
  outW = Math.max(Math.round(outW * k), 1);
  outH = Math.max(Math.round(outH * k), 1);

  const src = cv.imread(canvas);
  const dst = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, pts.flat());
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH]);
  const M = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(src, dst, M, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    cv.imshow(out, dst);
    return out;
  } finally {
    src.delete(); dst.delete(); from.delete(); to.delete(); M.delete();
  }
}

// Estimate the paper's lighting (shadows) at 1/4 size so it is fast on a phone
function estimateBackground(cv, gray, bg) {
  const small = new cv.Mat(), d = new cv.Mat(), m = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
  try {
    cv.resize(small.cols ? small : gray, small,
      new cv.Size(Math.max(gray.cols >> 2, 1), Math.max(gray.rows >> 2, 1)), 0, 0, cv.INTER_AREA);
    cv.dilate(small, d, kernel); // removes thin ink strokes
    cv.medianBlur(d, m, 15);
    cv.resize(m, bg, new cv.Size(gray.cols, gray.rows), 0, 0, cv.INTER_LINEAR);
  } finally {
    small.delete(); d.delete(); m.delete(); kernel.delete();
  }
}

export function enhance(cv, canvas, mode) {
  if (mode === "original") return canvas;
  const src = cv.imread(canvas);
  const gray = new cv.Mat(), bg = new cv.Mat(), norm = new cv.Mat(), dst = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    estimateBackground(cv, gray, bg);
    if (mode === "color") {
      const bg4 = new cv.Mat();
      cv.cvtColor(bg, bg4, cv.COLOR_GRAY2RGBA);
      cv.divide(src, bg4, norm, 255); // paper becomes white, shadows disappear
      cv.convertScaleAbs(norm, dst, 1.1, -8);
      bg4.delete();
    } else {
      cv.divide(gray, bg, norm, 255);
      if (mode === "gray") cv.convertScaleAbs(norm, dst, 1.15, -15);
      else cv.adaptiveThreshold(norm, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 14);
    }
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    cv.imshow(out, dst);
    return out;
  } finally {
    src.delete(); gray.delete(); bg.delete(); norm.delete(); dst.delete();
  }
}

// raw photo + corners + rotation + filter  ->  finished page image
export async function renderPage(cv, it) {
  const src = await blobToCanvas(it.raw);
  let c = it.quad ? warp(cv, src, it.quad) : src;
  c = rotateCanvas(c, it.rotate);
  c = enhance(cv, c, it.filter);
  const blob = await canvasToBlob(c, it.filter === "bw" ? "image/png" : "image/jpeg", 0.9);
  return { blob, w: c.width, h: c.height };
}