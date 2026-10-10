import { useEffect, useRef, useState } from "react";
import { canvasToBlob, contentQuad, cvStats, decodeClamped, detectDocument, loadCV, release, renderPage } from "./scan/cv";
import { MAX_OCR_PAGES, buildPdfOcr, buildPdfStream } from "./scan/pdf";
import { clearAll, getFiles, getMeta, lastTouched, loadOrder, removePage, saveOrder, savePage, touch } from "./scan/store";
import { expiringUrl, makeUrl, revokeAll, revokeUrl } from "./scan/blobs";

const MAX_PAGES = 200;
const RESULT_TTL = 10 * 60 * 1000;   // the download link destroys itself after 10 minutes
const STORE_TTL = 2 * 60 * 60 * 1000; // stored pages are wiped after 2 hours without activity
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

const btn = { padding: "10px 14px", border: "1px solid #ccc", borderRadius: 10, background: "#fff", fontSize: 15, cursor: "pointer" };
const primary = { ...btn, background: "#4f46e5", color: "#fff", border: "none", fontWeight: 600 };
const small = { ...btn, padding: "4px 10px", fontSize: 14, borderRadius: 6 };

const FILTERS = [["color", "Color"], ["gray", "Grayscale"], ["bw", "Black & white"], ["original", "Original"]];
const LANGS = [
  ["eng", "English"], ["ben", "Bengali"], ["ben+eng", "Bengali + English"], ["hin", "Hindi"],
  ["hin+eng", "Hindi + English"], ["ara", "Arabic"], ["spa", "Spanish"], ["fra", "French"],
  ["deu", "German"], ["por", "Portuguese"], ["rus", "Russian"], ["ind", "Indonesian"],
  ["tur", "Turkish"], ["tam", "Tamil"], ["urd", "Urdu"], ["chi_sim", "Chinese (Simplified)"],
  ["jpn", "Japanese"], ["kor", "Korean"],
];
const FULL = [[0, 0], [1, 0], [1, 1], [0, 1]];

