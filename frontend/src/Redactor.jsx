import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const MAX_FILE = 20 * 1024 * 1024;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

const btn = { padding: "6px 12px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer" };
const primary = { ...btn, background: "#4f46e5", color: "#fff", border: "none", padding: "9px 22px", borderRadius: 8 };

const PATTERNS = [
  { key: "email", label: "Email addresses" },
  { key: "phone", label: "Phone numbers" },
  { key: "url", label: "Web links" },
  { key: "card", label: "Card numbers" },
];

export default function Redactor() {
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [draft, setDraft] = useState(null);
  const [selected, setSelected] = useState(null);
  const [drawMode, setDrawMode] = useState(true);
  const [terms, setTerms] = useState("");
  const [patterns, setPatterns] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const counter = useRef(0);
  const fileInput = useRef(null);
  const drawing = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        setBoxes((l) => l.filter((b) => b.id !== selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

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
      setFile(f); setPages(data.pages); setBoxes([]); setSelected(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const frac = (e, el) => {
    const r = el.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
  };
  const down = (e, idx) => {
    if (!drawMode) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = frac(e, e.currentTarget);
    drawing.current = { page: idx + 1, x0: x, y0: y };
    setDraft({ page: idx + 1, x, y, w: 0, h: 0 });
    setSelected(null);
  };
  const move = (e) => {
    const d = drawing.current;
    if (!d) return;
    const [x, y] = frac(e, e.currentTarget);
    setDraft({ page: d.page, x: Math.min(d.x0, x), y: Math.min(d.y0, y), w: Math.abs(x - d.x0), h: Math.abs(y - d.y0) });
  };
  const up = () => {
    if (drawing.current && draft && draft.w > 0.005 && draft.h > 0.003) {
      const b = { ...draft, id: ++counter.current };
      setBoxes((l) => [...l, b]);
      setSelected(b.id);
    }
    drawing.current = null;
    setDraft(null);
  };

  const apply = async () => {
    const keys = Object.keys(patterns).filter((k) => patterns[k]);
    if (!boxes.length && !terms.trim() && !keys.length)
      return setError("Draw a box, add a search term or choose a pattern first");
    setBusy("Redacting..."); setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("terms", terms);
      body.append("patterns", keys.join(","));
      body.append("boxes", JSON.stringify(boxes.map(({ page, x, y, w, h }) => ({ page, x, y, w, h }))));
      const res = await fetch(`${API}/tools/redact-pdf`, { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
      }
      const blob = await res.blob();
      setResult({ url: URL.createObjectURL(blob), name: file.name.replace(/\.[^.]+$/, "") + "_redacted.pdf" });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const reset = () => {
    if (result) URL.revokeObjectURL(result.url);
    setFile(null); setPages([]); setBoxes([]); setSelected(null); setTerms("");
    setPatterns({}); setResult(null); setError("");
  };

  if (result) {
    return (
      <div style={{ textAlign: "center", padding: "30px 0" }}>
        <div style={{ fontSize: 44, color: "#16a34a" }}>✓</div>
        <h2>Your redacted PDF is ready</h2>
        <a href={result.url} download={result.name}
          style={{ display: "inline-block", padding: "10px 24px", background: "#4f46e5", color: "#fff", borderRadius: 8, textDecoration: "none" }}>
          Download PDF
        </a>
        <p>
          <button style={btn} onClick={() => setResult(null)}>Keep editing</button>{" "}
          <button style={btn} onClick={reset}>Redact another file</button>
        </p>
        <p style={{ color: "#666", fontSize: 14, maxWidth: 460, margin: "0 auto" }}>
          Open the result and check it before sharing: try to select and search for the removed text.
          Redaction is permanent in the new file, and your original is not changed.
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

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
        {pages.map((pg, idx) => (
          <div key={idx} style={{ width: "100%", maxWidth: 720 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Page {idx + 1} of {pages.length}</div>
            <div
              onPointerDown={(e) => down(e, idx)} onPointerMove={move} onPointerUp={up}
              style={{ position: "relative", boxShadow: "0 1px 6px rgba(0,0,0,.3)",
                cursor: drawMode ? "crosshair" : "default", touchAction: drawMode ? "none" : "auto" }}>
              <img src={`data:image/jpeg;base64,${pg.img}`} alt={`Page ${idx + 1}`} draggable={false}
                style={{ width: "100%", display: "block", userSelect: "none", pointerEvents: "none" }} />
              {[...boxes.filter((b) => b.page === idx + 1), ...(draft && draft.page === idx + 1 ? [{ ...draft, id: "draft" }] : [])].map((b) => (
                <div key={b.id}
                  onPointerDown={(e) => { if (b.id !== "draft") { e.stopPropagation(); setSelected(b.id); } }}
                  style={{ position: "absolute", left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`,
                    background: "rgba(0,0,0,.55)", border: `2px solid ${selected === b.id ? "#4f46e5" : "#e11d48"}` }}>
                  {selected === b.id && (
                    <button onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => { setBoxes((l) => l.filter((x) => x.id !== b.id)); setSelected(null); }}
                      style={{ position: "absolute", top: -26, right: 0, ...btn, padding: "1px 8px" }}>✕ Remove</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <aside style={{ flex: "0 0 270px", position: "sticky", top: 10, border: "1px solid #e2e2e8", borderRadius: 12, padding: 14, background: "#fff" }}>
        <b>Redact</b>
        <p style={{ color: "#666", fontSize: 13, margin: "6px 0 10px" }}>
          Drag on a page to draw a box. Black boxes show what will be removed for good.
        </p>

        <label style={{ display: "block", marginBottom: 12 }}>
          <input type="checkbox" checked={drawMode} onChange={(e) => setDrawMode(e.target.checked)} /> Draw mode
          <span style={{ color: "#888", fontSize: 12 }}> (turn off to scroll on touch screens)</span>
        </label>

        <div style={{ fontSize: 13, marginBottom: 4 }}>Search words or phrases (one per line)</div>
        <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={4}
          placeholder={"John Smith\n123 Main Street"} style={{ width: "100%", boxSizing: "border-box" }} />

        <div style={{ fontSize: 13, margin: "12px 0 4px" }}>Find automatically</div>
        {PATTERNS.map((p) => (
          <label key={p.key} style={{ display: "block", fontSize: 14 }}>
            <input type="checkbox" checked={!!patterns[p.key]}
              onChange={(e) => setPatterns({ ...patterns, [p.key]: e.target.checked })} /> {p.label}
          </label>
        ))}
        <p style={{ color: "#888", fontSize: 12 }}>Patterns are approximate. Always check the result.</p>

        <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #eee" }} />
        <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>{boxes.length} box(es) drawn</div>
        <button style={{ ...primary, width: "100%" }} onClick={apply} disabled={!!busy}>
          {busy || "Redact & Download"}
        </button>
        <button style={{ ...btn, width: "100%", marginTop: 8 }} onClick={reset}>Start over</button>
        {error && <p style={{ color: "red", fontSize: 14 }}>{error}</p>}
      </aside>
    </div>
  );
}