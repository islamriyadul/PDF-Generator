import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8000`;

const btn = { padding: "12px 16px", border: "1px solid #ccc", borderRadius: 10, background: "#fff", fontSize: 16, cursor: "pointer" };
const primary = { ...btn, background: "#4f46e5", color: "#fff", border: "none", fontWeight: 600 };

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read this photo")); };
    img.src = url;
  });
}

// shrink big phone photos before sending, so the upload is quick
async function shrink(file) {
  const { img, url } = await loadImage(file);
  const k = Math.min(1, 2600 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(Math.round(img.naturalWidth * k), 1);
  c.height = Math.max(Math.round(img.naturalHeight * k), 1);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("Could not process this photo"))), "image/jpeg", 0.9));
}

export default function ScanPhone() {
  const { token } = useParams();
  const [state, setState] = useState("checking"); // checking | ready | expired | offline
  const [shots, setShots] = useState([]);
  const chain = useRef(Promise.resolve());
  const blobs = useRef({});
  const counter = useRef(0);
  const photoInput = useRef(null);
  const pickInput = useRef(null);

  useEffect(() => {
    fetch(`${API}/tools/scan-phone/${token}/status`)
      .then((r) => setState(r.ok ? "ready" : "expired"))
      .catch(() => setState("offline"));
  }, [token]);

  const patch = (id, ch) => setShots((l) => l.map((s) => (s.id === id ? { ...s, ...ch } : s)));

  const send = async (id, blob) => {
    patch(id, { state: "uploading", message: "" });
    try {
      const body = new FormData();
      body.append("file", blob, "page.jpg");
      const res = await fetch(`${API}/tools/scan-phone/${token}/upload`, { method: "POST", body });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(typeof d.detail === "string" ? d.detail : "Upload failed");
      }
      patch(id, { state: "done" });
    } catch (e) {
      patch(id, { state: "error", message: e.message });
    }
  };

  const add = (list) => {
    Array.from(list).forEach((f) => {
      const id = ++counter.current;
      setShots((l) => [...l, { id, url: URL.createObjectURL(f), state: "preparing", message: "" }]);
      chain.current = chain.current.then(async () => {  // one at a time keeps the page order
        try {
          const blob = await shrink(f);
          blobs.current[id] = blob;
          await send(id, blob);
        } catch (e) {
          patch(id, { state: "error", message: e.message });
        }
      });
    });
  };

  const retry = (id) => {
    if (!blobs.current[id]) return;
    chain.current = chain.current.then(() => send(id, blobs.current[id]));
  };

  const done = shots.filter((s) => s.state === "done").length;

  if (state === "checking") return <p style={{ padding: 20 }}>Connecting…</p>;
  if (state === "offline") {
    return (
      <div style={{ padding: 20 }}>
        <h2>Can't reach the server</h2>
        <p>Make sure your phone is on the same Wi-Fi as your computer, then scan the QR code again.</p>
      </div>
    );
  }
  if (state === "expired") {
    return (
      <div style={{ padding: 20 }}>
        <h2>This scan has expired</h2>
        <p>Go back to your computer and scan the new QR code.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
      <h2 style={{ marginBottom: 4 }}>Scan your document</h2>
      <p style={{ color: "#666", marginTop: 0 }}>
        Take a photo of each page. They appear on your computer automatically.
      </p>

      <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <input ref={pickInput} type="file" accept="image/*" multiple hidden
        onChange={(e) => { add(e.target.files); e.target.value = ""; }} />

      <button style={{ ...primary, width: "100%", padding: "16px" }} onClick={() => photoInput.current.click()}>
        📷 Take photo
      </button>
      <button style={{ ...btn, width: "100%", marginTop: 10 }} onClick={() => pickInput.current.click()}>
        Choose from gallery
      </button>

      <p style={{ margin: "16px 0 8px", fontWeight: 600 }}>
        {done} page(s) sent{shots.length - done > 0 ? ` · ${shots.length - done} in progress` : ""}
      </p>
      {done > 0 && (
        <p style={{ color: "#16a34a", marginTop: 0 }}>
          ✓ Go back to your computer to finish. You can keep taking more pages here.
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {shots.map((s, i) => (
          <div key={s.id} style={{ border: "1px solid #e2e2e8", borderRadius: 8, padding: 4, background: "#fff" }}>
            <img src={s.url} alt={`Page ${i + 1}`} style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 6 }} />
            <div style={{ fontSize: 12, textAlign: "center", marginTop: 4,
              color: s.state === "error" ? "#c00" : s.state === "done" ? "#16a34a" : "#666" }}>
              {s.state === "done" && "✓ Sent"}
              {s.state === "preparing" && "Preparing…"}
              {s.state === "uploading" && "Sending…"}
              {s.state === "error" && (
                <>
                  {s.message || "Failed"}
                  {blobs.current[s.id] && <><br /><button onClick={() => retry(s.id)}>Retry</button></>}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}