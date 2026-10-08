import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const MAX_FILE = 20 * 1024 * 1024;
const MAX_SOURCES = 10;

const css = `
.org-card { position: relative; border: 2px solid #e2e2e8; border-radius: 10px; background: #fff;
  padding: 8px 8px 6px; cursor: pointer; user-select: none; transition: border-color .12s, background .12s; }
.org-card:hover { border-color: #b9b9ff; }
.org-card.sel { border-color: #4f46e5; background: #eef0ff; }
.org-actions { position: absolute; top: 6px; left: 0; right: 0; display: flex; justify-content: center;
  gap: 4px; opacity: 0; transition: opacity .12s; z-index: 2; }
.org-card:hover .org-actions { opacity: 1; }
.org-actions button { width: 26px; height: 26px; border-radius: 50%; border: 1px solid #ccc;
  background: #fff; cursor: pointer; font-size: 13px; line-height: 1; padding: 0; }
.org-actions button:hover { background: #4f46e5; color: #fff; border-color: #4f46e5; }
.org-bar { position: absolute; top: 0; bottom: 0; width: 4px; background: #4f46e5; border-radius: 2px; }
.org-tool { padding: 6px 10px; border: 1px solid #ccc; background: #fff; border-radius: 6px; cursor: pointer; }
.org-tool:disabled { opacity: .45; cursor: not-allowed; }
`;

