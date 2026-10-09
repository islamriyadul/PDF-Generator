import { useEffect, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import Organizer from "./Organizer";
import SignPdf from "./SignPdf";
import Comparer from "./Comparer";
import Redactor from "./Redactor";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const CATEGORIES = ["All", "Convert", "Organize", "Optimize", "Security", "Edit"];

const TOOLS = [
  // ---- Convert ----
  { id: "word-to-pdf", cat: "Convert", label: "Word → PDF", desc: "Turn .docx files into PDF", endpoint: "/convert/word-to-pdf", accept: ".docx,.doc", out: ".pdf" },
  { id: "powerpoint-to-pdf", cat: "Convert", label: "PowerPoint → PDF", desc: "Turn slides into PDF", endpoint: "/convert/powerpoint-to-pdf", accept: ".pptx,.ppt", out: ".pdf" },
  { id: "excel-to-pdf", cat: "Convert", label: "Excel → PDF", desc: "Turn spreadsheets into PDF", endpoint: "/convert/excel-to-pdf", accept: ".xlsx,.xls", out: ".pdf" },
  { id: "html-to-pdf", cat: "Convert", label: "HTML → PDF", desc: "Turn an HTML file into PDF", endpoint: "/convert/html-to-pdf", accept: ".html,.htm", out: ".pdf" },
  { id: "image-to-pdf", cat: "Convert", label: "Image → PDF", desc: "Combine JPG and PNG into one PDF", endpoint: "/tools/image-to-pdf", accept: ".jpg,.jpeg,.png", out: ".pdf", multiple: true, name: "images" },
  { id: "pdf-to-word", cat: "Convert", label: "PDF → Word", desc: "Edit your PDF in Word", endpoint: "/convert/pdf-to-word", accept: ".pdf", out: ".docx" },
  { id: "pdf-to-excel", cat: "Convert", label: "PDF → Excel", desc: "Pull tables out of a PDF", endpoint: "/convert/pdf-to-excel", accept: ".pdf", out: ".xlsx" },
  {
    id: "pdf-to-powerpoint", cat: "Convert", label: "PDF → PowerPoint", desc: "Turn pages into slides",
    endpoint: "/convert/pdf-to-powerpoint", accept: ".pdf", out: ".pptx",
    fields: [{ name: "mode", label: "Output type", type: "select", default: "image", options: [
      { value: "image", label: "Looks identical (not editable)" },
      { value: "editable", label: "Editable (text boxes, shapes, tables)" },
    ] }],
  },
  {
    id: "pdf-to-jpg", cat: "Convert", label: "PDF → JPG", desc: "Save each page as an image",
    endpoint: "/convert/pdf-to-jpg", accept: ".pdf", out: ".jpg",
    fields: [{ name: "dpi", label: "Quality", type: "select", default: "150", unit: " DPI", options: ["72", "150", "200"] }],
  },
  {
    id: "pdf-to-pdfa", cat: "Convert", label: "PDF → PDF/A", desc: "Archive-ready PDF", suffix: "_pdfa",
    endpoint: "/tools/pdf-to-pdfa", accept: ".pdf", out: ".pdf",
    fields: [{ name: "part", label: "PDF/A version", type: "select", default: "2", options: [
      { value: "2", label: "PDF/A-2b (recommended)" },
      { value: "1", label: "PDF/A-1b (oldest, most compatible)" },
      { value: "3", label: "PDF/A-3b (allows attachments)" },
    ] }],
  },

  // ---- Organize ----
  { id: "organize-pdf", cat: "Organize", label: "Organize PDF", desc: "Reorder, rotate, delete and add pages", custom: "organizer" },
  { id: "merge-pdf", cat: "Organize", label: "Merge PDF", desc: "Combine PDFs into one", endpoint: "/tools/merge-pdf", accept: ".pdf", out: ".pdf", multiple: true, name: "merged" },
  {
    id: "split-pdf", cat: "Organize", label: "Split PDF", desc: "Cut a PDF into several files", suffix: "_split",
    endpoint: "/tools/split-pdf", accept: ".pdf", out: ".zip",
    fields: [
      { name: "mode", label: "Split by", type: "select", default: "ranges", options: [
        { value: "ranges", label: "Custom ranges" },
        { value: "n", label: "Every N pages" },
        { value: "every", label: "Every page" },
      ] },
      { name: "value", label: "Ranges (1-3,4-6,7) or N (e.g. 2)", type: "text", placeholder: "e.g. 1-3,4-6,7" },
    ],
  },
  {
    id: "extract-pages", cat: "Organize", label: "Extract pages", desc: "Keep only the pages you pick", suffix: "_pages",
    endpoint: "/tools/extract-pages", accept: ".pdf", out: ".pdf",
    fields: [{ name: "pages", label: "Pages", type: "text", placeholder: "e.g. 1-3,5", required: true }],
  },
  {
    id: "remove-pages", cat: "Organize", label: "Remove pages", desc: "Delete pages you don't need", suffix: "_edited",
    endpoint: "/tools/remove-pages", accept: ".pdf", out: ".pdf",
    fields: [{ name: "pages", label: "Pages to remove", type: "text", placeholder: "e.g. 2,5-7", required: true }],
  },
  {
    id: "rotate-pdf", cat: "Organize", label: "Rotate PDF", desc: "Turn pages clockwise", suffix: "_rotated",
    endpoint: "/tools/rotate-pdf", accept: ".pdf", out: ".pdf",
    fields: [
      { name: "angle", label: "Rotate clockwise", type: "select", default: "90", unit: "°", options: ["90", "180", "270"] },
      { name: "pages", label: "Pages (leave empty for all)", type: "text", placeholder: "e.g. 1-3,5" },
    ],
  },

  // ---- Optimize ----
  {
    id: "compress-pdf", cat: "Optimize", label: "Compress PDF", desc: "Make the file smaller", suffix: "_compressed",
    endpoint: "/tools/compress-pdf", accept: ".pdf", out: ".pdf",
    fields: [{ name: "level", label: "Compression", type: "select", default: "medium", options: [
      { value: "low", label: "Low (best quality)" },
      { value: "medium", label: "Medium (recommended)" },
      { value: "high", label: "High (smallest file)" },
    ] }],
  },
  {
    id: "ocr-pdf", cat: "Optimize", label: "OCR PDF", desc: "Make scanned PDFs searchable", suffix: "_ocr",
    endpoint: "/tools/ocr-pdf", accept: ".pdf", out: ".pdf",
    fields: [{ name: "lang", label: "Document language", type: "select", default: "eng",
      optionsUrl: "/tools/ocr-languages", options: [{ value: "eng", label: "English" }] }],
  },
  { id: "repair-pdf", cat: "Optimize", label: "Repair PDF", desc: "Fix a damaged PDF", suffix: "_repaired", endpoint: "/tools/repair-pdf", accept: ".pdf", out: ".pdf" },

  // ---- Security ----
  {
    id: "protect-pdf", cat: "Security", label: "Protect PDF", desc: "Add a password", suffix: "_protected",
    endpoint: "/tools/protect-pdf", accept: ".pdf", out: ".pdf",
    fields: [{ name: "password", label: "Set a password", type: "password", required: true }],
  },
  {
    id: "unlock-pdf", cat: "Security", label: "Unlock PDF", desc: "Remove a password you know", suffix: "_unlocked",
    endpoint: "/tools/unlock-pdf", accept: ".pdf", out: ".pdf",
    fields: [{ name: "password", label: "Current password", type: "password", required: true }],
  },

  // ---- Edit ----
  { id: "sign-pdf", cat: "Edit", label: "Sign PDF", desc: "Draw, type or upload your signature", custom: "sign" },
  { id: "compare-pdf", cat: "Edit", label: "Compare PDF", desc: "See what changed between two files", custom: "compare" },
  { id: "redact-pdf", cat: "Security", label: "Redact PDF", desc: "Permanently black out sensitive text", custom: "redact" },
];

const initialValues = (tool) =>
  Object.fromEntries((tool.fields || []).map((f) => [f.name, f.default || ""]));

/* ---------------- Home page ---------------- */
function Home() {
  const [cat, setCat] = useState("All");
  const [query, setQuery] = useState("");
  const shown = TOOLS.filter(
    (t) =>
      (cat === "All" || t.cat === cat) &&
      (t.label + " " + t.desc).toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 16px" }}>
      <h1 style={{ textAlign: "center" }}>Every PDF tool you need</h1>
      <p style={{ textAlign: "center", color: "#666" }}>
        Files are deleted from the server right after processing.
      </p>
      <input
        placeholder="Search tools..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ display: "block", margin: "16px auto", padding: 10, width: "100%", maxWidth: 420 }}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 20 }}>
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setCat(c)}
            style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid #ccc", cursor: "pointer",
              background: c === cat ? "#4f46e5" : "#fff", color: c === cat ? "#fff" : "#222" }}>
            {c}
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
        {shown.map((t) => (
          <Link key={t.id} to={`/${t.id}`}
            style={{ border: "1px solid #e2e2e8", borderRadius: 12, padding: 16, textDecoration: "none", color: "inherit", background: "#fff" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{t.label}</div>
            <div style={{ fontSize: 14, color: "#666" }}>{t.desc}</div>
          </Link>
        ))}
        {!shown.length && <p>No tools found.</p>}
      </div>
    </div>
  );
}

