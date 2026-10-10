import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const MAX_PAGES = 30;
const MAX_FILE = 20 * 1024 * 1024;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

const btn = { padding: "6px 12px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer" };
const primary = { ...btn, background: "#4f46e5", color: "#fff", border: "none", padding: "9px 22px", borderRadius: 8 };

const FILTERS = [
  ["original", "Original"], ["enhanced", "Enhanced"], ["gray", "Grayscale"], ["bw", "Black & white"],
];
const PREVIEW = {
  original: "none",
  enhanced: "contrast(1.15) brightness(1.05)",
  gray: "grayscale(1) contrast(1.2)",
  bw: "grayscale(1) contrast(3) brightness(1.15)",
};

export default function Scanner() {
  const [items, setItems] = useState([]);
  const [camera, setCamera] = useState(false);
  const [crop, setCrop] = useState(null); // { id, src, box }
  const [size, setSize] = useState("a4");
  const [margin, setMargin] = useState("small");
  const [ocr, setOcr] = useState(false);
  const [lang, setLang] = useState("eng");
  const [langs, setLangs] = useState([{ value: "eng", label: "English" }]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cropCanvas = useRef(null);
  const cropDrag = useRef(null);
  const counter = useRef(0);
  const pickInput = useRef(null);
  const photoInput = useRef(null);

  useEffect(() => {
    fetch(`${API}/tools/ocr-languages`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((l) => { if (Array.isArray(l) && l.length) setLangs(l); })
      .catch(() => {});
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    if (camera && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [camera]);

  // ---------- adding pages ----------
  const addFiles = (list) => {
    const files = Array.from(list).filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (!files.length) return setError("Please choose JPG, PNG or WebP images");
    setError("");
    setItems((cur) => {
      const room = MAX_PAGES - cur.length;
      if (files.length > room) setError(`You can scan up to ${MAX_PAGES} pages`);
      const added = [];
      for (const f of files.slice(0, Math.max(room, 0))) {
        if (f.size > MAX_FILE) { setError(`${f.name} is larger than 20 MB`); continue; }
        added.push({ id: ++counter.current, file: f, url: URL.createObjectURL(f), rotate: 0, filter: "enhanced" });
      }
      return [...cur, ...added];
    });
  };

  const openCamera = async () => {
    setError("");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
      });
      streamRef.current = s;
      setCamera(true);
    } catch {
      setError("Could not open the camera. Allow camera access, or use Take photo / Choose images.");
    }
  };
  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamera(false);
  };
  const snap = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    c.toBlob((b) => b && addFiles([new File([b], `scan_${Date.now()}.jpg`, { type: "image/jpeg" })]), "image/jpeg", 0.92);
  };

  // ---------- page actions ----------
  const patch = (id, ch) => setItems((l) => l.map((i) => (i.id === id ? { ...i, ...ch } : i)));
  const remove = (id) => {
    setItems((l) => {
      const it = l.find((i) => i.id === id);
      if (it) URL.revokeObjectURL(it.url);
      return l.filter((i) => i.id !== id);
    });
  };
  const move = (i, d) =>
    setItems((l) => {
      const j = i + d;
      if (j < 0 || j >= l.length) return l;
      const n = [...l];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const setAllFilters = (f) => setItems((l) => l.map((i) => ({ ...i, filter: f })));

  // ---------- crop (bakes the rotation into the picture) ----------
  const openCrop = (it) => {
    const img = new Image();
    img.onload = () => {
      const turned = it.rotate % 180 !== 0;
      const c = document.createElement("canvas");
      c.width = turned ? img.naturalHeight : img.naturalWidth;
      c.height = turned ? img.naturalWidth : img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((it.rotate * Math.PI) / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      cropCanvas.current = c;
      setCrop({ id: it.id, src: c.toDataURL("image/jpeg", 0.8), box: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 } });
    };
    img.onerror = () => setError("Could not open this image for cropping");
    img.src = it.url;
  };

  const pt = (e, rect) => [clamp((e.clientX - rect.left) / rect.width, 0, 1), clamp((e.clientY - rect.top) / rect.height, 0, 1)];
  const startCrop = (e, mode) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.closest("[data-crop]").getBoundingClientRect();
    const [px, py] = pt(e, rect);
    cropDrag.current = { mode, rect, px, py, start: { ...crop.box } };
  };
  const moveCrop = (e) => {
    const d = cropDrag.current;
    if (!d) return;
    const [px, py] = pt(e, d.rect);
    const s = d.start, dx = px - d.px, dy = py - d.py;
    if (d.mode === "move") {
      setCrop((c) => ({ ...c, box: { ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) } }));
      return;
    }
    let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
    if (d.mode.includes("l")) x0 = clamp(s.x + dx, 0, x1 - 0.05);
    if (d.mode.includes("r")) x1 = clamp(s.x + s.w + dx, x0 + 0.05, 1);
    if (d.mode.includes("t")) y0 = clamp(s.y + dy, 0, y1 - 0.05);
    if (d.mode.includes("b")) y1 = clamp(s.y + s.h + dy, y0 + 0.05, 1);
    setCrop((c) => ({ ...c, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } }));
  };
  const endCrop = () => (cropDrag.current = null);

  const applyCrop = () => {
    const src = cropCanvas.current;
    const { x, y, w, h } = crop.box;
    const out = document.createElement("canvas");
    out.width = Math.max(Math.round(w * src.width), 1);
    out.height = Math.max(Math.round(h * src.height), 1);
    out.getContext("2d").drawImage(src, x * src.width, y * src.height, out.width, out.height, 0, 0, out.width, out.height);
    out.toBlob((b) => {
      if (!b) return setError("Cropping failed");
      const id = crop.id;
      const file = new File([b], `crop_${Date.now()}.jpg`, { type: "image/jpeg" });
      setItems((l) => l.map((i) => {
        if (i.id !== id) return i;
        URL.revokeObjectURL(i.url);
        return { ...i, file, url: URL.createObjectURL(file), rotate: 0 };
      }));
      setCrop(null);
    }, "image/jpeg", 0.92);
  };

  // ---------- save ----------
  const save = async () => {
    if (!items.length) return setError("Add at least one page first");
    setBusy(ocr ? "Building and reading your PDF (this can take a while)..." : "Building your PDF..."); setError("");
    try {
      const body = new FormData();
      items.forEach((i, k) => body.append("files", i.file, `page${k}.${i.file.type === "image/png" ? "png" : i.file.type === "image/webp" ? "webp" : "jpg"}`));
      body.append("plan", JSON.stringify(items.map((i) => ({ rotate: i.rotate, filter: i.filter }))));
      body.append("size", size);
      body.append("margin", margin);
      body.append("ocr", ocr ? "true" : "false");
      body.append("lang", lang);
      const res = await fetch(`${API}/tools/scan-to-pdf`, { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
      }
      const blob = await res.blob();
      setResult({ url: URL.createObjectURL(blob), name: "scan.pdf" });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const reset = () => {
    items.forEach((i) => URL.revokeObjectURL(i.url));
    if (result) URL.revokeObjectURL(result.url);
    closeCamera();
    setItems([]); setResult(null); setError(""); setCrop(null);
  };

  /* ---------- screens ---------- */
  if (result) {
    return (
      <div style={{ textAlign: "center", padding: "30px 0" }}>
        <div style={{ fontSize: 44, color: "#16a34a" }}>✓</div>
        <h2>Your PDF is ready</h2>
        <a href={result.url} download={result.name}
          style={{ display: "inline-block", padding: "10px 24px", background: "#4f46e5", color: "#fff", borderRadius: 8, textDecoration: "none" }}>
          Download PDF
        </a>
        <p>
          <button style={btn} onClick={() => setResult(null)}>Keep editing</button>{" "}
          <button style={btn} onClick={reset}>Scan another document</button>
        </p>
        <p style={{ color: "#666", fontSize: 14 }}>Your pictures are deleted from the server right after processing.</p>
      </div>
    );
  }

  const handle = (c) => ({
    position: "absolute", width: 16, height: 16, background: "#fff", border: "2px solid #4f46e5", borderRadius: 3,
    [c.includes("t") ? "top" : "bottom"]: -9, [c.includes("l") ? "left" : "right"]: -9,
    cursor: c === "tl" || c === "br" ? "nwse-resize" : "nesw-resize", touchAction: "none",
  });

  return (
    <div>
      {/* hidden inputs: gallery and phone camera */}
      <input ref={pickInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
        onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

      {/* crop window */}
      {crop && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 20, display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div data-crop onPointerMove={moveCrop} onPointerUp={endCrop}
            style={{ position: "relative", display: "inline-block", maxWidth: "92vw", userSelect: "none", touchAction: "none" }}>
            <img src={crop.src} alt="Crop" draggable={false}
              style={{ display: "block", maxWidth: "92vw", maxHeight: "74vh", pointerEvents: "none" }} />
            <div onPointerDown={(e) => startCrop(e, "move")} onPointerMove={moveCrop} onPointerUp={endCrop}
              style={{ position: "absolute", left: `${crop.box.x * 100}%`, top: `${crop.box.y * 100}%`,
                width: `${crop.box.w * 100}%`, height: `${crop.box.h * 100}%`, boxSizing: "border-box",
                border: "2px solid #4f46e5", boxShadow: "0 0 0 9999px rgba(0,0,0,.55)", cursor: "move" }}>
              {["tl", "tr", "bl", "br"].map((c) => (
                <div key={c} onPointerDown={(e) => startCrop(e, c)} onPointerMove={moveCrop} onPointerUp={endCrop} style={handle(c)} />
              ))}
            </div>
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            <button style={primary} onClick={applyCrop}>Apply crop</button>
            <button style={btn} onClick={() => setCrop(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* live camera */}
      {camera && (
        <div style={{ border: "1px solid #e2e2e8", borderRadius: 12, padding: 12, marginBottom: 16, background: "#000", textAlign: "center" }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", maxWidth: 640, borderRadius: 8 }} />
          <div style={{ marginTop: 10, display: "flex", gap: 10, justifyContent: "center", alignItems: "center" }}>
            <button style={primary} onClick={snap}>📷 Capture page</button>
            <button style={btn} onClick={closeCamera}>Done</button>
            <span style={{ color: "#ccc", fontSize: 14 }}>{items.length} page(s) captured</span>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <button style={primary} onClick={openCamera}>Use camera</button>
        <button style={btn} onClick={() => photoInput.current.click()}>Take photo</button>
        <button style={btn} onClick={() => pickInput.current.click()}>＋ Choose images</button>
        {items.length > 1 && (
          <label style={{ marginLeft: "auto", fontSize: 14 }}>Filter for all pages{" "}
            <select defaultValue="" onChange={(e) => { if (e.target.value) setAllFilters(e.target.value); e.target.value = ""; }}>
              <option value="">Choose…</option>
              {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
      </div>

      {!items.length && !camera && (
        <div onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          style={{ border: "2px dashed #b9b9ff", borderRadius: 12, padding: "50px 20px", textAlign: "center", background: "#fafaff" }}>
          <p style={{ fontSize: 18, margin: 0 }}>Scan with your camera, or drop photos here</p>
          <p style={{ color: "#666" }}>JPG, PNG or WebP · up to {MAX_PAGES} pages · 20 MB each</p>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 480px", display: "flex", flexWrap: "wrap", gap: 14 }}>
            {items.map((it, i) => {
              const turned = it.rotate % 180 !== 0;
              return (
                <div key={it.id} style={{ width: 180, border: "1px solid #e2e2e8", borderRadius: 10, padding: 8, background: "#fff" }}>
                  <div style={{ width: 164, height: 210, display: "flex", alignItems: "center", justifyContent: "center",
                    overflow: "hidden", background: "#f3f4f6", borderRadius: 6 }}>
                    <img src={it.url} alt={`Page ${i + 1}`} draggable={false}
                      style={{ maxWidth: turned ? 210 : 164, maxHeight: turned ? 164 : 210,
                        transform: `rotate(${it.rotate}deg)`, filter: PREVIEW[it.filter], transition: "transform .15s" }} />
                  </div>
                  <div style={{ fontSize: 12, textAlign: "center", margin: "6px 0" }}>Page {i + 1}</div>
                  <select value={it.filter} onChange={(e) => patch(it.id, { filter: e.target.value })}
                    style={{ width: "100%", marginBottom: 6 }}>
                    {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                    <button style={{ ...btn, padding: "2px 8px" }} title="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>←</button>
                    <button style={{ ...btn, padding: "2px 8px" }} title="Move later" disabled={i === items.length - 1} onClick={() => move(i, 1)}>→</button>
                    <button style={{ ...btn, padding: "2px 8px" }} title="Rotate" onClick={() => patch(it.id, { rotate: (it.rotate + 90) % 360 })}>⟳</button>
                    <button style={{ ...btn, padding: "2px 8px" }} title="Crop" onClick={() => openCrop(it)}>Crop</button>
                    <button style={{ ...btn, padding: "2px 8px" }} title="Delete" onClick={() => remove(it.id)}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>

          <aside style={{ flex: "0 0 250px", position: "sticky", top: 10, border: "1px solid #e2e2e8", borderRadius: 12, padding: 14, background: "#fff" }}>
            <b>PDF options</b>
            <label style={{ display: "block", marginTop: 10, fontSize: 14 }}>Page size<br />
              <select value={size} onChange={(e) => setSize(e.target.value)} style={{ width: "100%" }}>
                <option value="a4">A4</option><option value="letter">US Letter</option><option value="fit">Same size as the picture</option>
              </select>
            </label>
            <label style={{ display: "block", marginTop: 10, fontSize: 14 }}>Margin<br />
              <select value={margin} onChange={(e) => setMargin(e.target.value)} style={{ width: "100%" }}>
                <option value="none">None</option><option value="small">Small</option><option value="big">Big</option>
              </select>
            </label>
            <label style={{ display: "block", marginTop: 12, fontSize: 14 }}>
              <input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} /> Make text searchable (OCR)
            </label>
            {ocr && (
              <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ width: "100%", marginTop: 6 }}>
                {langs.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            )}
            <p style={{ color: "#888", fontSize: 12 }}>OCR is slow: up to about 30 seconds per page.</p>
            <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #eee" }} />
            <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>{items.length} page(s)</div>
            <button style={{ ...primary, width: "100%" }} onClick={save} disabled={!!busy}>{busy ? "Working..." : "Create PDF"}</button>
            <button style={{ ...btn, width: "100%", marginTop: 8 }} onClick={reset}>Start over</button>
            {busy && <p style={{ color: "#666", fontSize: 13 }}>{busy}</p>}
          </aside>
        </div>
      )}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}