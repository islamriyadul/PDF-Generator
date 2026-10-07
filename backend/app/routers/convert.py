import subprocess
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pdf2docx import Converter

from app.services import files as fs

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


@router.post("/word-to-pdf")
def word_to_pdf(background: BackgroundTasks, file: UploadFile = File(...)):
    job_dir, src = fs.save_upload(file, ".docx")
    background.add_task(fs.cleanup, job_dir)
    result = subprocess.run(
        [fs.find_soffice(), "--headless", "--convert-to", "pdf",
         "--outdir", str(job_dir), str(src)],
        capture_output=True, timeout=120,
    )
    out = job_dir / "input.pdf"
    if result.returncode != 0 or not out.exists():
        raise HTTPException(500, "Conversion failed")
    return FileResponse(out, filename=Path(file.filename).stem + ".pdf")