export default function Organizer() {
  const [state, setState] = useState({ past: [], items: [], future: [] });
  const [selected, setSelected] = useState(() => new Set());
  const [anchor, setAnchor] = useState(null);
  const [zoom, setZoom] = useState(150);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [dragIds, setDragIds] = useState([]);
  const [dropAt, setDropAt] = useState(null);
  const sources = useRef([]);
  const counter = useRef(0);
  const fileInput = useRef(null);
  const items = state.items;

  // ---------- history (undo / redo) ----------
  const commit = (next) =>
    setState((s) => ({
      past: [...s.past.slice(-49), s.items],
      items: typeof next === "function" ? next(s.items) : next,
      future: [],
    }));
  const undo = () =>
    setState((s) => s.past.length
      ? { past: s.past.slice(0, -1), items: s.past[s.past.length - 1], future: [s.items, ...s.future] }
      : s);
  const redo = () =>
    setState((s) => s.future.length
      ? { past: [...s.past, s.items], items: s.future[0], future: s.future.slice(1) }
      : s);

  // ---------- loading files ----------
  const insertIndex = (list) => {
    const last = list.reduce((m, it, i) => (selected.has(it.id) ? i : m), -1);
    return last >= 0 ? last + 1 : list.length; // after the last selected page, else at the end
  };

  const addFiles = async (fileList) => {
    const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (!files.length) return setError("Please choose PDF files");
    setError("");
    setResult(null);
    for (const f of files) {
      if (f.size > MAX_FILE) { setError(`${f.name} is larger than 20 MB`); continue; }
      if (sources.current.length >= MAX_SOURCES) { setError(`You can use up to ${MAX_SOURCES} files`); break; }
      setBusy(`Loading ${f.name}...`);
      try {
        const body = new FormData();
        body.append("file", f);
        const res = await fetch(`${API}/tools/pdf-thumbnails`, { method: "POST", body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Preview failed");
        const src = sources.current.length;
        sources.current.push(f);
        const added = data.pages.map((p, i) => ({
          id: ++counter.current, src, page: i + 1, thumb: p.img, w: p.w, h: p.h, rotate: 0,
        }));
        commit((list) => {
          const at = insertIndex(list);
          return [...list.slice(0, at), ...added, ...list.slice(at)];
        });
      } catch (e) {
        setError(e.message);
      }
    }
    setBusy("");
  };

  const reset = () => {
    if (result) URL.revokeObjectURL(result.url);
    sources.current = [];
    setState({ past: [], items: [], future: [] });
    setSelected(new Set());
    setAnchor(null);
    setResult(null);
    setError("");
  };

  // ---------- page actions ----------
  const rotateBy = (deg) =>
    commit((list) => list.map((it) =>
      selected.size === 0 || selected.has(it.id) ? { ...it, rotate: (it.rotate + deg + 360) % 360 } : it));
  const rotateOne = (id, deg) =>
    commit((list) => list.map((it) => (it.id === id ? { ...it, rotate: (it.rotate + deg + 360) % 360 } : it)));
  const removeIds = (ids) => {
    commit((list) => list.filter((it) => !ids.has(it.id)));
    setSelected(new Set());
  };
  const duplicateIds = (ids) =>
    commit((list) => list.flatMap((it) => (ids.has(it.id) ? [it, { ...it, id: ++counter.current }] : [it])));
  const addBlank = () =>
    commit((list) => {
      const at = insertIndex(list);
      const ref = list[Math.max(at - 1, 0)];
      const blank = { id: ++counter.current, blank: true, w: ref?.w, h: ref?.h, rotate: 0 };
      return [...list.slice(0, at), blank, ...list.slice(at)];
    });
  const reverse = () => commit((list) => [...list].reverse());

  // ---------- selection ----------
  const clickCard = (e, it, i) => {
    if (e.shiftKey && anchor !== null) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      setSelected(new Set(items.slice(a, b + 1).map((x) => x.id)));
      return;
    }
    setSelected((s) => {
      const n = new Set(s);
      n.has(it.id) ? n.delete(it.id) : n.add(it.id);
      return n;
    });
    setAnchor(i);
  };

  // ---------- keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (e) => {
      if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === "a" && items.length) { e.preventDefault(); setSelected(new Set(items.map((x) => x.id))); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selected.size) { e.preventDefault(); removeIds(selected); }
      else if (e.key === "Escape") setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- drag and drop ----------
  const onDragStart = (e, it) => {
    e.dataTransfer.setData("text/plain", "page");
    e.dataTransfer.effectAllowed = "move";
    const ids = selected.has(it.id) ? items.filter((x) => selected.has(x.id)).map((x) => x.id) : [it.id];
    if (!selected.has(it.id)) setSelected(new Set([it.id]));
    setDragIds(ids);
  };
  const onCardDragOver = (e, i) => {
    if (!dragIds.length) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setDropAt(e.clientX > r.left + r.width / 2 ? i + 1 : i);
  };
  const onGridDrop = (e) => {
    e.preventDefault();
    if (dragIds.length && dropAt !== null) {
      const moving = items.filter((x) => dragIds.includes(x.id));
      const remaining = items.filter((x) => !dragIds.includes(x.id));
      const idx = items.slice(0, dropAt).filter((x) => !dragIds.includes(x.id)).length;
      const next = [...remaining.slice(0, idx), ...moving, ...remaining.slice(idx)];
      if (next.some((x, k) => x.id !== items[k].id)) commit(next);
    } else if (!dragIds.length && e.dataTransfer.files.length) {
      addFiles(e.dataTransfer.files);
    }
    setDragIds([]);
    setDropAt(null);
  };

  // ---------- save ----------
  const save = async () => {
    const used = [...new Set(items.filter((i) => !i.blank).map((i) => i.src))].sort((a, b) => a - b);
    if (!used.length) return setError("Add at least one page from a PDF");
    const remap = new Map(used.map((s, k) => [s, k]));
    const plan = items.map((it) =>
      it.blank ? { blank: true, rotate: it.rotate } : { src: remap.get(it.src), page: it.page, rotate: it.rotate });
    setBusy("Building your PDF...");
    setError("");
    try {
      const body = new FormData();
      used.forEach((s) => body.append("files", sources.current[s]));
      body.append("plan", JSON.stringify(plan));
      const res = await fetch(`${API}/tools/organize-pdf`, { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
      }
      const blob = await res.blob();
      const name = sources.current[used[0]].name.replace(/\.[^.]+$/, "") + "_organized.pdf";
      setResult({ url: URL.createObjectURL(blob), name });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  // ---------- thumbnail sizing (fits the page, rotated or not, in a zoom x zoom cell) ----------
  const boxFor = (it) => {
    const ratio = it.w && it.h ? it.w / it.h : 0.707;
    const turned = it.rotate % 180 !== 0;
    const r = turned ? 1 / ratio : ratio; // aspect ratio as displayed
    let bw = zoom, bh = zoom / r;
    if (bh > zoom) { bh = zoom; bw = zoom * r; }
    return { bw, bh, iw: turned ? bh : bw, ih: turned ? bw : bh };
  };

  const hint = { color: "#666", fontSize: 14 };

  // ---------- screens ----------
  if (result) {
    return (
      <div style={{ textAlign: "center", padding: "30px 0" }}>
        <div style={{ fontSize: 44, color: "#16a34a" }}>✓</div>
        <h2>Your file is ready</h2>
        <a href={result.url} download={result.name}
          style={{ display: "inline-block", padding: "10px 24px", background: "#4f46e5", color: "#fff", borderRadius: 8, textDecoration: "none" }}>
          Download PDF
        </a>
        <p>
          <button className="org-tool" onClick={() => setResult(null)}>Keep editing</button>{" "}
          <button className="org-tool" onClick={reset}>Start over</button>
        </p>
        <p style={hint}>Your files are deleted from the server right after processing.</p>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div>
        <style>{css}</style>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          style={{ border: "2px dashed #b9b9ff", borderRadius: 12, padding: "50px 20px", textAlign: "center", background: "#fafaff" }}
        >
          <p style={{ fontSize: 18, margin: 0 }}>Drag and drop PDF files here</p>
          <p style={hint}>You can add several PDFs and arrange all their pages together (max 20 MB each)</p>
          <button className="org-tool" onClick={() => fileInput.current.click()}
            style={{ background: "#4f46e5", color: "#fff", border: "none", padding: "10px 22px" }}>
            Choose PDF files
          </button>
        </div>
        <input ref={fileInput} type="file" accept=".pdf" multiple hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        {busy && <p>{busy}</p>}
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>
    );
  }

  const none = selected.size === 0;
  return (
    <div>
      <style>{css}</style>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 10 }}>
        <button className="org-tool" onClick={() => fileInput.current.click()}>＋ Add files</button>
        <button className="org-tool" onClick={undo} disabled={!state.past.length} title="Undo (Ctrl+Z)">↶</button>
        <button className="org-tool" onClick={redo} disabled={!state.future.length} title="Redo (Ctrl+Y)">↷</button>
        <button className="org-tool" onClick={() => rotateBy(-90)} title={none ? "Rotate all left" : "Rotate selected left"}>⟲</button>
        <button className="org-tool" onClick={() => rotateBy(90)} title={none ? "Rotate all right" : "Rotate selected right"}>⟳</button>
        <button className="org-tool" onClick={() => duplicateIds(selected)} disabled={none}>Duplicate</button>
        <button className="org-tool" onClick={addBlank}>Blank page</button>
        <button className="org-tool" onClick={reverse}>Reverse</button>
        <button className="org-tool" onClick={() => removeIds(selected)} disabled={none}>Delete</button>
        <button className="org-tool" onClick={() => setSelected(new Set(items.map((x) => x.id)))}>Select all</button>
        <label style={{ marginLeft: "auto", fontSize: 13 }}>
          Zoom{" "}
          <input type="range" min="90" max="260" value={zoom} onChange={(e) => setZoom(+e.target.value)} />
        </label>
      </div>
      <input ref={fileInput} type="file" accept=".pdf" multiple hidden
        onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

      <p style={hint}>
        {items.length} pages · {selected.size} selected. Click to select, Shift+click for a range, drag to reorder.
        {none ? " Rotate applies to all pages when nothing is selected." : ""}
      </p>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onGridDrop}
        style={{ display: "flex", flexWrap: "wrap", gap: 14, minHeight: 200, padding: 4 }}
      >
        {items.map((it, i) => {
          const { bw, bh, iw, ih } = boxFor(it);
          const dragging = dragIds.includes(it.id);
          return (
            <div
              key={it.id}
              className={"org-card" + (selected.has(it.id) ? " sel" : "")}
              draggable
              onClick={(e) => clickCard(e, it, i)}
              onDragStart={(e) => onDragStart(e, it)}
              onDragOver={(e) => onCardDragOver(e, i)}
              onDragEnd={() => { setDragIds([]); setDropAt(null); }}
              style={{ width: zoom + 16, opacity: dragging ? 0.4 : 1 }}
            >
              {dropAt === i && dragIds.length > 0 && <div className="org-bar" style={{ left: -9 }} />}
              {dropAt === items.length && i === items.length - 1 && dragIds.length > 0 &&
                <div className="org-bar" style={{ right: -9 }} />}

              <div className="org-actions" onClick={(e) => e.stopPropagation()}>
                <button title="Rotate left" onClick={() => rotateOne(it.id, -90)}>⟲</button>
                <button title="Rotate right" onClick={() => rotateOne(it.id, 90)}>⟳</button>
                <button title="Duplicate" onClick={() => duplicateIds(new Set([it.id]))}>⧉</button>
                <button title="Delete" onClick={() => removeIds(new Set([it.id]))}>✕</button>
              </div>

              <div style={{ width: zoom, height: zoom, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ position: "relative", width: bw, height: bh, boxShadow: "0 1px 4px rgba(0,0,0,.25)", background: "#fff" }}>
                  {it.thumb ? (
                    <img
                      src={`data:image/jpeg;base64,${it.thumb}`}
                      alt={`Page ${it.page}`}
                      draggable={false}
                      style={{
                        position: "absolute", left: "50%", top: "50%", width: iw, height: ih,
                        transform: `translate(-50%, -50%) rotate(${it.rotate}deg)`, transition: "transform .18s",
                      }}
                    />
                  ) : (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: 12 }}>
                      Blank page
                    </div>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "center", fontSize: 12, marginTop: 6 }}>
                {i + 1}
                {!it.blank && sources.current.length > 1 ? ` · file ${it.src + 1}` : ""}
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={save} disabled={!!busy}
        style={{ display: "block", marginTop: 18, padding: "10px 26px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
        {busy || "Organize & Download"}
      </button>
      {busy && <p style={hint}>{busy}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}