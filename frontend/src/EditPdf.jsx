import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const MAX_FILE = 20 * 1024 * 1024;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

const btn = { padding: "6px 12px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer" };
const primary = { ...btn, background: "#4f46e5", color: "#fff", border: "none", padding: "9px 22px", borderRadius: 8 };

const TOOLS = [
  ["select", "Select"], ["text", "Add text"], ["edit", "Edit text"], ["whiteout", "Whiteout"],
  ["highlight", "Highlight"], ["rect", "Rectangle"], ["ellipse", "Ellipse"], ["line", "Line"], ["draw", "Draw"],
];
const HINTS = {
  select: "Click an item to select it. Drag to move, use the corner handle to resize, Delete removes it.",
  text: "Drag on a page to draw a text box, then type.",
  edit: "Click a line of text on the page to change it.",
  whiteout: "Drag to permanently remove whatever is under the box.",
  highlight: "Drag to highlight an area.",
  rect: "Drag to draw a rectangle.",
  ellipse: "Drag to draw an ellipse.",
  line: "Drag to draw a line.",
  draw: "Draw freehand on the page.",
};
const BOX_TYPES = ["text", "replace", "whiteout", "highlight", "rect", "ellipse"];
const SHAPES = ["rect", "ellipse", "line", "draw"];

const FAMS = {
  sans: ["helv", "hebo", "heit", "hebi"],
  serif: ["tiro", "tibo", "tiit", "tibi"],
  mono: ["cour", "cobo", "coit", "cobi"],
};
const fontCode = (fam, bold, italic) => FAMS[fam][(bold ? 1 : 0) + (italic ? 2 : 0)];
const parseFont = (code) => {
  for (const [fam, list] of Object.entries(FAMS)) {
    const i = list.indexOf(code);
    if (i >= 0) return { fam, bold: !!(i & 1), italic: !!(i & 2) };
  }
  return { fam: "sans", bold: false, italic: false };
};
const cssFont = (code) => {
  const { fam, bold, italic } = parseFont(code);
  return {
    fontFamily: fam === "serif" ? "'Times New Roman', serif" : fam === "mono" ? "'Courier New', monospace" : "Arial, Helvetica, sans-serif",
    fontWeight: bold ? 700 : 400,
    fontStyle: italic ? "italic" : "normal",
  };
};
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const css = `
.ep-line { position: absolute; cursor: text; outline: 1px dashed rgba(79,70,229,.45); }
.ep-line:hover { background: rgba(79,70,229,.18); }
`;

