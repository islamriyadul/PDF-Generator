import io
import secrets
import shutil
import socket
import threading
import time

from fastapi import HTTPException
from PIL import Image

from app.core.config import MAX_SIZE, TMP_DIR

TTL = 3600          # a scan session lives for 1 hour
MAX_SESSIONS = 200
MAX_PAGES = 30
_EXT = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}

_lock = threading.Lock()
_sessions = {}  # computer token -> session
_phones = {}    # phone token -> computer token

# sessions live in memory, so leftovers from an earlier run are useless
for _old in TMP_DIR.glob("scan_*"):
    shutil.rmtree(_old, ignore_errors=True)


def _expired():
    return HTTPException(404, "This scan has expired. Scan the QR code again")


def _drop(pc):
    s = _sessions.pop(pc, None)
    if s:
        _phones.pop(s["phone"], None)
        shutil.rmtree(s["dir"], ignore_errors=True)


def _purge():  # call with the lock held
    now = time.time()
    for pc in [k for k, s in _sessions.items() if now - s["created"] > TTL]:
        _drop(pc)


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet is sent
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def create():
    with _lock:
        _purge()
        if len(_sessions) >= MAX_SESSIONS:
            raise HTTPException(503, "Too many scans are open right now. Try again in a few minutes")
        pc, phone = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
        d = TMP_DIR / ("scan_" + secrets.token_hex(8))
        d.mkdir()
        _sessions[pc] = {"phone": phone, "dir": d, "pages": [], "next": 1,
                         "created": time.time(), "connected": False}
        _phones[phone] = pc
    return pc, phone


def phone_status(phone):
    with _lock:
        _purge()
        s = _sessions.get(_phones.get(phone, ""))
        if not s:
            raise _expired()
        s["connected"] = True
        return len(s["pages"])


def add_page(phone, fileobj):
    with _lock:
        _purge()
        pc = _phones.get(phone, "")
        s = _sessions.get(pc)
        if not s:
            raise _expired()
        if len(s["pages"]) >= MAX_PAGES:
            raise HTTPException(400, f"You can scan up to {MAX_PAGES} pages")
        n = s["next"]
        s["next"] += 1
        folder = s["dir"]

    data = fileobj.read(MAX_SIZE + 1)
    if len(data) > MAX_SIZE:
        raise HTTPException(413, "The photo is too large (max 20 MB)")
    try:
        img = Image.open(io.BytesIO(data))
        fmt, w, h = img.format, img.width, img.height
        if w * h > 50_000_000:
            raise ValueError
        img.verify()
        if fmt not in _EXT:
            raise ValueError
    except Exception:
        raise HTTPException(400, "This is not a valid JPG, PNG or WebP photo")

    name = f"{n}{_EXT[fmt]}"
    path = folder / name
    path.write_bytes(data)
    with _lock:
        if _sessions.get(pc) is not s:  # the session ended while uploading
            path.unlink(missing_ok=True)
            raise _expired()
        s["pages"].append({"id": n, "ext": _EXT[fmt], "name": name})
        return len(s["pages"])


def pc_status(pc):
    with _lock:
        _purge()
        s = _sessions.get(pc)
        if not s:
            raise _expired()
        return {"connected": s["connected"],
                "pages": [{"id": p["id"], "ext": p["ext"]} for p in s["pages"]]}


def page_path(pc, n):
    with _lock:
        s = _sessions.get(pc)
        if not s:
            raise _expired()
        for p in s["pages"]:
            if p["id"] == n:
                return s["dir"] / p["name"]
    raise HTTPException(404, "Page not found")


def close(pc):
    with _lock:
        _drop(pc)