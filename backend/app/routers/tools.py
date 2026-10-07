from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.services import files as fs
from app.services import pdf_ops

router = APIRouter(prefix="/tools", tags=["tools"])


def require_ext(files: list[UploadFile], exts: tuple[str, ...]) -> None:
    for f in files:
        if not f.filename.lower().endswith(exts):
            raise HTTPException(400, f"{f.filename}: unsupported file type")


@router.post("/merge-pdf")
def merge_pdf(background: BackgroundTasks, files: list[UploadFile] = File(...)):
    if len(files) < 2:
        raise HTTPException(400, "Upload at least 2 PDF files")
    require_ext(files, (".pdf",))
    job_dir = fs.new_job()
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "merged.pdf"
    try:
        pdf_ops.merge_pdfs([f.file for f in files], out)
    except Exception as e:
        raise HTTPException(500, f"Merge failed: {e}")
    return FileResponse(out, filename="merged.pdf")


@router.post("/extract-pages")
def extract_pages(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    pages: str = Form(...),
):
    require_ext([file], (".pdf",))
    job_dir = fs.new_job()
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "extracted.pdf"
    try:
        pdf_ops.extract_pages(file.file, pages, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Extraction failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_pages.pdf")


@router.post("/image-to-pdf")
def image_to_pdf(background: BackgroundTasks, files: list[UploadFile] = File(...)):
    require_ext(files, (".jpg", ".jpeg", ".png"))
    job_dir = fs.new_job()
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "images.pdf"
    try:
        pdf_ops.images_to_pdf([f.file for f in files], out)
    except Exception as e:
        raise HTTPException(500, f"Conversion failed: {e}")
    return FileResponse(out, filename="images.pdf")