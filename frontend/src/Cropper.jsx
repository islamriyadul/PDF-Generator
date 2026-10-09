import { useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const MAX_FILE = 20 * 1024 * 1024;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

const btn = { padding: "6px 12px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer" };
const primary = { ...btn, background: "#4f46e5", color: "#fff", border: "none", padding: "9px 22px", borderRadius: 8 };

export default function Cropper() {
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]);
  const [idx, setIdx] = useState(0);
  const [box, setBox] = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [scope, setScope] = useState("all");
  const [range, setRange] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const drag = useRef(null);
  const fileInput = useRef(null);

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
      setFile(f); setPages(data.pages); setIdx(0);
      setBox({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const point = (e, rect) => [
    clamp((e.clientX - rect.left) / rect.width, 0, 1),
    clamp((e.clientY - rect.top) / rect.height, 0, 1),
  ];

  const startNew = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const [x0, y0] = point(e, rect);
    drag.current = { mode: "new", rect, x0, y0 };
  };
  const startDrag = (e, mode) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.closest("[data-crop]").getBoundingClientRect();
    const [px, py] = point(e, rect);
    drag.current = { mode, rect, px, py, start: { ...box } };
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const [px, py] = point(e, d.rect);
    if (d.mode === "new") {
      const w = Math.abs(px - d.x0), h = Math.abs(py - d.y0);
      if (w > 0.02 && h > 0.02) setBox({ x: Math.min(d.x0, px), y: Math.min(d.y0, py), w, h });
      return;
    }
    const s = d.start;
    const dx = px - d.px, dy = py - d.py;
    if (d.mode === "move") {
      setBox({ ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) });
      return;
    }
    let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
    if (d.mode.includes("l")) x0 = clamp(s.x + dx, 0, x1 - 0.05);
    if (d.mode.includes("r")) x1 = clamp(s.x + s.w + dx, x0 + 0.05, 1);
    if (d.mode.includes("t")) y0 = clamp(s.y + dy, 0, y1 - 0.05);
    if (d.mode.includes("b")) y1 = clamp(s.y + s.h + dy, y0 + 0.05, 1);
    setBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  };
  const endDrag = () => (drag.current = null);

  const save = async () => {
    let spec = "";
    if (scope === "current") spec = String(idx + 1);
    if (scope === "range") {
      if (!range.trim()) return setError("Enter pages like 1-3,5");
      spec = range.trim();
    }
    setBusy("Cropping..."); setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("box", JSON.stringify(box));
      body.append("pages", spec);
      const res = await fetch(`${API}/tools/crop-pdf`, { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
      }
      const blob = await res.blob();
      setResult({ url: URL.createObjectURL(blob), name: file.name.replace(/\.[^.]+$/, "") + "_cropped.pdf" });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const reset = () => {
    if (result) URL.revokeObjectURL(result.url);
    setFile(null); setPages([]); setResult(null); setError(""); setScope("all"); setRange("");
  };

  if (result) {
    return (
      <div style={{ textAlign: "center", padding: "30px 0" }}>
        <div style={{ fontSize: 44, color: "#16a34a" }}>✓</div>
        <h2>Your cropped PDF is ready</h2>
        <a href={result.url} download={result.name}
          style={{ display: "inline-block", padding: "10px 24px", background: "#4f46e5", color: "#fff", borderRadius: 8, textDecoration: "none" }}>
          Download PDF
        </a>
        <p>
          <button style={btn} onClick={() => setResult(null)}>Keep editing</button>{" "}
          <button style={btn} onClick={reset}>Crop another file</button>
        </p>
        <p style={{ color: "#666", fontSize: 14, maxWidth: 460, margin: "0 auto" }}>
          Cropping hides the outside area but doesn't delete it. For sensitive content, use Redact PDF.
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
          <button style={primary} onClick={() => fileInput.current.click()}>Choose PDF file</button>
        </div>
        <input ref={fileInput} type="file" accept=".pdf" hidden
          onChange={(e) => { loadPdf(e.target.files[0]); e.target.value = ""; }} />
        {busy && <p>{busy}</p>}
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>
    );
  }

  const pg = pages[idx];
  const handle = (c) => ({
    position: "absolute", width: 14, height: 14, background: "#fff", border: "2px solid #4f46e5", borderRadius: 3,
    [c.includes("t") ? "top" : "bottom"]: -8, [c.includes("l") ? "left" : "right"]: -8,
    cursor: c === "tl" || c === "br" ? "nwse-resize" : "nesw-resize", touchAction: "none",
  });

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 480px", minWidth: 0, maxWidth: 720 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <button style={btn} disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← Prev</button>
          <span>Page {idx + 1} of {pages.length}</span>
          <button style={btn} disabled={idx === pages.length - 1} onClick={() => setIdx(idx + 1)}>Next →</button>
        </div>
        <div data-crop onPointerDown={startNew} onPointerMove={onMove} onPointerUp={endDrag}
          style={{ position: "relative", overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,.3)",
            cursor: "crosshair", touchAction: "none", userSelect: "none" }}>
          <img src={`data:image/jpeg;base64,${pg.img}`} alt={`Page ${idx + 1}`} draggable={false}
            style={{ width: "100%", display: "block", pointerEvents: "none" }} />
          <div onPointerDown={(e) => startDrag(e, "move")} onPointerMove={onMove} onPointerUp={endDrag}
            style={{ position: "absolute", left: `${box.x * 100}%`, top: `${box.y * 100}%`,
              width: `${box.w * 100}%`, height: `${box.h * 100}%`, boxSizing: "border-box",
              border: "2px solid #4f46e5", boxShadow: "0 0 0 9999px rgba(0,0,0,.5)", cursor: "move" }}>
            {["tl", "tr", "bl", "br"].map((c) => (
              <div key={c} onPointerDown={(e) => startDrag(e, c)} onPointerMove={onMove} onPointerUp={endDrag}
                style={handle(c)} />
            ))}
          </div>
        </div>
      </div>

      <aside style={{ flex: "0 0 250px", position: "sticky", top: 10, border: "1px solid #e2e2e8", borderRadius: 12, padding: 14, background: "#fff" }}>
        <b>Crop</b>
        <p style={{ color: "#666", fontSize: 13, margin: "6px 0 10px" }}>
          Drag the corners to resize, drag inside to move, or drag on the page to draw a new area.
        </p>
        <div style={{ fontSize: 13, marginBottom: 4 }}>Apply to</div>
        {[["all", "All pages (same area)"], ["current", `This page only (${idx + 1})`], ["range", "A page range"]].map(([v, l]) => (
          <label key={v} style={{ display: "block", fontSize: 14 }}>
            <input type="radio" name="scope" checked={scope === v} onChange={() => setScope(v)} /> {l}
          </label>
        ))}
        {scope === "range" && (
          <input value={range} onChange={(e) => setRange(e.target.value)} placeholder="e.g. 1-3,5"
            style={{ width: "100%", boxSizing: "border-box", marginTop: 6 }} />
        )}
        <button style={{ ...btn, width: "100%", marginTop: 10 }}
          onClick={() => setBox({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })}>Reset area</button>
        <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #eee" }} />
        <button style={{ ...primary, width: "100%" }} onClick={save} disabled={!!busy}>
          {busy || "Crop & Download"}
        </button>
        <button style={{ ...btn, width: "100%", marginTop: 8 }} onClick={reset}>Start over</button>
        <p style={{ color: "#888", fontSize: 12 }}>
          "All pages" uses the same relative area on each page, so pages of different sizes are cropped proportionally.
        </p>
        {error && <p style={{ color: "red", fontSize: 14 }}>{error}</p>}
      </aside>
    </div>
  );
}