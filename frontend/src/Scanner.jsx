import { useEffect, useState } from "react";
import QRCode from "qrcode";
import ScanApp from "./ScanApp";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const btn = { padding: "9px 18px", border: "1px solid #ccc", borderRadius: 8, background: "#fff", cursor: "pointer" };

export default function Scanner() {
  // a phone goes straight to the scanner, a computer shows the QR code
  const [here, setHere] = useState(
    () => window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 900
  );
  const [qr, setQr] = useState({ state: "loading" });

  useEffect(() => {
    if (here) return;
    let dead = false;
    (async () => {
      try {
        const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
        let host = window.location.host;
        if (local) {
          const r = await fetch(`${API}/tools/lan-ip`);
          const d = await r.json();
          host = `${d.ip}${window.location.port ? ":" + window.location.port : ""}`;
        }
        const url = `${window.location.protocol}//${host}${window.location.pathname}`;
        const img = await QRCode.toDataURL(url, { width: 240, margin: 1 });
        if (!dead) setQr({ state: "ready", url, img, local });
      } catch {
        if (!dead) setQr({ state: "error" });
      }
    })();
    return () => { dead = true; };
  }, [here]);

  if (here) return <ScanApp />;

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", textAlign: "center", border: "1px solid #e2e2e8", borderRadius: 12, padding: 24, background: "#fff" }}>
      <h3 style={{ marginTop: 0 }}>Scan with your phone</h3>
      <p style={{ color: "#555" }}>
        Point your phone's camera at this code and open the link. Scanning, cleaning up, text recognition
        and the PDF all happen on your phone, and nothing is uploaded.
      </p>
      {qr.state === "loading" && <p style={{ color: "#666" }}>Preparing your QR code…</p>}
      {qr.state === "ready" && (
        <>
          <img src={qr.img} alt="QR code to open the scanner on your phone" width={240} height={240} />
          {qr.local && (
            <p style={{ color: "#888", fontSize: 12 }}>
              Your phone and this computer must be on the same Wi-Fi.<br />Or type: {qr.url}
            </p>
          )}
        </>
      )}
      {qr.state === "error" && (
        <p style={{ color: "red" }}>
          Could not get the QR code. Make sure the backend is running with <code>--host 0.0.0.0</code>.
        </p>
      )}
      <p><button style={btn} onClick={() => setHere(true)}>Or use the scanner on this computer</button></p>
    </div>
  );
}