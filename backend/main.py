import shutil
import subprocess
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pdf2docx import Converter

app = FastAPI(title="PDF Generator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TMP_DIR = Path("tmp")
TMP_DIR.mkdir(exist_ok=True)
MAX_SIZE = 20 * 1024 * 1024  # 20 MB


def find_soffice() -> str:
    path = shutil.which("soffice") or shutil.which("libreoffice")
    if not path:
        win = Path(r"C:\Program Files\LibreOffice\program\soffice.exe")
        if win.exists():
            path = str(win)
    if not path:
        raise HTTPException(500, "LibreOffice is not installed on the server")
    return path


def save_upload(file: UploadFile, ext: str) -> tuple[Path, Path]:
    if not file.filename.lower().endswith(ext):
        raise HTTPException(400, f"Please upload a {ext} file")
    job_dir = TMP_DIR / uuid.uuid4().hex
    job_dir.mkdir()
    src = job_dir / f"input{ext}"
    with src.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    if src.stat().st_size > MAX_SIZE:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(413, "File too large (max 20 MB)")
    return job_dir, src


def cleanup(path: Path):
    shutil.rmtree(path, ignore_errors=True)


@app.get("/")
def read_root():
    return {"message": "Backend is running"}


@app.post("/convert/pdf-to-word")
def pdf_to_word(background: BackgroundTasks, file: UploadFile = File(...)):
    job_dir, src = save_upload(file, ".pdf")
    background.add_task(cleanup, job_dir)
    out = job_dir / "output.docx"
    try:
        cv = Converter(str(src))
        cv.convert(str(out))
        cv.close()
    except Exception as e:
        raise HTTPException(500, f"Conversion failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + ".docx")


@app.post("/convert/word-to-pdf")
def word_to_pdf(background: BackgroundTasks, file: UploadFile = File(...)):
    job_dir, src = save_upload(file, ".docx")
    background.add_task(cleanup, job_dir)
    result = subprocess.run(
        [find_soffice(), "--headless", "--convert-to", "pdf",
         "--outdir", str(job_dir), str(src)],
        capture_output=True, timeout=120,
    )
    out = job_dir / "input.pdf"
    if result.returncode != 0 or not out.exists():
        raise HTTPException(500, "Conversion failed")
    return FileResponse(out, filename=Path(file.filename).stem + ".pdf")