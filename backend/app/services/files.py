import shutil
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.core.config import MAX_SIZE, TMP_DIR


def new_job() -> Path:
    job_dir = TMP_DIR / uuid.uuid4().hex
    job_dir.mkdir()
    return job_dir


def cleanup(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


def save_upload(file: UploadFile, exts) -> tuple[Path, Path]:
    if isinstance(exts, str):
        exts = (exts,)
    suffix = Path(file.filename).suffix.lower()
    if suffix not in exts:
        raise HTTPException(400, f"Please upload a {' or '.join(exts)} file")
    job_dir = new_job()
    src = job_dir / f"input{suffix}"
    with src.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    if src.stat().st_size > MAX_SIZE:
        cleanup(job_dir)
        raise HTTPException(413, "File too large (max 20 MB)")
    return job_dir, src


def find_soffice() -> str:
    path = shutil.which("soffice") or shutil.which("libreoffice")
    candidates = [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ]
    if not path:
        path = next((c for c in candidates if Path(c).exists()), None)
    if not path:
        raise HTTPException(500, "LibreOffice is not installed on the server")
    return path