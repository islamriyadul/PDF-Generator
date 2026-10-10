import { useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const MAX_FILE = 20 * 1024 * 1024;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

const btn = { padding: "6px 12px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer" };
const primary = { ...btn, background: "#4f46e5", color: "#fff", border: "none", padding: "9px 22px", borderRadius: 8 };

export default function FormFiller() {
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]);
  const [values, setValues] = useState({});
  const [flatten, setFlatten] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const fileInput = useRef(null);

  const loadPdf = async (f) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf")) return setError("Please choose a PDF file");
    if (f.size > MAX_FILE) return setError("File is larger than 20 MB");
    setError(""); setBusy("Reading form fields...");
    try {
      const body = new FormData();
      body.append("file", f);
      const res = await fetch(`${API}/tools/pdf-form-info`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Preview failed");
      const initial = {};
      data.pages.forEach((p) => p.fields.forEach((fl) => { initial[fl.key] = fl.value; }));
      setFile(f); setPages(data.pages); setValues(initial);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const set = (key, v) => setValues((s) => ({ ...s, [key]: v }));
  const pickRadio = (f) =>
    setValues((s) => {
      const n = { ...s };
      pages.forEach((p) => p.fields.forEach((x) => {
        if (x.kind === "radio" && x.name === f.name) n[x.key] = false;
      }));
      n[f.key] = true;
      return n;
    });

  const save = async () => {
    setBusy("Filling your form..."); setError("");
    try {
      const send = {};
      pages.forEach((p) => p.fields.forEach((f) => { if (!f.readonly) send[f.key] = values[f.key]; }));
      const body = new FormData();
      body.append("file", file);
      body.append("values", JSON.stringify(send));
      body.append("flatten", flatten ? "true" : "false");
      const res = await fetch(`${API}/tools/fill-pdf-form`, { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
      }
      const blob = await res.blob();
      setResult({ url: URL.createObjectURL(blob), name: file.name.replace(/\.[^.]+$/, "") + "_filled.pdf" });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const reset = () => {
    if (result) URL.revokeObjectURL(result.url);
    setFile(null); setPages([]); setValues({}); setResult(null); setError(""); setFlatten(false);
  };

  if (result) {
    return (
      <div style={{ textAlign: "center", padding: "30px 0" }}>
        <div style={{ fontSize: 44, color: "#16a34a" }}>✓</div>
        <h2>Your filled form is ready</h2>
        <a href={result.url} download={result.name}
          style={{ display: "inline-block", padding: "10px 24px", background: "#4f46e5", color: "#fff", borderRadius: 8, textDecoration: "none" }}>
          Download PDF
        </a>
        <p>
          <button style={btn} onClick={() => setResult(null)}>Keep editing</button>{" "}
          <button style={btn} onClick={reset}>Fill another form</button>
        </p>
        <p style={{ color: "#666", fontSize: 14 }}>Open the result and check every field before you send it.</p>
      </div>
    );
  }

  if (!file) {
    return (
      <div>
        <div onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); loadPdf(e.dataTransfer.files[0]); }}
          style={{ border: "2px dashed #b9b9ff", borderRadius: 12, padding: "50px 20px", textAlign: "center", background: "#fafaff" }}>
          <p style={{ fontSize: 18, margin: 0 }}>Drag and drop a fillable PDF form here</p>
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

  const total = pages.reduce((n, p) => n + p.fields.length, 0);

  const renderField = (f, pg) => {
    const pt = clamp(f.h * pg.h * 0.62, 6, 14);
    const common = {
      position: "absolute", left: `${f.x * 100}%`, top: `${f.y * 100}%`,
      width: `${f.w * 100}%`, height: `${f.h * 100}%`, boxSizing: "border-box", margin: 0,
      background: f.readonly ? "rgba(150,150,150,.15)" : "rgba(79,70,229,.12)",
      border: "1px solid rgba(79,70,229,.5)", fontSize: `${(pt / pg.w) * 100}cqw`, padding: "0 2px",
    };
    if (f.kind === "checkbox" || f.kind === "radio") {
      return (
        <input key={f.key} type={f.kind === "radio" ? "radio" : "checkbox"} disabled={f.readonly}
          checked={!!values[f.key]} title={f.name}
          onChange={(e) => (f.kind === "radio" ? pickRadio(f) : set(f.key, e.target.checked))}
          style={{ ...common, padding: 0, accentColor: "#4f46e5" }} />
      );
    }
    if (f.kind === "combo" || f.kind === "list") {
      return (
        <select key={f.key} disabled={f.readonly} value={values[f.key] ?? ""} title={f.name}
          onChange={(e) => set(f.key, e.target.value)} style={common}>
          <option value=""></option>
          {f.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      );
    }
    if (f.multiline) {
      return (
        <textarea key={f.key} disabled={f.readonly} value={values[f.key] ?? ""} title={f.name}
          maxLength={f.maxlen || undefined} onChange={(e) => set(f.key, e.target.value)}
          style={{ ...common, resize: "none", lineHeight: 1.2 }} />
      );
    }
    return (
      <input key={f.key} type="text" disabled={f.readonly} value={values[f.key] ?? ""} title={f.name}
        maxLength={f.maxlen || undefined} onChange={(e) => set(f.key, e.target.value)} style={common} />
    );
  };

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
        {pages.map((pg, pi) => (
          <div key={pi} style={{ width: "100%", maxWidth: 720 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
              Page {pi + 1} of {pages.length} · {pg.fields.length} field(s)
            </div>
            <div style={{ position: "relative", containerType: "inline-size", boxShadow: "0 1px 6px rgba(0,0,0,.3)" }}>
              <img src={`data:image/jpeg;base64,${pg.img}`} alt={`Page ${pi + 1}`} draggable={false}
                style={{ width: "100%", display: "block", userSelect: "none" }} />
              {pg.fields.map((f) => renderField(f, pg))}
            </div>
          </div>
        ))}
      </div>

      <aside style={{ flex: "0 0 250px", position: "sticky", top: 10, border: "1px solid #e2e2e8", borderRadius: 12, padding: 14, background: "#fff" }}>
        <b>Fill form</b>
        <p style={{ color: "#666", fontSize: 13, margin: "6px 0 10px" }}>
          {total} field(s) found. Type in the highlighted boxes on the pages.
        </p>
        <label style={{ display: "block", fontSize: 14 }}>
          <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />{" "}
          Flatten after filling
        </label>
        <p style={{ color: "#888", fontSize: 12 }}>
          Flattening locks the answers into the page so they can't be edited, but the form can't be filled again.
        </p>
        <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #eee" }} />
        <button style={{ ...primary, width: "100%" }} onClick={save} disabled={!!busy}>
          {busy || "Fill & Download"}
        </button>
        <button style={{ ...btn, width: "100%", marginTop: 8 }} onClick={reset}>Start over</button>
        {error && <p style={{ color: "red", fontSize: 14 }}>{error}</p>}
      </aside>
    </div>
  );
}