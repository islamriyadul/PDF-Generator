from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from app.services import pdf_tools
from app.services import files as fs
from app.services import pdf_ops
from app.core.config import MAX_SIZE

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

@router.get("/ocr-languages")
def ocr_languages():
    return pdf_tools.list_ocr_languages()

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

@router.post("/compress-pdf")
def compress_pdf(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    level: str = Form("medium"),
):
    require_ext([file], (".pdf",))
    if level not in ("low", "medium", "high"):
        raise HTTPException(400, "Level must be low, medium or high")
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "compressed.pdf"
    try:
        pdf_tools.compress_pdf(src, level, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))
    return FileResponse(out, filename=Path(file.filename).stem + "_compressed.pdf")


@router.post("/repair-pdf")
def repair_pdf(background: BackgroundTasks, file: UploadFile = File(...)):
    require_ext([file], (".pdf",))
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "repaired.pdf"
    try:
        pdf_tools.repair_pdf(src, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))
    return FileResponse(out, filename=Path(file.filename).stem + "_repaired.pdf")


@router.post("/ocr-pdf")
def ocr_pdf(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    lang: str = Form("eng"),
):
    require_ext([file], (".pdf",))
    requested = lang.split("+")
    installed = set(pdf_tools.list_ocr_langs())
    if not (1 <= len(requested) <= 3) or any(l not in installed for l in requested):
        raise HTTPException(400, "Unsupported language")
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "ocr.pdf"
    try:
        pdf_tools.ocr_pdf(src, lang, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))
    return FileResponse(out, filename=Path(file.filename).stem + "_ocr.pdf")

@router.post("/pdf-to-pdfa")
def pdf_to_pdfa(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    part: int = Form(2),
):
    require_ext([file], (".pdf",))
    if part not in (1, 2, 3):
        raise HTTPException(400, "PDF/A part must be 1, 2 or 3")
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "pdfa.pdf"
    try:
        pdf_tools.pdf_to_pdfa(src, part, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))
    return FileResponse(out, filename=Path(file.filename).stem + "_pdfa.pdf")

@router.post("/remove-pages")
def remove_pages(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    pages: str = Form(...),
):
    require_ext([file], (".pdf",))
    job_dir = fs.new_job()
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "removed.pdf"
    try:
        pdf_ops.remove_pages(file.file, pages, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Remove failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_edited.pdf")


@router.post("/split-pdf")
def split_pdf(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    mode: str = Form("ranges"),
    value: str = Form(""),
):
    require_ext([file], (".pdf",))
    job_dir = fs.new_job()
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "split.zip"
    try:
        pdf_ops.split_pdf(file.file, mode, value, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Split failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_split.zip")

@router.post("/organize-pdf")
def organize_pdf(
    background: BackgroundTasks,
    files: list[UploadFile] = File(...),
    plan: str = Form(...),
):
    require_ext(files, (".pdf",))
    for f in files:
        if f.size and f.size > MAX_SIZE:
            raise HTTPException(413, f"{f.filename} is too large (max 20 MB)")
    job_dir = fs.new_job()
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "organized.pdf"
    try:
        pdf_ops.organize_pdf([f.file for f in files], plan, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Organize failed: {e}")
    name = Path(files[0].filename).stem + "_organized.pdf"
    return FileResponse(out, filename=name)

@router.post("/pdf-thumbnails")
def pdf_thumbnails(background: BackgroundTasks, file: UploadFile = File(...)):
    require_ext([file], (".pdf",))
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    try:
        return {"pages": pdf_ops.pdf_thumbnails(src)}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Preview failed: {e}")

@router.post("/pdf-pages")
def pdf_pages(background: BackgroundTasks, file: UploadFile = File(...)):
    require_ext([file], (".pdf",))
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    try:
        return {"pages": pdf_ops.pdf_pages(src)}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Preview failed: {e}")

@router.post("/sign-pdf")
def sign_pdf(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    signatures: list[UploadFile] = File(...),
    placements: str = Form(...),
):
    require_ext([file], (".pdf",))
    require_ext(signatures, (".png",))
    if len(signatures) > 10:
        raise HTTPException(400, "Too many different items (max 10)")
    images = []
    for s in signatures:
        data = s.file.read(2 * 1024 * 1024 + 1)
        if len(data) > 2 * 1024 * 1024:
            raise HTTPException(413, "An item image is too large (max 2 MB)")
        images.append(data)
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "signed.pdf"
    try:
        pdf_ops.sign_pdf(src, images, placements, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Signing failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_signed.pdf")


@router.post("/compare-pdf")
def compare_pdf(
    background: BackgroundTasks,
    file_a: UploadFile = File(...),
    file_b: UploadFile = File(...),
):
    require_ext([file_a, file_b], (".pdf",))
    job_a, src_a = fs.save_upload(file_a, ".pdf")
    background.add_task(fs.cleanup, job_a)
    job_b, src_b = fs.save_upload(file_b, ".pdf")
    background.add_task(fs.cleanup, job_b)
    try:
        return pdf_ops.compare_pdfs(src_a, src_b)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Compare failed: {e}")    