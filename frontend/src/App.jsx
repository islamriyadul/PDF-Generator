import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const TOOLS = [
  { id: "word-to-pdf", label: "Word → PDF", endpoint: "/convert/word-to-pdf", accept: ".docx", out: ".pdf" },
  { id: "pdf-to-word", label: "PDF → Word", endpoint: "/convert/pdf-to-word", accept: ".pdf", out: ".docx" },
  { id: "ppt-to-pdf", label: "PowerPoint → PDF", endpoint: "/convert/powerpoint-to-pdf", accept: ".pptx,.ppt", out: ".pdf" },
  { id: "excel-to-pdf", label: "Excel → PDF", endpoint: "/convert/excel-to-pdf", accept: ".xlsx,.xls", out: ".pdf" },
  { id: "html-to-pdf", label: "HTML → PDF", endpoint: "/convert/html-to-pdf", accept: ".html,.htm", out: ".pdf" },
  { id: "merge-pdf", label: "Merge PDF", endpoint: "/tools/merge-pdf", accept: ".pdf", out: ".pdf", multiple: true, name: "merged" },
  { id: "image-to-pdf", label: "Image → PDF", endpoint: "/tools/image-to-pdf", accept: ".jpg,.jpeg,.png", out: ".pdf", multiple: true, name: "images" },
  {
    id: "pdf-to-jpg", label: "PDF → JPG", endpoint: "/convert/pdf-to-jpg", accept: ".pdf", out: ".jpg",
    fields: [{ name: "dpi", label: "Quality", type: "select", options: ["72", "150", "200"], default: "150", unit: " DPI" }],
  },
  {
    id: "extract", label: "Extract pages", endpoint: "/tools/extract-pages", accept: ".pdf", out: ".pdf", suffix: "_pages",
    fields: [{ name: "pages", label: "Pages", type: "text", placeholder: "e.g. 1-3,5", required: true }],
  },
  { id: "pdf-to-excel", label: "PDF → Excel", endpoint: "/convert/pdf-to-excel", accept: ".pdf", out: ".xlsx" },
  {
  id: "pdf-to-ppt", label: "PDF → PowerPoint", endpoint: "/convert/pdf-to-powerpoint", accept: ".pdf", out: ".pptx",
  fields: [{
    name: "mode", label: "Output type", type: "select", default: "image",
    options: [
      { value: "image", label: "Looks identical (not editable)" },
      { value: "editable", label: "Editable (text boxes, shapes, tables)" },
      ],
    }],
  },
  {
    id: "rotate", label: "Rotate PDF", endpoint: "/tools/rotate-pdf", accept: ".pdf", out: ".pdf", suffix: "_rotated",
    fields: [
      { name: "angle", label: "Rotate clockwise", type: "select", options: ["90", "180", "270"], default: "90", unit: "°"},
      { name: "pages", label: "Pages (leave empty for all)", type: "text", placeholder: "e.g. 1-3,5" },
    ],
  },
  {
    id: "protect", label: "Protect PDF", endpoint: "/tools/protect-pdf", accept: ".pdf", out: ".pdf", suffix: "_protected",
    fields: [{ name: "password", label: "Set a password", type: "password", required: true }],
  },
  {
    id: "unlock", label: "Unlock PDF", endpoint: "/tools/unlock-pdf", accept: ".pdf", out: ".pdf", suffix: "_unlocked",
    fields: [{ name: "password", label: "Current password", type: "password", required: true }],
  },
];

const initialValues = (tool) =>
  Object.fromEntries((tool.fields || []).map((f) => [f.name, f.default || ""]));

export default function App() {
  const [tool, setTool] = useState(TOOLS[0]);
  const [files, setFiles] = useState([]);
  const [values, setValues] = useState(initialValues(TOOLS[0]));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectTool = (t) => {
    setTool(t);
    setFiles([]);
    setValues(initialValues(t));
    setError("");
  };

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
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const ext = tool.id === "pdf-to-jpg" ? (blob.type.includes("zip") ? ".zip" : ".jpg") : tool.out;
      a.download = base + ext;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const missingField = (tool.fields || []).some((f) => f.required && !values[f.name].trim());
  const disabled = !files.length || loading || missingField;

  return (
    <div style={{ maxWidth: 560, margin: "60px auto", fontFamily: "sans-serif" }}>
      <h1>Pdf Generator</h1>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {TOOLS.map((t) => (
          <button key={t.id} onClick={() => selectTool(t)}
            style={{ fontWeight: t.id === tool.id ? "bold" : "normal" }}>
            {t.label}
          </button>
        ))}
      </div>

      <input
        key={tool.id}
        type="file"
        accept={tool.accept}
        multiple={tool.multiple}
        onChange={(e) => setFiles(Array.from(e.target.files))}
      />

      {files.length > 0 && (
        <ul>
          {files.map((f) => (
            <li key={f.name}>{f.name} ({(f.size / 1024 / 1024).toFixed(2)} MB)</li>
          ))}
        </ul>
      )}

      {(tool.fields || []).map((f) => (
        <label key={f.name} style={{ display: "block", marginTop: 12 }}>
          {f.label}
          <br />
          {f.type === "select" ? (
            <select value={values[f.name]}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
              {f.options.map((o) => {
                const v = typeof o === "string" ? o : o.value;
                const l = typeof o === "string" ? v + (f.unit || "") : o.label;
                return <option key={v} value={v}>{l}</option>;
              })}
            </select>
          ) : (
            <input
              type={f.type}
              placeholder={f.placeholder}
              value={values[f.name]}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
            />
          )}
        </label>
      ))}

      <button onClick={handleRun} disabled={disabled} style={{ display: "block", marginTop: 16 }}>
        {loading ? "Working..." : "Run & Download"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}