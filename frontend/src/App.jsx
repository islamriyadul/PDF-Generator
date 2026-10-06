import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const TOOLS = [
  { id: "word-to-pdf", label: "Word → PDF", endpoint: "/convert/word-to-pdf", accept: ".docx", out: ".pdf" },
  { id: "pdf-to-word", label: "PDF → Word", endpoint: "/convert/pdf-to-word", accept: ".pdf", out: ".docx" },
  { id: "merge-pdf", label: "Merge PDF", endpoint: "/tools/merge-pdf", accept: ".pdf", out: ".pdf", multiple: true, name: "merged" },
  { id: "extract", label: "Extract pages", endpoint: "/tools/extract-pages", accept: ".pdf", out: ".pdf", pages: true },
  { id: "image-to-pdf", label: "Image → PDF", endpoint: "/tools/image-to-pdf", accept: ".jpg,.jpeg,.png", out: ".pdf", multiple: true, name: "images" },
];

export default function App() {
  const [tool, setTool] = useState(TOOLS[0]);
  const [files, setFiles] = useState([]);
  const [pages, setPages] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectTool = (t) => {
    setTool(t);
    setFiles([]);
    setPages("");
    setError("");
  };

  const handleConvert = async () => {
    if (!files.length) return;
    setLoading(true);
    setError("");
    try {
      const body = new FormData();
      files.forEach((f) => body.append(tool.multiple ? "files" : "file", f));
      if (tool.pages) body.append("pages", pages);

      const res = await fetch(`${API}${tool.endpoint}`, { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
      }
      const blob = await res.blob();
      const base = tool.name || files[0].name.replace(/\.[^.]+$/, "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = base + tool.out;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const disabled = !files.length || loading || (tool.pages && !pages.trim());

  return (
    <div style={{ maxWidth: 520, margin: "60px auto", fontFamily: "sans-serif" }}>
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

      {tool.pages && (
        <input
          placeholder="Pages, e.g. 1-3,5"
          value={pages}
          onChange={(e) => setPages(e.target.value)}
          style={{ display: "block", marginTop: 12 }}
        />
      )}

      <button onClick={handleConvert} disabled={disabled} style={{ display: "block", marginTop: 16 }}>
        {loading ? "Working..." : "Run & Download"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}