from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.core.config import MAX_SIZE
from app.services import files as fs
from app.services import pdf_ops
from app.services import pdf_tools
from app.services import scan_sessions

router = APIRouter(prefix="/tools", tags=["tools"])


def require_ext(files: list[UploadFile], exts: tuple[str, ...]) -> None:
    for f in files:
        if not f.filename.lower().endswith(exts):
            raise HTTPException(400, f"{f.filename}: unsupported file type")


# ---------------- merge, extract, images ----------------
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
def image_to_pdf(
    background: BackgroundTasks,
    files: list[UploadFile] = File(...),
    size: str = Form("a4"),
    orientation: str = Form("auto"),
    margin: str = Form("small"),
    separate: str = Form("false"),
):
    require_ext(files, (".jpg", ".jpeg", ".png", ".webp"))
    for f in files:
        if f.size and f.size > MAX_SIZE:
            raise HTTPException(413, f"{f.filename} is too large (max 20 MB)")
    sep = separate == "true"
    job_dir = fs.new_job()
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / ("images.zip" if sep else "images.pdf")
    try:
        pdf_ops.images_to_pdf([f.file for f in files], out, size, orientation, margin, sep)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Conversion failed: {e}")
    return FileResponse(out, filename="images.zip" if sep else "images.pdf")


# ---------------- OCR languages ----------------
@router.get("/ocr-languages")
def ocr_languages():
    return pdf_tools.list_ocr_languages()


# ---------------- rotate, protect, unlock ----------------
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


# ---------------- compress, repair, OCR, PDF/A ----------------
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


# ---------------- remove pages, split ----------------
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


# ---------------- organize ----------------
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


# ---------------- sign, compare, redact ----------------
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


@router.post("/redact-pdf")
def redact_pdf(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    terms: str = Form(""),
    patterns: str = Form(""),
    boxes: str = Form("[]"),
):
    require_ext([file], (".pdf",))
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "redacted.pdf"
    try:
        pdf_ops.redact_pdf(src, terms, patterns, boxes, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Redaction failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_redacted.pdf")  

@router.post("/crop-pdf")
def crop_pdf(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    box: str = Form(...),
    pages: str = Form(""),
):
    require_ext([file], (".pdf",))
    job_dir = fs.new_job()
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "cropped.pdf"
    try:
        pdf_ops.crop_pdf(file.file, box, pages, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Crop failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_cropped.pdf")


@router.post("/pdf-edit-info")
def pdf_edit_info(background: BackgroundTasks, file: UploadFile = File(...)):
    require_ext([file], (".pdf",))
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    try:
        return {"pages": pdf_ops.pdf_edit_info(src)}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Preview failed: {e}")


@router.post("/edit-pdf")
def edit_pdf(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    ops: str = Form(...),
):
    require_ext([file], (".pdf",))
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "edited.pdf"
    try:
        pdf_ops.edit_pdf(src, ops, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Edit failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_edited.pdf") 


@router.post("/add-page-numbers")
def add_page_numbers(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    position: str = Form("bc"),
    fmt: str = Form("n"),
    start: str = Form("1"),
    size: str = Form("11"),
    margin: str = Form("36"),
    color: str = Form("#000000"),
    pages: str = Form(""),
):
    require_ext([file], (".pdf",))
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "numbered.pdf"
    try:
        pdf_ops.add_page_numbers(src, position, fmt, start, size, margin, color, pages, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Page numbering failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_numbered.pdf")


@router.post("/add-watermark")
def add_watermark(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    text: str = Form(...),
    size: str = Form("64"),
    color: str = Form("#888888"),
    opacity: str = Form("30"),
    angle: str = Form("45"),
    layout: str = Form("center"),
    position: str = Form("over"),
    pages: str = Form(""),
):
    require_ext([file], (".pdf",))
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "watermarked.pdf"
    try:
        pdf_ops.add_watermark(src, text, size, color, opacity, angle, layout, position, pages, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Watermark failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_watermarked.pdf")


@router.post("/pdf-form-info")
def pdf_form_info(background: BackgroundTasks, file: UploadFile = File(...)):
    require_ext([file], (".pdf",))
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    try:
        return {"pages": pdf_ops.pdf_form_info(src)}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Preview failed: {e}")


@router.post("/fill-pdf-form")
def fill_pdf_form(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    values: str = Form(...),
    flatten: str = Form("false"),
):
    require_ext([file], (".pdf",))
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "filled.pdf"
    try:
        pdf_ops.fill_pdf_form(src, values, flatten == "true", out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Filling failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_filled.pdf")


@router.post("/flatten-pdf")
def flatten_pdf(background: BackgroundTasks, file: UploadFile = File(...)):
    require_ext([file], (".pdf",))
    job_dir, src = fs.save_upload(file, ".pdf")
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "flattened.pdf"
    try:
        pdf_ops.flatten_form(src, out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Flatten failed: {e}")
    return FileResponse(out, filename=Path(file.filename).stem + "_flattened.pdf")


@router.post("/scan-to-pdf")
def scan_to_pdf(
    background: BackgroundTasks,
    files: list[UploadFile] = File(...),
    plan: str = Form(...),
    size: str = Form("a4"),
    margin: str = Form("small"),
    ocr: str = Form("false"),
    lang: str = Form("eng"),
):
    require_ext(files, (".jpg", ".jpeg", ".png", ".webp"))
    for f in files:
        if f.size and f.size > MAX_SIZE:
            raise HTTPException(413, f"{f.filename} is too large (max 20 MB)")
    use_ocr = ocr == "true"
    if use_ocr:
        requested = lang.split("+")
        installed = set(pdf_tools.list_ocr_langs())
        if not (1 <= len(requested) <= 3) or any(l not in installed for l in requested):
            raise HTTPException(400, "Unsupported language")

    job_dir = fs.new_job()
    background.add_task(fs.cleanup, job_dir)
    out = job_dir / "scan.pdf"
    try:
        pdf_ops.scan_to_pdf([f.file for f in files], plan, out, size, margin)
        if use_ocr:
            searchable = job_dir / "scan_ocr.pdf"
            pdf_tools.ocr_pdf(out, lang, searchable)
            out = searchable
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Scan failed: {e}")
    return FileResponse(out, filename="scan.pdf")

@router.post("/scan-session")
def scan_session_create():
    pc, phone = scan_sessions.create()
    return {"pc": pc, "phone": phone, "lan_ip": scan_sessions.lan_ip()}


@router.get("/scan-session/{pc}")
def scan_session_status(pc: str):
    return scan_sessions.pc_status(pc)


@router.get("/scan-session/{pc}/page/{n}")
def scan_session_page(pc: str, n: int):
    return FileResponse(scan_sessions.page_path(pc, n))


@router.delete("/scan-session/{pc}")
def scan_session_close(pc: str):
    scan_sessions.close(pc)
    return {"ok": True}


@router.get("/scan-phone/{phone}/status")
def scan_phone_status(phone: str):
    return {"count": scan_sessions.phone_status(phone)}


@router.post("/scan-phone/{phone}/upload")
def scan_phone_upload(phone: str, file: UploadFile = File(...)):
    return {"count": scan_sessions.add_page(phone, file.file)}

@router.get("/lan-ip")
def lan_ip():
    return {"ip": scan_sessions.lan_ip()}