/* ---------- drag the 4 corners ---------- */
function EdgeEditor({ item, onApply, onAuto, onCancel }) {
  const [url] = useState(() => makeUrl(item.raw));
  const [quad, setQuad] = useState(item.quad || [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]]);
  const box = useRef(null);
  const active = useRef(null);
  useEffect(() => () => revokeUrl(url), [url]);

  const down = (e, i) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); active.current = i; };
  const move = (e) => {
    const i = active.current;
    if (i === null) return;
    const r = box.current.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width, 0, 1);
    const y = clamp((e.clientY - r.top) / r.height, 0, 1);
    setQuad((q) => q.map((p, k) => (k === i ? [x, y] : p)));
  };
  const up = () => { active.current = null; };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 30, display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <p style={{ color: "#fff", margin: "0 0 10px" }}>Drag the corners to the edges of the page</p>
      <div ref={box} style={{ position: "relative", display: "inline-block", touchAction: "none", userSelect: "none" }}>
        <img src={url} alt="Page" draggable={false}
          style={{ display: "block", maxWidth: "92vw", maxHeight: "68vh", pointerEvents: "none" }} />
        <svg viewBox="0 0 1 1" preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          <polygon points={quad.map((p) => p.join(",")).join(" ")} fill="rgba(79,70,229,.2)"
            stroke="#818cf8" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        {quad.map(([x, y], i) => (
          <div key={i} onPointerDown={(e) => down(e, i)} onPointerMove={move} onPointerUp={up}
            style={{ position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, width: 34, height: 34,
              transform: "translate(-50%, -50%)", borderRadius: "50%", background: "rgba(255,255,255,.9)",
              border: "3px solid #4f46e5", touchAction: "none" }} />
        ))}
      </div>
      <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <button style={primary} onClick={() => onApply(quad)}>Apply</button>
        <button style={btn} onClick={async () => { const q = await onAuto(); setQuad(q || FULL); }}>Auto detect</button>
        <button style={btn} onClick={() => setQuad(FULL)}>Whole photo</button>
        <button style={btn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* ---------- the scanner ---------- */
export default function ScanApp() {
  const [items, setItems] = useState([]); // small records only: the pictures live in storage
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [engine, setEngine] = useState("loading");
  const [editing, setEditing] = useState(null);
  const [size, setSize] = useState("a4");
  const [margin, setMargin] = useState("small");
  const [ocr, setOcr] = useState(false);
  const [lang, setLang] = useState("eng");
  const [result, setResult] = useState(null);
  const itemsRef = useRef([]);
  const resultRef = useRef(null);
  const queue = useRef(Promise.resolve());
  const counter = useRef(0);
  const activity = useRef(Date.now());
  const photoInput = useRef(null);
  const pickInput = useRef(null);

  const pause = () => new Promise((r) => setTimeout(r, 30));

  const setList = (list) => {
    itemsRef.current = list;
    setItems(list);
    activity.current = Date.now();
    saveOrder(list.map((i) => i.id)).catch(() => {});
    touch().catch(() => {});
  };

  const dropResult = () => {
    resultRef.current?.handle.cancel();
    resultRef.current = null;
    setResult(null);
  };

  // rule 6: destroy everything
  const wipe = async (message) => {
    dropResult();
    revokeAll();
    await clearAll().catch(() => {});
    itemsRef.current = [];
    setItems([]); setError(""); setBusy("");
    setNotice(message || "");
  };

  useEffect(() => {
    loadCV().then(() => setEngine("ready")).catch(() => setEngine("failed"));

    // bring back pages if the browser reloaded this page, unless they are too old
    queue.current = (async () => {
      try {
        const touched = await lastTouched();
        if (touched && Date.now() - touched > STORE_TTL) {
          await clearAll();
          setNotice("Scans older than 2 hours were removed for your privacy.");
          return;
        }
        const order = await loadOrder();
        const list = [];
        for (const id of order) {
          const m = await getMeta(id);
          if (m) { const { thumb, ...rest } = m; list.push({ ...rest, url: makeUrl(thumb) }); }
        }
        counter.current = order.reduce((a, b) => Math.max(a, b), 0);
        if (list.length) {
          itemsRef.current = list;
          setItems(list);
          setNotice(`Restored ${list.length} page(s) from your last session.`);
        }
      } catch { /* storage not available: start empty */ }
    })();

    // auto-destruct after a long idle time
    const timer = setInterval(() => {
      if (itemsRef.current.length && Date.now() - activity.current > STORE_TTL) {
        wipe("Your scans were removed after 2 hours of inactivity.");
      }
    }, 60000);
    return () => { clearInterval(timer); resultRef.current?.handle.cancel(); revokeAll(); };
  }, []);

  const doAdd = async (files) => {
    let n = 0;
    for (const f of files) {
      n++;
      if (itemsRef.current.length >= MAX_PAGES) { setError(`You can scan up to ${MAX_PAGES} pages`); break; }
      setBusy(`Processing photo ${n} of ${files.length}...`);
      await pause();
      try {
        const cv = await loadCV();
        const canvas = await decodeClamped(f);
        const quad = detectDocument(cv, canvas) || contentQuad(cv, canvas);
        const raw = await canvasToBlob(canvas, "image/jpeg", 0.9);
        release(canvas);

        const id = ++counter.current;
        const r = await renderPage(cv, { raw, quad, rotate: 0, filter: "color" });
        await savePage(id, { raw, out: r.blob }, { id, quad, rotate: 0, filter: "color", w: r.w, h: r.h, thumb: r.thumb });
        setList([...itemsRef.current, { id, quad, rotate: 0, filter: "color", w: r.w, h: r.h, url: makeUrl(r.thumb) }]);

        const s = cvStats();
        if (s.live) console.warn("OpenCV objects not freed:", s);
      } catch (e) {
        setError(e.message || "Could not process this photo");
      }
    }
    setBusy("");
  };

  const addPhotos = (list) => {
    const files = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return setError("Please choose photos");
    setError(""); setNotice("");
    dropResult();
    queue.current = queue.current.then(() => doAdd(files));
  };

  const rerender = async (id, patch) => {
    const cur = itemsRef.current.find((i) => i.id === id);
    if (!cur) return;
    setBusy("Updating the page...");
    await pause();
    try {
      const cv = await loadCV();
      const files = await getFiles(id);
      const next = { ...cur, ...patch };
      const r = await renderPage(cv, { ...next, raw: files.raw });
      const { url, ...rest } = next;
      await savePage(id, { raw: files.raw, out: r.blob }, { ...rest, w: r.w, h: r.h, thumb: r.thumb });
      revokeUrl(cur.url);
      setList(itemsRef.current.map((i) => (i.id === id ? { ...next, w: r.w, h: r.h, url: makeUrl(r.thumb) } : i)));
    } catch (e) {
      setError(e.message || "Could not update the page");
    }
    setBusy("");
  };

  const setAllFilters = async (f) => { for (const it of itemsRef.current) await rerender(it.id, { filter: f }); };
  const remove = (id) => {
    const it = itemsRef.current.find((i) => i.id === id);
    if (it) revokeUrl(it.url);
    removePage(id).catch(() => {});
    setList(itemsRef.current.filter((i) => i.id !== id));
  };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= itemsRef.current.length) return;
    const n = [...itemsRef.current];
    [n[i], n[j]] = [n[j], n[i]];
    setList(n);
  };
  const openEdges = async (it) => {
    try { const f = await getFiles(it.id); setEditing({ ...it, raw: f.raw }); }
    catch { setError("Could not open this page"); }
  };
  const autoQuad = async (it) => {
    const c = await decodeClamped(it.raw);
    const cv = await loadCV();
    const q = detectDocument(cv, c) || contentQuad(cv, c);
    release(c);
    return q;
  };

  const create = async () => {
    if (!items.length) return;
    if (ocr && items.length > MAX_OCR_PAGES) {
      return setError(`Text recognition is limited to ${MAX_OCR_PAGES} pages. Turn OCR off, or create the PDF in parts.`);
    }
    setError(""); setNotice("");
    dropResult();
    setBusy(ocr ? "Starting text recognition..." : "Building your PDF...");
    await pause();
    try {
      const pages = items.map((i) => ({ w: i.w, h: i.h, load: async () => (await getFiles(i.id)).out }));
      const blob = ocr
        ? await buildPdfOcr(pages, { size, margin }, lang, setBusy)
        : await buildPdfStream(pages, { size, margin }, setBusy);
      const d = new Date();
      const p = (x) => String(x).padStart(2, "0");
      const name = `scan_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.pdf`;
      const handle = expiringUrl(blob, RESULT_TTL, () => {
        resultRef.current = null;
        setResult(null);
        setNotice("The download link expired for your privacy. Tap Create PDF to make it again.");
      });
      resultRef.current = { blob, name, handle };
      setResult({ blob, name, url: handle.url });
      activity.current = Date.now();
    } catch (e) {
      setError(e.message || "Could not create the PDF");
    }
    setBusy("");
  };

  const share = async () => {
    const f = new File([result.blob], result.name, { type: "application/pdf" });
    if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f] }).catch(() => {});
    else setError("Sharing is not available here. Use Download.");
  };

  /* ---------- screens ---------- */
  if (result) {
    return (
      <div style={{ textAlign: "center", padding: "24px 0" }}>
        <div style={{ fontSize: 44, color: "#16a34a" }}>✓</div>
        <h2>Your PDF is ready</h2>
        <p style={{ color: "#666" }}>{items.length} page(s){ocr ? " · searchable text" : ""}</p>
        <a href={result.url} download={result.name}
          style={{ ...primary, display: "inline-block", textDecoration: "none", marginRight: 8 }}>Download PDF</a>
        <button style={btn} onClick={share}>Share</button>
        <p>
          <button style={btn} onClick={dropResult}>Keep editing</button>{" "}
          <button style={btn} onClick={() => wipe("")}>New scan (delete pages)</button>
        </p>
        <p style={{ color: "#666", fontSize: 14 }}>
          Nothing was uploaded. This link expires in 10 minutes, and your pages are deleted after 2 hours without activity.
        </p>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 90 }}>
      <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
      <input ref={pickInput} type="file" accept="image/*" multiple hidden
        onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />

      {editing && (
        <EdgeEditor item={editing} onAuto={() => autoQuad(editing)} onCancel={() => setEditing(null)}
          onApply={(q) => { const id = editing.id; setEditing(null); rerender(id, { quad: q }); }} />
      )}

      {engine === "loading" && <p style={{ color: "#666" }}>Loading the scanner engine (the first time takes a moment)…</p>}
      {engine === "failed" && <p style={{ color: "red" }}>Could not load the scanner engine. Check your connection and reload.</p>}
      {notice && <p style={{ color: "#16a34a" }}>{notice}</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button style={primary} onClick={() => photoInput.current.click()}>📷 Take photo</button>
        <button style={btn} onClick={() => pickInput.current.click()}>Gallery (many)</button>
        {items.length > 1 && (
          <select defaultValue="" style={{ ...btn, marginLeft: "auto" }}
            onChange={(e) => { if (e.target.value) setAllFilters(e.target.value); e.target.value = ""; }}>
            <option value="">Filter for all…</option>
            {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      </div>

      {!items.length && (
        <div style={{ border: "2px dashed #b9b9ff", borderRadius: 12, padding: "30px 16px", textAlign: "center", background: "#fafaff" }}>
          <p style={{ fontSize: 17, margin: 0 }}>Photograph your document</p>
          <p style={{ color: "#666", fontSize: 14 }}>
            Put the paper on a plain, darker surface with good light. The page is found and straightened automatically.
          </p>
          <p style={{ color: "#666", fontSize: 14, marginBottom: 0 }}>
            For many pages: take all the photos with your camera app, then tap <b>Gallery (many)</b> and select them all.
          </p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
        {items.map((it, i) => (
          <div key={it.id} style={{ border: "1px solid #e2e2e8", borderRadius: 10, padding: 8, background: "#fff" }}>
            <div style={{ height: 190, display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f4f6", borderRadius: 6 }}>
              <img src={it.url} alt={`Page ${i + 1}`} draggable={false} loading="lazy"
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            </div>
            <div style={{ fontSize: 12, textAlign: "center", margin: "6px 0" }}>Page {i + 1}{it.quad ? "" : " · whole photo"}</div>
            <select value={it.filter} onChange={(e) => rerender(it.id, { filter: e.target.value })} style={{ width: "100%", marginBottom: 6 }}>
              {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
              <button style={small} disabled={i === 0} onClick={() => move(i, -1)}>←</button>
              <button style={small} disabled={i === items.length - 1} onClick={() => move(i, 1)}>→</button>
              <button style={small} onClick={() => rerender(it.id, { rotate: (it.rotate + 90) % 360 })}>⟳</button>
              <button style={small} onClick={() => openEdges(it)}>Edges</button>
              <button style={small} onClick={() => remove(it.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {items.length > 0 && (
        <div style={{ border: "1px solid #e2e2e8", borderRadius: 12, padding: 14, background: "#fff", marginTop: 16 }}>
          <b>PDF options</b>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <label>Page size<br />
              <select value={size} onChange={(e) => setSize(e.target.value)}>
                <option value="a4">A4</option><option value="letter">US Letter</option><option value="fit">Same as the page</option>
              </select>
            </label>
            <label>Margin<br />
              <select value={margin} onChange={(e) => setMargin(e.target.value)}>
                <option value="none">None</option><option value="small">Small</option><option value="big">Big</option>
              </select>
            </label>
          </div>
          <label style={{ display: "block", marginTop: 12 }}>
            <input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} /> Make the text searchable (OCR)
          </label>
          {ocr && (
            <>
              <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ marginTop: 6 }}>
                {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <p style={{ color: "#888", fontSize: 12, marginBottom: 0 }}>
                Printed text only, not handwriting. Slow on a phone (about 10 to 40 seconds per page) and limited to {MAX_OCR_PAGES} pages.
              </p>
            </>
          )}
        </div>
      )}

      {error && <p style={{ color: "red" }}>{error}</p>}

      {busy && (
        <div style={{ position: "fixed", left: 12, right: 12, bottom: 78, background: "#111827", color: "#fff",
          padding: "10px 14px", borderRadius: 10, zIndex: 25, fontSize: 14 }}>{busy}</div>
      )}

      {items.length > 0 && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: "#fff", borderTop: "1px solid #e2e2e8",
          padding: 12, display: "flex", gap: 8, zIndex: 20 }}>
          <button style={{ ...primary, flex: 1 }} onClick={create} disabled={!!busy}>Create PDF ({items.length})</button>
          <button style={btn} onClick={() => wipe("")} disabled={!!busy}>Clear</button>
        </div>
      )}
    </div>
  );
}