export default function EditPdf() {
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]);
  const [items, setItems] = useState([]);
  const [past, setPast] = useState([]);
  const [tool, setTool] = useState("select");
  const [style, setStyle] = useState({ color: "#111827", size: 14, sw: 2, fill: false, fam: "sans", bold: false, italic: false });
  const [selected, setSelected] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const counter = useRef(0);
  const creating = useRef(null);
  const drag = useRef(null);
  const fileInput = useRef(null);

  const push = () => setPast((p) => [...p.slice(-29), items]);
  const undo = () => {
    if (!past.length) return;
    setItems(past[past.length - 1]);
    setPast(past.slice(0, -1));
    setSelected(null);
  };
  const patch = (id, ch) => setItems((l) => l.map((i) => (i.id === id ? { ...i, ...ch } : i)));
  const remove = (id) => { push(); setItems((l) => l.filter((i) => i.id !== id)); setSelected(null); };

  useEffect(() => {
    const onKey = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); remove(selected); }
      else if (e.key === "Escape") setSelected(null);
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const loadPdf = async (f) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf")) return setError("Please choose a PDF file");
    if (f.size > MAX_FILE) return setError("File is larger than 20 MB");
    setError(""); setBusy("Loading pages...");
    try {
      const body = new FormData();
      body.append("file", f);
      const res = await fetch(`${API}/tools/pdf-edit-info`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Preview failed");
      setFile(f); setPages(data.pages); setItems([]); setPast([]); setSelected(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const selectTool = (t) => {
    setTool(t);
    setSelected(null);
    if (t === "highlight") setStyle((s) => ({ ...s, color: "#ffe600" }));
    else if (tool === "highlight") setStyle((s) => ({ ...s, color: "#111827" }));
  };

  // when an item is selected, show its settings in the toolbar
  const choose = (it) => {
    setSelected(it.id);
    if (it.type === "text" || it.type === "replace") {
      setStyle((s) => ({ ...s, color: it.color, size: Math.round(it.size * 10) / 10, ...parseFont(it.font) }));
    } else if (it.color) {
      setStyle((s) => ({ ...s, color: it.color, sw: it.sw ?? s.sw, fill: it.fill ?? s.fill }));
    }
  };

  const changeStyle = (ch) => {
    const next = { ...style, ...ch };
    setStyle(next);
    const it = items.find((i) => i.id === selected);
    if (!it) return;
    const p = {};
    if (it.type === "text" || it.type === "replace") Object.assign(p, { color: next.color, size: next.size, font: fontCode(next.fam, next.bold, next.italic) });
    else if (it.type === "highlight") p.color = next.color;
    else if (SHAPES.includes(it.type)) Object.assign(p, { color: next.color, sw: next.sw, fill: next.fill });
    if (Object.keys(p).length) patch(it.id, p);
  };

  // ---------- creating items ----------
  const frac = (e, el) => {
    const r = el.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
  };
  const makeDraft = (page, x, y) => {
    const common = { id: "draft", page, color: style.color, sw: style.sw };
    if (tool === "draw") return { ...common, type: "draw", pts: [[x, y]] };
    if (tool === "line") return { ...common, type: "line", x1: x, y1: y, x2: x, y2: y };
    return { ...common, type: tool, x, y, w: 0, h: 0, size: style.size,
      font: fontCode(style.fam, style.bold, style.italic), text: "", fill: style.fill };
  };
  const onPageDown = (e, pi) => {
    if (tool === "select" || tool === "edit") {
      if (tool === "select") setSelected(null);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = frac(e, e.currentTarget);
    creating.current = { x0: x, y0: y };
    setDraft(makeDraft(pi + 1, x, y));
    setSelected(null);
  };
  const onPageMove = (e) => {
    const c = creating.current;
    if (!c) return;
    const [x, y] = frac(e, e.currentTarget);
    setDraft((d) => {
      if (!d) return d;
      if (d.type === "draw") {
        const last = d.pts[d.pts.length - 1];
        if (Math.hypot(x - last[0], y - last[1]) < 0.002) return d;
        return { ...d, pts: [...d.pts, [x, y]] };
      }
      if (d.type === "line") return { ...d, x2: x, y2: y };
      return { ...d, x: Math.min(c.x0, x), y: Math.min(c.y0, y), w: Math.abs(x - c.x0), h: Math.abs(y - c.y0) };
    });
  };
  const onPageUp = () => {
    if (!creating.current) return;
    creating.current = null;
    const d = draft;
    setDraft(null);
    if (!d) return;
    let item = null;
    if (d.type === "draw") {
      if (d.pts.length > 2) item = { ...d, id: ++counter.current };
    } else if (d.type === "line") {
      if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.01) item = { ...d, id: ++counter.current };
    } else {
      const pg = pages[d.page - 1];
      let b = { ...d };
      if (b.type === "text" && (b.w < 0.02 || b.h < 0.01)) {
        b.w = Math.min(0.3, 1 - b.x);
        b.h = Math.min((style.size * 2.2) / pg.h, 1 - b.y);
      }
      if (b.w > 0.01 && b.h > 0.005) item = { ...b, id: ++counter.current };
    }
    if (!item) return;
    push();
    setItems((l) => [...l, item]);
    setSelected(item.id);
    if (item.type === "text") { setFocusId(item.id); setTool("select"); }
  };

  const editLine = (pi, ln, key) => {
    push();
    const it = { id: ++counter.current, type: "replace", lineKey: key, orig: ln.text, page: pi + 1,
      x: ln.x, y: ln.y, w: ln.w, h: ln.h, ox: ln.ox, oy: ln.oy,
      text: ln.text, size: ln.size, color: ln.color, font: ln.font };
    setItems((l) => [...l, it]);
    choose(it);
    setFocusId(it.id);
  };

  // ---------- move / resize ----------
  const startMove = (e, it) => {
    if (tool !== "select") return;
    e.stopPropagation();
    choose(it);
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = e.currentTarget.closest("[data-page]").getBoundingClientRect();
    drag.current = { mode: "move", id: it.id, box, w: it.w, h: it.h, pushed: false,
      dx: (e.clientX - box.left) / box.width - it.x, dy: (e.clientY - box.top) / box.height - it.y };
  };
  const startResize = (e, it) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = e.currentTarget.closest("[data-page]").getBoundingClientRect();
    drag.current = { mode: "resize", id: it.id, box, x: it.x, y: it.y, pushed: false };
  };
  const moveDrag = (e) => {
    const d = drag.current;
    if (!d) return;
    if (!d.pushed) { push(); d.pushed = true; }
    const px = (e.clientX - d.box.left) / d.box.width;
    const py = (e.clientY - d.box.top) / d.box.height;
    if (d.mode === "move") patch(d.id, { x: clamp(px - d.dx, 0, 1 - d.w), y: clamp(py - d.dy, 0, 1 - d.h) });
    else patch(d.id, { w: clamp(px - d.x, 0.02, 1 - d.x), h: clamp(py - d.y, 0.01, 1 - d.y) });
  };
  const endDrag = () => (drag.current = null);

  // ---------- save ----------
  const save = async () => {
    const ops = [];
    for (const i of items) {
      const base = { type: i.type, page: i.page };
      if (i.type === "text") {
        if (i.text.trim()) ops.push({ ...base, x: i.x, y: i.y, w: i.w, h: i.h, text: i.text, size: i.size, color: i.color, font: i.font });
      } else if (i.type === "replace") {
        if (i.text !== i.orig) ops.push({ ...base, x: i.x, y: i.y, w: i.w, h: i.h, ox: i.ox, oy: i.oy, text: i.text, size: i.size, color: i.color, font: i.font });
      } else if (i.type === "whiteout") ops.push({ ...base, x: i.x, y: i.y, w: i.w, h: i.h });
      else if (i.type === "highlight") ops.push({ ...base, x: i.x, y: i.y, w: i.w, h: i.h, color: i.color });
      else if (i.type === "rect" || i.type === "ellipse") ops.push({ ...base, x: i.x, y: i.y, w: i.w, h: i.h, color: i.color, sw: i.sw, fill: !!i.fill });
      else if (i.type === "line") ops.push({ ...base, x1: i.x1, y1: i.y1, x2: i.x2, y2: i.y2, color: i.color, sw: i.sw });
      else if (i.type === "draw") ops.push({ ...base, pts: i.pts, color: i.color, sw: i.sw });
    }
    if (!ops.length) return setError("Make a change first");
    setBusy("Applying your changes..."); setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("ops", JSON.stringify(ops));
      const res = await fetch(`${API}/tools/edit-pdf`, { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
      }
      const blob = await res.blob();
      setResult({ url: URL.createObjectURL(blob), name: file.name.replace(/\.[^.]+$/, "") + "_edited.pdf" });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const reset = () => {
    if (result) URL.revokeObjectURL(result.url);
    setFile(null); setPages([]); setItems([]); setPast([]); setSelected(null);
    setResult(null); setError(""); setTool("select");
  };

  /* ---------- screens ---------- */
  if (result) {
    return (
      <div style={{ textAlign: "center", padding: "30px 0" }}>
        <div style={{ fontSize: 44, color: "#16a34a" }}>✓</div>
        <h2>Your edited PDF is ready</h2>
        <a href={result.url} download={result.name}
          style={{ display: "inline-block", padding: "10px 24px", background: "#4f46e5", color: "#fff", borderRadius: 8, textDecoration: "none" }}>
          Download PDF
        </a>
        <p>
          <button style={btn} onClick={() => setResult(null)}>Keep editing</button>{" "}
          <button style={btn} onClick={reset}>Edit another file</button>
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
          <p style={{ color: "#666" }}>Max 20 MB and 20 pages</p>
          <button style={primary} onClick={() => fileInput.current.click()}>Choose PDF file</button>
        </div>
        <input ref={fileInput} type="file" accept=".pdf" hidden
          onChange={(e) => { loadPdf(e.target.files[0]); e.target.value = ""; }} />
        {busy && <p>{busy}</p>}
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>
    );
  }

  const sel = items.find((i) => i.id === selected);
  const showText = ["text", "edit"].includes(tool) || (sel && ["text", "replace"].includes(sel.type));
  const showShape = SHAPES.includes(tool) || (sel && SHAPES.includes(sel.type));
  const showFill = ["rect", "ellipse"].includes(tool) || (sel && ["rect", "ellipse"].includes(sel.type));
  const showColor = showText || showShape || tool === "highlight" || sel?.type === "highlight";
  const drawingTool = !["select", "edit"].includes(tool);

  const hbtn = { position: "absolute", width: 22, height: 22, background: "#fff", border: "1px solid #4f46e5",
    borderRadius: 4, textAlign: "center", lineHeight: "20px", fontSize: 13, touchAction: "none" };

  const renderBox = (i, pg) => {
    const isSel = selected === i.id;
    const isText = i.type === "text" || i.type === "replace";
    const cq = (pt) => `${(pt / pg.w) * 100}cqw`;
    let look = {};
    if (i.type === "whiteout") look = { background: "#fff", outline: isSel ? "2px solid #4f46e5" : "1px dashed #9aa0b5" };
    else if (i.type === "highlight") look = { background: rgba(i.color, 0.4), outline: isSel ? "2px solid #4f46e5" : "none" };
    else if (i.type === "rect" || i.type === "ellipse") {
      look = { border: `${cq(i.sw)} solid ${i.color}`, background: i.fill ? i.color : "transparent",
        borderRadius: i.type === "ellipse" ? "50%" : 0, outline: isSel ? "2px solid #4f46e5" : "none", outlineOffset: 2 };
    } else {
      look = { background: i.type === "replace" ? "#fff" : "transparent",
        outline: isSel ? "2px solid #4f46e5" : "1px dashed #9aa0b5" };
    }
    const interactive = tool === "select" || (tool === "edit" && i.type === "replace");
    const wrapperHandlers = isText
      ? { onPointerDown: (e) => { e.stopPropagation(); choose(i); } }
      : { onPointerDown: (e) => startMove(e, i), onPointerMove: moveDrag, onPointerUp: endDrag };
    const drag3 = { onPointerMove: moveDrag, onPointerUp: endDrag };

    return (
      <div key={i.id} {...wrapperHandlers}
        style={{ position: "absolute", left: `${i.x * 100}%`, top: `${i.y * 100}%`, width: `${i.w * 100}%`,
          height: `${i.h * 100}%`, boxSizing: "border-box", pointerEvents: interactive ? "auto" : "none",
          cursor: !isText && tool === "select" ? "move" : "default", touchAction: "none", ...look }}>
        {i.type === "text" && (
          <textarea autoFocus={focusId === i.id} value={i.text} placeholder="Type here"
            onChange={(e) => patch(i.id, { text: e.target.value })}
            onPointerDown={(e) => { e.stopPropagation(); choose(i); }}
            style={{ width: "100%", height: "100%", border: "none", outline: "none", resize: "none",
              background: "transparent", padding: 0, margin: 0, boxSizing: "border-box", overflow: "hidden",
              lineHeight: 1.2, fontSize: cq(i.size), color: i.color, ...cssFont(i.font) }} />
        )}
        {i.type === "replace" && (
          <input autoFocus={focusId === i.id} value={i.text}
            onChange={(e) => patch(i.id, { text: e.target.value })}
            onPointerDown={(e) => { e.stopPropagation(); choose(i); }}
            style={{ position: "absolute", left: 0, top: 0, height: "100%", boxSizing: "border-box",
              width: `${Math.max(i.w * 100, ((i.text.length * i.size * 0.55) / pg.w) * 100)}cqw`,
              border: "none", outline: "none", background: "#fff", padding: 0, margin: 0,
              fontSize: cq(i.size), color: i.color, ...cssFont(i.font) }} />
        )}
        {isSel && i.type !== "replace" && (
          <>
            {isText && (
              <div title="Move" onPointerDown={(e) => startMove(e, i)} {...drag3}
                style={{ ...hbtn, top: -26, left: 0, cursor: "move" }}>✥</div>
            )}
            <div title="Resize" onPointerDown={(e) => startResize(e, i)} {...drag3}
              style={{ position: "absolute", right: -8, bottom: -8, width: 14, height: 14, background: "#fff",
                border: "2px solid #4f46e5", borderRadius: 3, cursor: "nwse-resize", touchAction: "none" }} />
          </>
        )}
      </div>
    );
  };

  const renderSvgItem = (i, pg) => {
    const isSel = selected === i.id;
    const hit = { pointerEvents: tool === "select" && i.id !== "draft" ? "stroke" : "none", cursor: "pointer" };
    const onDown = (e) => { e.stopPropagation(); choose(i); };
    if (i.type === "line") {
      const g = { x1: i.x1 * pg.w, y1: i.y1 * pg.h, x2: i.x2 * pg.w, y2: i.y2 * pg.h };
      return (
        <g key={i.id}>
          {isSel && <line {...g} stroke="#4f46e5" strokeWidth={i.sw + 5} opacity=".35" strokeLinecap="round" />}
          <line {...g} stroke={i.color} strokeWidth={i.sw} strokeLinecap="round" />
          <line {...g} stroke="transparent" strokeWidth={Math.max(i.sw, 12)} style={hit} onPointerDown={onDown} />
        </g>
      );
    }
    const points = i.pts.map((p) => `${p[0] * pg.w},${p[1] * pg.h}`).join(" ");
    return (
      <g key={i.id}>
        {isSel && <polyline points={points} fill="none" stroke="#4f46e5" strokeWidth={i.sw + 5} opacity=".35" strokeLinecap="round" strokeLinejoin="round" />}
        <polyline points={points} fill="none" stroke={i.color} strokeWidth={i.sw} strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={points} fill="none" stroke="transparent" strokeWidth={Math.max(i.sw, 12)} style={hit} onPointerDown={onDown} />
      </g>
    );
  };

  return (
    <div>
      <style>{css}</style>

      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "#fff", padding: "8px 0", borderBottom: "1px solid #eee", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {TOOLS.map(([id, label]) => (
            <button key={id} onClick={() => selectTool(id)}
              style={{ ...btn, background: tool === id ? "#4f46e5" : "#fff", color: tool === id ? "#fff" : "#222" }}>
              {label}
            </button>
          ))}
          <span style={{ width: 1, height: 24, background: "#ddd", margin: "0 4px" }} />
          <button style={btn} onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">↶ Undo</button>
          <button style={btn} onClick={() => selected && remove(selected)} disabled={!selected}>Delete</button>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 8, fontSize: 14 }}>
          {showColor && (
            <label>Colour{" "}
              <input type="color" value={style.color} onChange={(e) => changeStyle({ color: e.target.value })} />
            </label>
          )}
          {showText && (
            <>
              <label>Size{" "}
                <input type="number" min="4" max="200" value={style.size} style={{ width: 60 }}
                  onChange={(e) => changeStyle({ size: clamp(+e.target.value || 12, 4, 200) })} />
              </label>
              <select value={style.fam} onChange={(e) => changeStyle({ fam: e.target.value })}>
                <option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option>
              </select>
              <button style={{ ...btn, fontWeight: 700, background: style.bold ? "#e0e3ff" : "#fff" }}
                onClick={() => changeStyle({ bold: !style.bold })}>B</button>
              <button style={{ ...btn, fontStyle: "italic", background: style.italic ? "#e0e3ff" : "#fff" }}
                onClick={() => changeStyle({ italic: !style.italic })}>I</button>
            </>
          )}
          {showShape && (
            <label>Stroke{" "}
              <select value={style.sw} onChange={(e) => changeStyle({ sw: +e.target.value })}>
                <option value={1}>Thin</option><option value={2}>Medium</option>
                <option value={4}>Thick</option><option value={8}>Very thick</option>
              </select>
            </label>
          )}
          {showFill && (
            <label><input type="checkbox" checked={style.fill} onChange={(e) => changeStyle({ fill: e.target.checked })} /> Fill</label>
          )}
          <span style={{ color: "#666" }}>{HINTS[tool]}</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
        {pages.map((pg, pi) => {
          const here = [...items.filter((i) => i.page === pi + 1), ...(draft && draft.page === pi + 1 ? [draft] : [])];
          return (
            <div key={pi} style={{ width: "100%", maxWidth: 720 }}>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Page {pi + 1} of {pages.length}</div>
              <div data-page="1"
                onPointerDown={(e) => onPageDown(e, pi)} onPointerMove={onPageMove} onPointerUp={onPageUp}
                style={{ position: "relative", containerType: "inline-size", boxShadow: "0 1px 6px rgba(0,0,0,.3)",
                  userSelect: "none", cursor: drawingTool ? "crosshair" : "default", touchAction: drawingTool ? "none" : "auto" }}>
                <img src={`data:image/jpeg;base64,${pg.img}`} alt={`Page ${pi + 1}`} draggable={false}
                  style={{ width: "100%", display: "block", pointerEvents: "none" }} />
                <svg viewBox={`0 0 ${pg.w} ${pg.h}`} preserveAspectRatio="none"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                  {here.filter((i) => i.type === "line" || i.type === "draw").map((i) => renderSvgItem(i, pg))}
                </svg>
                {here.filter((i) => BOX_TYPES.includes(i.type)).map((i) => renderBox(i, pg))}
                {tool === "edit" && pg.lines.map((ln, li) => {
                  const key = `${pi + 1}-${li}`;
                  if (items.some((i) => i.lineKey === key)) return null;
                  return (
                    <div key={key} className="ep-line" title="Click to edit this line"
                      onPointerDown={(e) => { e.stopPropagation(); editLine(pi, ln, key); }}
                      style={{ left: `${ln.x * 100}%`, top: `${ln.y * 100}%`, width: `${ln.w * 100}%`, height: `${ln.h * 100}%` }} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ textAlign: "center", marginTop: 20 }}>
        <button style={primary} onClick={save} disabled={!!busy}>{busy || "Apply changes & Download"}</button>{" "}
        <button style={btn} onClick={reset}>Start over</button>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>
    </div>
  );
}