from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from pypdf import PdfReader, PdfWriter
from PIL import Image
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
def new_job() -> Path:
    job_dir = TMP_DIR / uuid.uuid4().hex
    job_dir.mkdir()
    return job_dir


def parse_pages(spec: str, total: int) -> list[int]:
    """'1-3,5' -> [0, 1, 2, 4] (zero-based, validated)."""
    pages = []
    for part in spec.replace(" ", "").split(","):
        if not part:
            continue
        try:
            if "-" in part:
                a, b = part.split("-")
                start, end = int(a), int(b)
            else:
                start = end = int(part)
        except ValueError:
            raise HTTPException(400, f"Invalid page range: '{part}'")
        if start < 1 or end < start or end > total:
            raise HTTPException(400, f"Pages must be between 1 and {total}")
        pages.extend(range(start - 1, end))
    if not pages:
        raise HTTPException(400, "No pages selected")
    return pages


@app.post("/tools/merge-pdf")
def merge_pdf(background: BackgroundTasks, files: list[UploadFile] = File(...)):
    if len(files) < 2:
        raise HTTPException(400, "Upload at least 2 PDF files")
    job_dir = new_job()
    background.add_task(cleanup, job_dir)
    writer = PdfWriter()
    try:
        for f in files:
            if not f.filename.lower().endswith(".pdf"):
                raise HTTPException(400, f"{f.filename} is not a PDF")
            writer.append(PdfReader(f.file))
        out = job_dir / "merged.pdf"
        with out.open("wb") as fh:
            writer.write(fh)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Merge failed: {e}")
    return FileResponse(out, filename="merged.pdf")


@app.post("/tools/extract-pages")
def extract_pages(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    pages: str = Form(...),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Please upload a PDF file")
    job_dir = new_job()
    background.add_task(cleanup, job_dir)
    try:
        reader = PdfReader(file.file)
        writer = PdfWriter()
        for i in parse_pages(pages, len(reader.pages)):
            writer.add_page(reader.pages[i])
        out = job_dir / "extracted.pdf"
        with out.open("wb") as fh:
            writer.write(fh)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Extraction failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_pages.pdf")


@app.post("/tools/image-to-pdf")
def image_to_pdf(background: BackgroundTasks, files: list[UploadFile] = File(...)):
    job_dir = new_job()
    background.add_task(cleanup, job_dir)
    try:
        images = []
        for f in files:
            if not f.filename.lower().endswith((".jpg", ".jpeg", ".png")):
                raise HTTPException(400, f"{f.filename} is not a JPG or PNG")
            images.append(Image.open(f.file).convert("RGB"))
        out = job_dir / "images.pdf"
        images[0].save(out, save_all=True, append_images=images[1:])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Conversion failed: {e}")
    return FileResponse(out, filename="images.pdf")