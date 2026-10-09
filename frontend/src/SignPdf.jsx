import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const MAX_FILE = 20 * 1024 * 1024;
const STORE = "pdfgen.signs.v1";
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const FONTS = ["'Brush Script MT', cursive", "'Segoe Script', cursive", "'Lucida Handwriting', cursive", "cursive"];
const TARGET_H = { signature: 0.07, initials: 0.05, text: 0.025, date: 0.025 }; // height as a share of the page

const btn = { padding: "6px 12px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer" };
const primary = { ...btn, background: "#4f46e5", color: "#fff", border: "none", padding: "9px 22px", borderRadius: 8 };

function trimCanvas(src) {
  const { width, height } = src;
  const data = src.getContext("2d").getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return null;
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext("2d").drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function textAsset(text) {
  const font = "600 56px Arial, sans-serif";
  const m = document.createElement("canvas").getContext("2d");
  m.font = font;
  const c = document.createElement("canvas");
  c.width = Math.ceil(m.measureText(text).width) + 20;
  c.height = 90;
  const ctx = c.getContext("2d");
  ctx.font = font;
  ctx.fillStyle = "#111827";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 10, 45);
  const t = trimCanvas(c);
  return t ? { url: t.toDataURL("image/png"), ratio: t.width / t.height } : null;
}

const loadStored = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || "[]");
    return Array.isArray(raw)
      ? raw.filter((a) => a && typeof a.url === "string" && a.url.startsWith("data:image/png") &&
          typeof a.ratio === "number" && ["signature", "initials"].includes(a.kind))
      : [];
  } catch {
    return [];
  }
};

/* ---------- maker: draw / type / upload ---------- */
function SignatureMaker({ title, onDone, onCancel }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [tab, setTab] = useState("draw");
  const [color, setColor] = useState("#111827");
  const [pen, setPen] = useState(2.5);
  const [text, setText] = useState("");
  const [font, setFont] = useState(FONTS[0]);
  const [cutout, setCutout] = useState(true);
  const [err, setErr] = useState("");

  const clear = () => {
    const c = canvasRef.current;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
  };
  const switchTab = (t) => { setTab(t); setErr(""); clear(); setText(""); };
  const pos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)];
  };
  const down = (e) => {
    if (tab !== "draw") return;
    drawing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineWidth = pen; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = color;
    ctx.beginPath();
    const [x, y] = pos(e);
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext("2d");
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const renderText = (t, f, col = color) => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    if (!t) return;
    let size = 100;
    ctx.font = `${size}px ${f}`;
    while (size > 24 && ctx.measureText(t).width > c.width - 40) {
      size -= 4;
      ctx.font = `${size}px ${f}`;
    }
    ctx.fillStyle = col;
    ctx.textBaseline = "middle";
    ctx.fillText(t, 20, c.height / 2);
  };

  const loadImage = (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setErr("Image is larger than 5 MB");
    const img = new Image();
    img.onload = () => {
      const c = canvasRef.current;
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      const s = Math.min(c.width / img.width, c.height / img.height, 1);
      ctx.drawImage(img, 0, 0, img.width * s, img.height * s);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => setErr("Could not read this image");
    img.src = URL.createObjectURL(file);
  };

  const use = () => {
    const c = canvasRef.current;
    if (tab === "upload" && cutout) {
      const ctx = c.getContext("2d");
      const im = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < im.data.length; i += 4) {
        const lum = 0.299 * im.data[i] + 0.587 * im.data[i + 1] + 0.114 * im.data[i + 2];
        im.data[i + 3] = clamp(((230 - lum) * 255) / 120, 0, 255) * (im.data[i + 3] / 255);
      }
      ctx.putImageData(im, 0, 0);
    }
    const t = trimCanvas(c);
    if (!t) return setErr("Draw, type or upload first");
    onDone(t.toDataURL("image/png"), t.width / t.height);
  };

  const tabBtn = (id, label) => (
    <button key={id} onClick={() => switchTab(id)}
      style={{ ...btn, borderRadius: 0, background: tab === id ? "#4f46e5" : "#fff", color: tab === id ? "#fff" : "#222" }}>
      {label}
    </button>
  );

  return (
    <div style={{ border: "1px solid #e2e2e8", borderRadius: 12, padding: 16, background: "#fff", maxWidth: 620, marginBottom: 16 }}>
      <b>{title}</b>
      <div style={{ display: "flex", margin: "10px 0" }}>
        {tabBtn("draw", "Draw")}{tabBtn("type", "Type")}{tabBtn("upload", "Upload image")}
      </div>
      <canvas ref={canvasRef} width={600} height={220}
        onPointerDown={down} onPointerMove={move} onPointerUp={() => (drawing.current = false)}
        style={{ width: "100%", maxWidth: 600, border: "1px dashed #aaa", borderRadius: 8, background: "#fff",
          touchAction: "none", cursor: tab === "draw" ? "crosshair" : "default" }} />
      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {tab !== "upload" && (
          <label>Colour{" "}
            <input type="color" value={color}
              onChange={(e) => { setColor(e.target.value); if (tab === "type") renderText(text, font, e.target.value); }} />
          </label>
        )}
        {tab === "draw" && (
          <>
            <label>Pen{" "}
              <select value={pen} onChange={(e) => setPen(+e.target.value)}>
                <option value={2.5}>Thin</option><option value={4}>Medium</option><option value={6}>Thick</option>
              </select>
            </label>
            <button style={btn} onClick={clear}>Clear</button>
          </>
        )}
        {tab === "type" && (
          <>
            <input placeholder="Type your name" value={text} maxLength={40}
              onChange={(e) => { setText(e.target.value); renderText(e.target.value, font); }} />
            <select value={font} onChange={(e) => { setFont(e.target.value); renderText(text, e.target.value); }}>
              {FONTS.map((f, i) => <option key={f} value={f}>Style {i + 1}</option>)}
            </select>
          </>
        )}
        {tab === "upload" && (
          <>
            <input type="file" accept="image/png,image/jpeg" onChange={(e) => loadImage(e.target.files[0])} />
            <label><input type="checkbox" checked={cutout} onChange={(e) => setCutout(e.target.checked)} />{" "}
              Remove white background</label>
          </>
        )}
      </div>
      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <button style={primary} onClick={use}>Save</button>
        {onCancel && <button style={btn} onClick={onCancel}>Cancel</button>}
      </div>
      <p style={{ color: "#777", fontSize: 12, marginBottom: 0 }}>
        Signatures and initials are remembered in this browser only.
      </p>
      {err && <p style={{ color: "red" }}>{err}</p>}
    </div>
  );
}

