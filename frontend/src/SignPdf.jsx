import { useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const MAX_FILE = 20 * 1024 * 1024;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const FONTS = [
  "'Brush Script MT', cursive",
  "'Segoe Script', cursive",
  "'Lucida Handwriting', cursive",
  "cursive",
];

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

/* ---------- signature maker: draw / type / upload ---------- */
function SignatureMaker({ onDone, onCancel }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [tab, setTab] = useState("draw");
  const [color, setColor] = useState("#111827");
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
    ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = color;
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
    let size = 90;
    ctx.font = `${size}px ${f}`;
    while (size > 20 && ctx.measureText(t).width > c.width - 40) {
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
    if (!t) return setErr("Draw, type or upload your signature first");
    onDone(t.toDataURL("image/png"), t.width / t.height);
  };

  const tabBtn = (id, label) => (
    <button key={id} onClick={() => switchTab(id)}
      style={{ padding: "6px 14px", border: "1px solid #ccc", cursor: "pointer",
        background: tab === id ? "#4f46e5" : "#fff", color: tab === id ? "#fff" : "#222" }}>
      {label}
    </button>
  );

  return (
    <div style={{ border: "1px solid #e2e2e8", borderRadius: 12, padding: 16, background: "#fff", maxWidth: 600 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {tabBtn("draw", "Draw")}{tabBtn("type", "Type")}{tabBtn("upload", "Upload image")}
      </div>

      <canvas ref={canvasRef} width={560} height={200}
        onPointerDown={down} onPointerMove={move}
        onPointerUp={() => (drawing.current = false)}
        style={{ width: "100%", maxWidth: 560, border: "1px dashed #aaa", borderRadius: 8, background: "#fff",
          touchAction: "none", cursor: tab === "draw" ? "crosshair" : "default" }} />

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {tab !== "upload" && (
          <label>Colour{" "}
            <input type="color" value={color}
              onChange={(e) => { setColor(e.target.value); if (tab === "type") renderText(text, font, e.target.value); }} />
          </label>
        )}
        {tab === "draw" && <button onClick={clear}>Clear</button>}
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
        <button onClick={use}
          style={{ padding: "8px 20px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
          Use this signature
        </button>
        {onCancel && <button onClick={onCancel}>Cancel</button>}
      </div>
      {err && <p style={{ color: "red" }}>{err}</p>}
    </div>
  );
}

/* ---------- main page ---------- */
export default function SignPdf() {
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]);
  const [sig, setSig] = useState(null); // { url, ratio }
  const [making, setMaking] = useState(false);
  const [placements, setPlacements] = useState([]);
  const [placing, setPlacing] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const drag = useRef(null);
  const counter = useRef(0);
  const fileInput = useRef(null);

  const hFrac = (p) => {
    const pg = pages[p.page - 1];
    return p.w * (pg.w / pg.h) / sig.ratio;
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
      setFile(f); setPages(data.pages); setPlacements([]);
      if (!sig) setMaking(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const onPageClick = (e, idx) => {
    if (!placing || !sig) return;
    const box = e.currentTarget.getBoundingClientRect();
    const w = 0.25;
    const pg = pages[idx];
    const h = w * (pg.w / pg.h) / sig.ratio;
    setPlacements((l) => [...l, {
      id: ++counter.current, page: idx + 1, w,
      x: clamp((e.clientX - box.left) / box.width - w / 2, 0, 1 - w),
      y: clamp((e.clientY - box.top) / box.height - h / 2, 0, Math.max(1 - h, 0)),
    }]);
    setPlacing(false);
  };

  const startDrag = (e, p) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = e.currentTarget.parentElement.getBoundingClientRect();
    drag.current = { id: p.id, box,
      dx: (e.clientX - box.left) / box.width - p.x, dy: (e.clientY - box.top) / box.height - p.y };
  };
  const moveDrag = (e) => {
    const d = drag.current;
    if (!d) return;
    setPlacements((l) => l.map((p) => p.id !== d.id ? p : {
      ...p,
      x: clamp((e.clientX - d.box.left) / d.box.width - d.dx, 0, 1 - p.w),
      y: clamp((e.clientY - d.box.top) / d.box.height - d.dy, 0, Math.max(1 - hFrac(p), 0)),
    }));
  };
  const resize = (id, delta) =>
    setPlacements((l) => l.map((p) => p.id !== id ? p : { ...p, w: clamp(p.w + delta, 0.05, 0.9) }));
  const remove = (id) => setPlacements((l) => l.filter((p) => p.id !== id));
  const copyToAll = () => {
    const last = placements[placements.length - 1];
    if (!last) return;
    setPlacements((l) => [
      ...l,
      ...pages.map((_, i) => i + 1).filter((n) => n !== last.page)
        .map((n) => ({ ...last, id: ++counter.current, page: n })),
    ]);
  };

  const save = async () => {
    if (!placements.length) return setError("Click a page to place your signature first");
    setBusy("Signing your PDF..."); setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("signature", await (await fetch(sig.url)).blob(), "signature.png");
      body.append("placements", JSON.stringify(placements.map(({ page, x, y, w }) => ({ page, x, y, w }))));
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
    setFile(null); setPages([]); setPlacements([]); setResult(null); setError(""); setPlacing(false);
  };

  const small = { width: 24, height: 24, cursor: "pointer", borderRadius: 4, border: "1px solid #aaa", background: "#fff", padding: 0 };

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
          <button onClick={() => setResult(null)}>Keep editing</button>{" "}
          <button onClick={reset}>Sign another file</button>
        </p>
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
          <button onClick={() => fileInput.current.click()}
            style={{ background: "#4f46e5", color: "#fff", border: "none", padding: "10px 22px", borderRadius: 8, cursor: "pointer" }}>
            Choose PDF file
          </button>
        </div>
        <input ref={fileInput} type="file" accept=".pdf" hidden
          onChange={(e) => { loadPdf(e.target.files[0]); e.target.value = ""; }} />
        {busy && <p>{busy}</p>}
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <button onClick={() => setMaking(true)}>{sig ? "Change signature" : "Create signature"}</button>
        <button disabled={!sig} onClick={() => setPlacing(true)}
          style={{ background: placing ? "#4f46e5" : "#fff", color: placing ? "#fff" : "#222" }}>
          {placing ? "Now click on a page..." : "Place signature"}
        </button>
        <button disabled={!placements.length || pages.length < 2} onClick={copyToAll}>Copy last to all pages</button>
        <button onClick={reset}>Start over</button>
        <span style={{ color: "#666", fontSize: 14 }}>{placements.length} signature(s) placed</span>
      </div>

      {making && (
        <div style={{ marginBottom: 14 }}>
          <SignatureMaker
            onDone={(url, ratio) => { setSig({ url, ratio }); setMaking(false); setPlacing(true); }}
            onCancel={sig ? () => setMaking(false) : null} />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
        {pages.map((pg, idx) => (
          <div key={idx} style={{ width: "100%", maxWidth: 720 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Page {idx + 1}</div>
            <div onClick={(e) => onPageClick(e, idx)}
              style={{ position: "relative", boxShadow: "0 1px 6px rgba(0,0,0,.3)", cursor: placing ? "crosshair" : "default" }}>
              <img src={`data:image/jpeg;base64,${pg.img}`} alt={`Page ${idx + 1}`} draggable={false}
                style={{ width: "100%", display: "block", userSelect: "none" }} />
              {placements.filter((p) => p.page === idx + 1).map((p) => (
                <div key={p.id}
                  onPointerDown={(e) => startDrag(e, p)} onPointerMove={moveDrag}
                  onPointerUp={() => (drag.current = null)} onClick={(e) => e.stopPropagation()}
                  style={{ position: "absolute", left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.w * 100}%`,
                    border: "1px dashed #4f46e5", cursor: "move", touchAction: "none" }}>
                  <img src={sig.url} alt="signature" draggable={false} style={{ width: "100%", display: "block" }} />
                  <div onPointerDown={(e) => e.stopPropagation()}
                    style={{ position: "absolute", top: -28, right: 0, display: "flex", gap: 4 }}>
                    <button style={small} onClick={() => resize(p.id, -0.03)} title="Smaller">−</button>
                    <button style={small} onClick={() => resize(p.id, 0.03)} title="Larger">+</button>
                    <button style={small} onClick={() => remove(p.id)} title="Remove">✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button onClick={save} disabled={!!busy || !placements.length}
        style={{ display: "block", margin: "20px auto 0", padding: "10px 26px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
        {busy || "Sign & Download"}
      </button>
      {error && <p style={{ color: "red", textAlign: "center" }}>{error}</p>}
    </div>
  );
}