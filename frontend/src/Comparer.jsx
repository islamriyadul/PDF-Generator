import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function Comparer() {
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [onlyChanged, setOnlyChanged] = useState(true);

  const run = async () => {
    setBusy(true); setError(""); setData(null);
    try {
      const body = new FormData();
      body.append("file_a", a);
      body.append("file_b", b);
      const res = await fetch(`${API}/tools/compare-pdf`, { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.detail === "string" ? json.detail : "Request failed");
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const shown = data ? data.pages.filter((p) => !onlyChanged || p.changed) : [];
  const pane = (img, missing) =>
    img ? (
      <img src={`data:image/jpeg;base64,${img}`} alt="" style={{ width: "100%", boxShadow: "0 1px 4px rgba(0,0,0,.3)" }} />
    ) : (
      <div style={{ padding: 40, textAlign: "center", color: "#999", border: "1px dashed #ccc" }}>
        {missing ? "Page not in this file" : ""}
      </div>
    );

  return (
    <div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <label>Original PDF<br />
          <input type="file" accept=".pdf" onChange={(e) => setA(e.target.files[0] || null)} />
        </label>
        <label>Changed PDF<br />
          <input type="file" accept=".pdf" onChange={(e) => setB(e.target.files[0] || null)} />
        </label>
      </div>
      <button onClick={run} disabled={!a || !b || busy} style={{ display: "block", marginTop: 16 }}>
        {busy ? "Comparing..." : "Compare"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}

      {data && (
        <div style={{ marginTop: 20 }}>
          <p>
            <b>{data.changed_pages}</b> of {Math.max(data.pages_a, data.pages_b)} pages differ ·{" "}
            <span style={{ color: "#c00" }}>{data.words_removed} words only in the original</span> ·{" "}
            <span style={{ color: "#080" }}>{data.words_added} words only in the changed file</span>
          </p>
          <label>
            <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />{" "}
            Show only pages with changes
          </label>
          {!shown.length && <p>No differences found.</p>}
          {shown.map((p) => (
            <div key={p.page} style={{ marginTop: 20 }}>
              <div style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>
                Page {p.page}
                {p.missing ? "" : ` · ${p.removed} removed · ${p.added} added · ${p.visual}% visual change`}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {pane(p.a, p.missing === "a")}
                {pane(p.b, p.missing === "b")}
              </div>
            </div>
          ))}
          <p style={{ color: "#666", fontSize: 13 }}>Red = only in the original. Green = only in the changed file.</p>
        </div>
      )}
    </div>
  );
}