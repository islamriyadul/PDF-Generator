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

@router.post("/rotate-pdf")
def rotate_pdf(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    angle: int = Form(...),
    pages: str = Form(""),
):
    require_ext([file], (".pdf",))
    if angle not in (90, 180, 270):
        raise HTTPException(400, "Angle must be 90, 180 or 270")
    job_dir = fs.new_job()
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "rotated.pdf"
    try:
        pdf_ops.rotate_pdf(file.file, angle, pages, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Rotation failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_rotated.pdf")


@router.post("/protect-pdf")
def protect_pdf(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    password: str = Form(...),
):
    require_ext([file], (".pdf",))
    if not password:
        raise HTTPException(400, "Password is required")
    job_dir = fs.new_job()
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "protected.pdf"
    try:
        pdf_ops.protect_pdf(file.file, password, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Protection failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_protected.pdf")


@router.post("/unlock-pdf")
def unlock_pdf(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    password: str = Form(...),
):
    require_ext([file], (".pdf",))
    job_dir = fs.new_job()
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "unlocked.pdf"
    try:
        pdf_ops.unlock_pdf(file.file, password, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Unlock failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_unlocked.pdf")