/* ---------------- Generic tool form ---------------- */
function ToolForm({ tool }) {
  const [files, setFiles] = useState([]);
  const [values, setValues] = useState(initialValues(tool));
  const [remote, setRemote] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (tool.fields || []).forEach((f) => {
      if (!f.optionsUrl) return;
      fetch(`${API}${f.optionsUrl}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((list) => {
          if (Array.isArray(list) && list.length) setRemote((p) => ({ ...p, [f.name]: list }));
        })
        .catch(() => {}); // keep the built-in options if the request fails
    });
  }, [tool]);

  const handleRun = async () => {
    setLoading(true);
    setError("");
    try {
      const body = new FormData();
      files.forEach((f) => body.append(tool.multiple ? "files" : "file", f));
      (tool.fields || []).forEach((f) => body.append(f.name, values[f.name]));

      const res = await fetch(`${API}${tool.endpoint}`, { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
      }
      const blob = await res.blob();
      const base = tool.name || files[0].name.replace(/\.[^.]+$/, "") + (tool.suffix || "");
      const ext = tool.id === "pdf-to-jpg" ? (blob.type.includes("zip") ? ".zip" : ".jpg") : tool.out;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = base + ext;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const missing = (tool.fields || []).some((f) => f.required && !values[f.name].trim());
  const disabled = !files.length || loading || missing;

  return (
    <div>
      <input type="file" accept={tool.accept} multiple={tool.multiple}
        onChange={(e) => setFiles(Array.from(e.target.files))} />

      {files.length > 0 && (
        <ul>
          {files.map((f) => (
            <li key={f.name}>{f.name} ({(f.size / 1024 / 1024).toFixed(2)} MB)</li>
          ))}
        </ul>
      )}

      {(tool.fields || []).map((f) => {
        const options = f.optionsUrl ? remote[f.name] || f.options : f.options;
        return (
          <label key={f.name} style={{ display: "block", marginTop: 12 }}>
            {f.label}
            <br />
            {f.type === "select" ? (
              <select value={values[f.name]}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                {options.map((o) => {
                  const v = typeof o === "string" ? o : o.value;
                  const l = typeof o === "string" ? v + (f.unit || "") : o.label;
                  return <option key={v} value={v}>{l}</option>;
                })}
              </select>
            ) : (
              <input type={f.type} placeholder={f.placeholder} value={values[f.name]}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
            )}
          </label>
        );
      })}

      <button onClick={handleRun} disabled={disabled} style={{ display: "block", marginTop: 16 }}>
        {loading ? "Working..." : "Run & Download"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}

/* ---------------- Tool page (one URL per tool) ---------------- */
function ToolPage() {
  const { toolId } = useParams();
  const tool = TOOLS.find((t) => t.id === toolId);

  if (!tool) {
    return (
      <div style={{ maxWidth: 560, margin: "40px auto", textAlign: "center" }}>
        <h2>Tool not found</h2>
        <Link to="/">← Back to all tools</Link>
      </div>
    );
  }

  const CUSTOM = { organizer: <Organizer />, sign: <SignPdf />, compare: <Comparer />, redact: <Redactor /> };

  return (
    <div style={{ maxWidth: tool.custom ? 1100 : 560, margin: "30px auto", padding: "0 16px" }}>
      <Link to="/">← All tools</Link>
      <h1 style={{ marginBottom: 4 }}>{tool.label}</h1>
      <p style={{ color: "#666", marginTop: 0 }}>{tool.desc}</p>
      {tool.custom ? CUSTOM[tool.custom] : <ToolForm key={tool.id} tool={tool} />}
    </div>
  );
}

/* ---------------- App ---------------- */
export default function App() {
  return (
    <div style={{ fontFamily: "sans-serif" }}>
      <nav style={{ padding: "14px 20px", borderBottom: "1px solid #eee" }}>
        <Link to="/" style={{ fontWeight: 700, fontSize: 18, textDecoration: "none", color: "#4f46e5" }}>
          Pdf Generator
        </Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/:toolId" element={<ToolPage />} />
      </Routes>
    </div>
  );
}