import { useEffect, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import Organizer from "./Organizer";
import SignPdf from "./SignPdf";
import Comparer from "./Comparer";
import Redactor from "./Redactor";
import Cropper from "./Cropper";
import EditPdf from "./EditPdf";
import FormFiller from "./FormFiller";
import Scanner from "./Scanner";
const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const CATEGORIES = ["All", "Convert", "Organize", "Optimize", "Security", "Edit"];

const IMAGE_PDF_FIELDS = [
  { name: "size", label: "Page size", type: "select", default: "a4", options: [
    { value: "a4", label: "A4" },
    { value: "letter", label: "US Letter" },
    { value: "fit", label: "Same size as the image" },
  ] },
  { name: "orientation", label: "Orientation", type: "select", default: "auto", options: [
    { value: "auto", label: "Automatic" },
    { value: "portrait", label: "Portrait" },
    { value: "landscape", label: "Landscape" },
  ] },
  { name: "margin", label: "Margin", type: "select", default: "small", options: [
    { value: "none", label: "None" },
    { value: "small", label: "Small" },
    { value: "big", label: "Big" },
  ] },
  { name: "separate", label: "Output", type: "select", default: "false", options: [
    { value: "false", label: "One PDF with all images" },
    { value: "true", label: "One PDF per image (ZIP)" },
  ] },
];

const DPI_FIELD = [
  { name: "dpi", label: "Quality", type: "select", default: "150", unit: " DPI", options: ["72", "150", "200"] },
];

const TOOLS = [
  // ---- Convert ----
  { id: "word-to-pdf", cat: "Convert", label: "Word → PDF", desc: "Turn .docx files into PDF", endpoint: "/convert/word-to-pdf", accept: ".docx,.doc", out: ".pdf" },
  { id: "powerpoint-to-pdf", cat: "Convert", label: "PowerPoint → PDF", desc: "Turn slides into PDF", endpoint: "/convert/powerpoint-to-pdf", accept: ".pptx,.ppt", out: ".pdf" },
  { id: "excel-to-pdf", cat: "Convert", label: "Excel → PDF", desc: "Turn spreadsheets into PDF", endpoint: "/convert/excel-to-pdf", accept: ".xlsx,.xls", out: ".pdf" },
  { id: "html-to-pdf", cat: "Convert", label: "HTML → PDF", desc: "Turn an HTML file into PDF", endpoint: "/convert/html-to-pdf", accept: ".html,.htm", out: ".pdf" },
  { id: "jpg-to-pdf", cat: "Convert", label: "JPG → PDF", desc: "Turn JPG images into PDF",
    endpoint: "/convert/jpg-to-pdf", accept: ".jpg,.jpeg", out: ".pdf", multiple: true, name: "images", fields: IMAGE_PDF_FIELDS },
  { id: "png-to-pdf", cat: "Convert", label: "PNG → PDF", desc: "Turn PNG images into PDF",
    endpoint: "/convert/png-to-pdf", accept: ".png", out: ".pdf", multiple: true, name: "images", fields: IMAGE_PDF_FIELDS },
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
  { id: "pdf-to-jpg", cat: "Convert", label: "PDF → JPG", desc: "Save each page as a JPG image",
    endpoint: "/convert/pdf-to-jpg", accept: ".pdf", out: ".jpg", fields: DPI_FIELD },
  { id: "pdf-to-png", cat: "Convert", label: "PDF → PNG", desc: "Save each page as a sharp PNG image",
    endpoint: "/convert/pdf-to-png", accept: ".pdf", out: ".png", fields: DPI_FIELD },
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
  { id: "redact-pdf", cat: "Security", label: "Redact PDF", desc: "Permanently black out sensitive text", custom: "redact" },

  // ---- Edit ----
  { id: "sign-pdf", cat: "Edit", label: "Sign PDF", desc: "Draw, type or upload your signature", custom: "sign" },
  { id: "compare-pdf", cat: "Edit", label: "Compare PDF", desc: "See what changed between two files", custom: "compare" },
  { id: "crop-pdf", cat: "Edit", label: "Crop PDF", desc: "Trim margins or cut out an area", custom: "crop" },
  { id: "edit-pdf", cat: "Edit", label: "Edit PDF", desc: "Add text, edit text, shapes and highlights", custom: "edit" },
  {
    id: "add-page-numbers", cat: "Edit", label: "Add page numbers", desc: "Number the pages of your PDF", suffix: "_numbered",
    endpoint: "/tools/add-page-numbers", accept: ".pdf", out: ".pdf",
    fields: [
      { name: "position", label: "Position", type: "select", default: "bc", options: [
        { value: "bc", label: "Bottom centre" },
        { value: "br", label: "Bottom right" },
        { value: "bl", label: "Bottom left" },
        { value: "tc", label: "Top centre" },
        { value: "tr", label: "Top right" },
        { value: "tl", label: "Top left" },
      ] },
      { name: "fmt", label: "Format", type: "select", default: "n", options: [
        { value: "n", label: "1, 2, 3" },
        { value: "page_n", label: "Page 1, Page 2" },
        { value: "n_of_t", label: "1 / 10, 2 / 10" },
        { value: "page_n_of_t", label: "Page 1 of 10" },
      ] },
      { name: "start", label: "Start number", type: "text", default: "1" },
      { name: "size", label: "Font size", type: "select", default: "11", unit: " pt", options: ["8", "9", "10", "11", "12", "14", "16", "20"] },
      { name: "margin", label: "Distance from the edge", type: "select", default: "36", unit: " pt", options: ["20", "36", "54", "72"] },
      { name: "color", label: "Colour", type: "color", default: "#000000" },
      { name: "pages", label: "Only these pages (leave empty for all)", type: "text", placeholder: "e.g. 2-10" },
    ],
  },

  {
    id: "add-watermark", cat: "Edit", label: "Add watermark", desc: "Stamp text across your pages", suffix: "_watermarked",
    endpoint: "/tools/add-watermark", accept: ".pdf", out: ".pdf",
    fields: [
      { name: "text", label: "Watermark text", type: "text", placeholder: "e.g. CONFIDENTIAL", required: true },
      { name: "size", label: "Font size", type: "select", default: "64", unit: " pt", options: ["24", "36", "48", "64", "80", "110"] },
      { name: "color", label: "Colour", type: "color", default: "#888888" },
      { name: "opacity", label: "Opacity", type: "select", default: "30", unit: " %", options: ["10", "20", "30", "50", "70", "100"] },
      { name: "angle", label: "Angle", type: "select", default: "45", options: [
        { value: "0", label: "Horizontal" },
        { value: "45", label: "Diagonal (up)" },
        { value: "-45", label: "Diagonal (down)" },
      ] },
      { name: "layout", label: "Layout", type: "select", default: "center", options: [
        { value: "center", label: "One in the centre" },
        { value: "tile", label: "Repeated across the page" },
      ] },
      { name: "position", label: "Place it", type: "select", default: "over", options: [
        { value: "over", label: "Over the content" },
        { value: "behind", label: "Behind the content" },
      ] },
      { name: "pages", label: "Only these pages (leave empty for all)", type: "text", placeholder: "e.g. 1-3,5" },
    ],
  },
  { id: "fill-pdf-form", cat: "Edit", label: "Fill PDF form", desc: "Fill in the fields of a PDF form", custom: "fillform" },
  { id: "flatten-pdf", cat: "Edit", label: "Flatten PDF form", desc: "Lock form answers into the page", suffix: "_flattened",
  endpoint: "/tools/flatten-pdf", accept: ".pdf", out: ".pdf" },
  { id: "scan-to-pdf", cat: "Convert", label: "Scan to PDF", desc: "Turn camera shots or photos into a clean PDF", custom: "scan" },
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
      const ext =
        ["pdf-to-jpg", "pdf-to-png"].includes(tool.id) ? (blob.type.includes("zip") ? ".zip" : tool.out)
        : ["jpg-to-pdf", "png-to-pdf"].includes(tool.id) ? (values.separate === "true" ? ".zip" : ".pdf")
        : tool.out;
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

  const CUSTOM = { organizer: <Organizer />, sign: <SignPdf />, compare: <Comparer />, redact: <Redactor />, crop: <Cropper />, edit: <EditPdf />, fillform: <FormFiller />, scan: <Scanner /> };
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