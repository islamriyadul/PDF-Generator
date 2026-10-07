import subprocess
import threading
from pathlib import Path

from app.core.config import BASE_DIR
from app.services.files import find_soffice

_PROFILE = (BASE_DIR / "lo_profile").resolve().as_uri()
_lock = threading.Lock()


def office_to_pdf(src: Path, job_dir: Path) -> Path:
    with _lock:  # one LibreOffice conversion at a time
        result = subprocess.run(
            [find_soffice(), f"-env:UserInstallation={_PROFILE}",
             "--headless", "--norestore", "--convert-to", "pdf",
             "--outdir", str(job_dir), str(src)],
            capture_output=True, timeout=120,
        )
    out = job_dir / (src.stem + ".pdf")
    if result.returncode != 0 or not out.exists():
        raise RuntimeError("LibreOffice conversion failed")
    return out