/* ---------- main page ---------- */
export default function SignPdf() {
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]);
  const [assets, setAssets] = useState(loadStored);
  const [maker, setMaker] = useState(null); // "signature" | "initials" | null
  const [placements, setPlacements] = useState([]);
  const [selected, setSelected] = useState(null);
  const [armed, setArmed] = useState(null); // asset id waiting for a click on a page
  const [textValue, setTextValue] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const drag = useRef(null);
  const counter = useRef(0);
  const fileInput = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(assets.filter((a) => a.kind === "signature" || a.kind === "initials")));
    } catch { /* storage may be blocked */ }
  }, [assets]);

  useEffect(() => {
    const onKey = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        setPlacements((l) => l.filter((p) => p.id !== selected));
        setSelected(null);
      } else if (e.key === "Escape") { setArmed(null); setSelected(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const hFrac = (p) => {
    const pg = pages[p.page - 1];
    return (p.w * (pg.w / pg.h)) / p.ratio;
  };

  const loadPdf = async (f) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf")) return setError("Please choose a PDF file");
    if (f.size > MAX_FILE) return setError("File is larger than 20 MB");
    setError(""); setBusy("Loading pages...");
    try {
      const body = new FormData();
      body.append("file", f);
      const res = await fetch(`${API}/tools/pdf-pages`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Preview failed");
      setFile(f); setPages(data.pages); setPlacements([]); setSelected(null);
      if (!assets.some((a) => a.kind === "signature")) setMaker("signature");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  // ----- assets -----
  const addAsset = (kind, url, ratio) => {
    const a = { id: Math.random().toString(36).slice(2), kind, url, ratio };
    setAssets((l) => {
      const same = l.filter((x) => x.kind === kind).slice(-2); // keep the latest 3 of each kind
      return [...l.filter((x) => x.kind !== kind), ...same, a];
    });
    setArmed(a.id);
  };
  const addText = () => {
    const t = textValue.trim();
    if (!t) return;
    const r = textAsset(t);
    if (r) { addAsset("text", r.url, r.ratio); setTextValue(""); }
  };
  const addDate = () => {
    const d = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const r = textAsset(d);
    if (r) addAsset("date", r.url, r.ratio);
  };

  // ----- placing -----
  const place = (asset, pageIdx, cx, cy) => {
    const pg = pages[pageIdx];
    const w = clamp(TARGET_H[asset.kind] * asset.ratio * (pg.h / pg.w), 0.04, 0.6);
    const h = (w * (pg.w / pg.h)) / asset.ratio;
    const p = {
      id: ++counter.current, url: asset.url, ratio: asset.ratio, page: pageIdx + 1, w,
      x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, Math.max(1 - h, 0)),
    };
    setPlacements((l) => [...l, p]);
    setSelected(p.id);
    setArmed(null);
  };
  const fraction = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  const onPageClick = (e, idx) => {
    const asset = assets.find((a) => a.id === armed);
    if (asset) { const [cx, cy] = fraction(e); place(asset, idx, cx, cy); }
    else setSelected(null);
  };
  const onPageDrop = (e, idx) => {
    e.preventDefault();
    const asset = assets.find((a) => a.id === e.dataTransfer.getData("text/plain"));
    if (asset) { const [cx, cy] = fraction(e); place(asset, idx, cx, cy); }
  };

  // ----- move / resize -----
  const startMove = (e, p) => {
    e.stopPropagation();
    setSelected(p.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = e.currentTarget.parentElement.getBoundingClientRect();
    drag.current = { mode: "move", id: p.id, box,
      dx: (e.clientX - box.left) / box.width - p.x, dy: (e.clientY - box.top) / box.height - p.y };
  };
  const startResize = (e, p, corner) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = e.currentTarget.parentElement.parentElement.getBoundingClientRect();
    drag.current = { mode: "resize", id: p.id, corner, box,
      left: p.x, top: p.y, right: p.x + p.w, bottom: p.y + hFrac(p) };
  };
  const moveDrag = (e) => {
    const d = drag.current;
    if (!d) return;
    const px = (e.clientX - d.box.left) / d.box.width;
    const py = (e.clientY - d.box.top) / d.box.height;
    setPlacements((l) => l.map((p) => {
      if (p.id !== d.id) return p;
      const pg = pages[p.page - 1];
      if (d.mode === "move") {
        const h = (p.w * (pg.w / pg.h)) / p.ratio;
        return { ...p, x: clamp(px - d.dx, 0, 1 - p.w), y: clamp(py - d.dy, 0, Math.max(1 - h, 0)) };
      }
      const isLeft = d.corner.includes("l"), isTop = d.corner.includes("t");
      const w = clamp(isLeft ? d.right - px : px - d.left, 0.04, isLeft ? d.right : 1 - d.left);
      const h = (w * (pg.w / pg.h)) / p.ratio;
      return { ...p, w, x: isLeft ? d.right - w : d.left, y: isTop ? d.bottom - h : d.top };
    }));
  };
  const endDrag = () => (drag.current = null);

  // ----- selected item actions -----
  const removeItem = (id) => { setPlacements((l) => l.filter((p) => p.id !== id)); setSelected(null); };
  const copyItem = (p) => {
    const c = { ...p, id: ++counter.current, x: clamp(p.x + 0.02, 0, 1 - p.w), y: clamp(p.y + 0.02, 0, 0.95) };
    setPlacements((l) => [...l, c]);
    setSelected(c.id);
  };
  const copyToAll = (p) =>
    setPlacements((l) => [
      ...l,
      ...pages.map((_, i) => i + 1).filter((n) => n !== p.page && !l.some((q) => q.page === n && q.url === p.url && q.x === p.x && q.y === p.y))
        .map((n) => ({ ...p, id: ++counter.current, page: n })),
    ]);

  // ----- save -----
  const save = async () => {
    if (!placements.length) return setError("Add your signature to a page first");
    const urls = [...new Set(placements.map((p) => p.url))];
    if (urls.length > 10) return setError("Use at most 10 different items");
    setBusy("Signing your PDF..."); setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      for (let i = 0; i < urls.length; i++)
        body.append("signatures", await (await fetch(urls[i])).blob(), `item${i}.png`);
      body.append("placements", JSON.stringify(placements.map((p) => ({
        img: urls.indexOf(p.url), page: p.page, x: p.x, y: p.y, w: p.w }))));
      const res = await fetch(`${API}/tools/sign-pdf`, { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
      }
      const blob = await res.blob();
      setResult({ url: URL.createObjectURL(blob), name: file.name.replace(/\.[^.]+$/, "") + "_signed.pdf" });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const reset = () => {
    if (result) URL.revokeObjectURL(result.url);
    setFile(null); setPages([]); setPlacements([]); setSelected(null); setArmed(null);
    setResult(null); setError(""); setMaker(null);
  };

  /* ---------- screens ---------- */
  if (result) {
    return (
      <div style={{ textAlign: "center", padding: "30px 0" }}>
        <div style={{ fontSize: 44, color: "#16a34a" }}>✓</div>
        <h2>Your signed PDF is ready</h2>
        <a href={result.url} download={result.name}
          style={{ display: "inline-block", padding: "10px 24px", background: "#4f46e5", color: "#fff", borderRadius: 8, textDecoration: "none" }}>
          Download PDF
        </a>
        <p>
          <button style={btn} onClick={() => setResult(null)}>Keep editing</button>{" "}
          <button style={btn} onClick={reset}>Sign another file</button>
        </p>
        <p style={{ color: "#666", fontSize: 14 }}>Your file is deleted from the server right after processing.</p>
      </div>
    );
  }

  if (!file) {
    return (
      <div>
        <div onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); loadPdf(e.dataTransfer.files[0]); }}
          style={{ border: "2px dashed #b9b9ff", borderRadius: 12, padding: "50px 20px", textAlign: "center", background: "#fafaff" }}>
          <p style={{ fontSize: 18, margin: 0 }}>Drag and drop a PDF here</p>
          <p style={{ color: "#666" }}>Max 20 MB and 30 pages</p>
          <button style={primary} onClick={() => fileInput.current.click()}>Choose PDF file</button>
        </div>
        <input ref={fileInput} type="file" accept=".pdf" hidden
          onChange={(e) => { loadPdf(e.target.files[0]); e.target.value = ""; }} />
        {busy && <p>{busy}</p>}
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>
    );
  }

  const handleStyle = (c) => ({
    position: "absolute", width: 12, height: 12, background: "#fff", border: "2px solid #4f46e5", borderRadius: "50%",
    [c.includes("t") ? "top" : "bottom"]: -7, [c.includes("l") ? "left" : "right"]: -7,
    cursor: c === "tl" || c === "br" ? "nwse-resize" : "nesw-resize", touchAction: "none",
  });

  return (
    <div>
      {maker && (
        <SignatureMaker
          title={maker === "initials" ? "Create your initials" : "Create your signature"}
          onDone={(url, ratio) => { addAsset(maker, url, ratio); setMaker(null); }}
          onCancel={assets.some((a) => a.kind === "signature") ? () => setMaker(null) : null} />
      )}

      {armed && (
        <div style={{ background: "#eef0ff", border: "1px solid #b9b9ff", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          Click on the page where it should go, or drag it from the panel. <button style={btn} onClick={() => setArmed(null)}>Cancel</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 520px", minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
            {pages.map((pg, idx) => (
              <div key={idx} style={{ width: "100%", maxWidth: 720 }}>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Page {idx + 1} of {pages.length}</div>
                <div
                  onClick={(e) => onPageClick(e, idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onPageDrop(e, idx)}
                  style={{ position: "relative", boxShadow: "0 1px 6px rgba(0,0,0,.3)", cursor: armed ? "crosshair" : "default" }}>
                  <img src={`data:image/jpeg;base64,${pg.img}`} alt={`Page ${idx + 1}`} draggable={false}
                    style={{ width: "100%", display: "block", userSelect: "none" }} />
                  {placements.filter((p) => p.page === idx + 1).map((p) => {
                    const sel = selected === p.id;
                    return (
                      <div key={p.id}
                        onPointerDown={(e) => startMove(e, p)} onPointerMove={moveDrag} onPointerUp={endDrag}
                        onClick={(e) => e.stopPropagation()}
                        style={{ position: "absolute", left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.w * 100}%`,
                          outline: sel ? "2px solid #4f46e5" : "1px dashed #9aa0b5", cursor: "move", touchAction: "none" }}>
                        <img src={p.url} alt="" draggable={false} style={{ width: "100%", display: "block", pointerEvents: "none" }} />
                        {sel && (
                          <>
                            {["tl", "tr", "bl", "br"].map((c) => (
                              <div key={c} onPointerDown={(e) => startResize(e, p, c)} style={handleStyle(c)} />
                            ))}
                            <div onPointerDown={(e) => e.stopPropagation()}
                              style={{ position: "absolute", top: -38, left: 0, display: "flex", gap: 4, background: "#fff",
                                border: "1px solid #ccc", borderRadius: 6, padding: 3, whiteSpace: "nowrap", boxShadow: "0 2px 6px rgba(0,0,0,.15)" }}>
                              <button style={{ ...btn, padding: "2px 8px" }} title="Duplicate" onClick={() => copyItem(p)}>⧉</button>
                              {pages.length > 1 && (
                                <button style={{ ...btn, padding: "2px 8px" }} onClick={() => copyToAll(p)}>All pages</button>
                              )}
                              <button style={{ ...btn, padding: "2px 8px" }} title="Delete" onClick={() => removeItem(p.id)}>✕</button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside style={{ flex: "0 0 250px", position: "sticky", top: 10, border: "1px solid #e2e2e8", borderRadius: 12, padding: 12, background: "#fff" }}>
          <b>Fill & sign</b>
          <p style={{ color: "#666", fontSize: 13, margin: "6px 0 10px" }}>
            Click an item, then click the page. You can also drag it onto the page.
          </p>

          {assets.map((a) => (
            <div key={a.id} draggable
              onDragStart={(e) => { e.dataTransfer.setData("text/plain", a.id); e.dataTransfer.effectAllowed = "copy"; }}
              onClick={() => setArmed(armed === a.id ? null : a.id)}
              style={{ position: "relative", border: armed === a.id ? "2px solid #4f46e5" : "1px solid #ddd", borderRadius: 8,
                padding: 8, marginBottom: 8, cursor: "pointer", background: armed === a.id ? "#eef0ff" : "#fff" }}>
              <div style={{ fontSize: 11, color: "#888", textTransform: "capitalize" }}>{a.kind}</div>
              <img src={a.url} alt={a.kind} draggable={false} style={{ maxWidth: 170, maxHeight: 44, display: "block" }} />
              <button title="Remove from list" style={{ position: "absolute", top: 4, right: 4, border: "none", background: "none", cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); setAssets((l) => l.filter((x) => x.id !== a.id)); if (armed === a.id) setArmed(null); }}>
                ✕
              </button>
            </div>
          ))}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            <button style={btn} onClick={() => setMaker("signature")}>+ Signature</button>
            <button style={btn} onClick={() => setMaker("initials")}>+ Initials</button>
            <button style={btn} onClick={addDate}>+ Date</button>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <input value={textValue} maxLength={60} placeholder="Name, address..." style={{ flex: 1, minWidth: 0 }}
              onChange={(e) => setTextValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addText()} />
            <button style={btn} onClick={addText}>Add</button>
          </div>

          <hr style={{ margin: "14px 0", border: "none", borderTop: "1px solid #eee" }} />
          <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>{placements.length} item(s) on the document</div>
          <button style={{ ...primary, width: "100%" }} onClick={save} disabled={!!busy || !placements.length}>
            {busy || "Sign & Download"}
          </button>
          <button style={{ ...btn, width: "100%", marginTop: 8 }} onClick={reset}>Start over</button>
          {error && <p style={{ color: "red", fontSize: 14 }}>{error}</p>}
        </aside>
      </div>
    </div>
  );
}