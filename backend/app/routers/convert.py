from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pdf2docx import Converter

from app.core.config import MAX_SIZE
from app.services import files as fs
from app.services.html_pdf import html_to_pdf
from app.services.office import office_to_pdf

router = APIRouter(prefix="/convert", tags=["convert"])


@router.post("/pdf-to-word")
def pdf_to_word(background: BackgroundTasks, file: UploadFile = File(...)):
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "output.docx"
    try:
        cv = Converter(str(src))
        cv.convert(str(out))
        cv.close()
    except Exception as e:
        raise HTTPException(500, f"Conversion failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + ".docx")


def _office_endpoint(background, file, exts):
    job_dir, src = fs.save_upload(file, exts)
    background.add_task(fs.cleanup, job_dir)
    try:
        out = office_to_pdf(src, job_dir)
    except Exception as e:
        raise HTTPException(500, f"Conversion failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + ".pdf")


@router.post("/word-to-pdf")
def word_to_pdf(background: BackgroundTasks, file: UploadFile = File(...)):
    return _office_endpoint(background, file, (".docx", ".doc"))


@router.post("/powerpoint-to-pdf")
def powerpoint_to_pdf(background: BackgroundTasks, file: UploadFile = File(...)):
    return _office_endpoint(background, file, (".pptx", ".ppt"))


@router.post("/excel-to-pdf")
def excel_to_pdf(background: BackgroundTasks, file: UploadFile = File(...)):
    return _office_endpoint(background, file, (".xlsx", ".xls"))


@router.post("/html-to-pdf")
def html_to_pdf_endpoint(background: BackgroundTasks, file: UploadFile = File(...)):
    if Path(file.filename).suffix.lower() not in (".html", ".htm"):
        raise HTTPException(400, "Please upload an .html file")
    raw = file.file.read(MAX_SIZE + 1)
    if len(raw) > MAX_SIZE:
        raise HTTPException(413, "File too large (max 20 MB)")
    job_dir = fs.new_job()
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "output.pdf"
    try:
        html_to_pdf(raw.decode("utf-8", errors="replace"), out)
    except Exception as e:
        raise HTTPException(500, f"Conversion failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + ".pdf")