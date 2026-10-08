import glob
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path

import pymupdf

MAX_OCR_PAGES = 30
_ocr_lock = threading.Lock()  # OCR is heavy, so run one job at a time


def _find_exe(names, windows_globs):
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    for pattern in windows_globs:
        matches = sorted(glob.glob(pattern))
        if matches:
            return matches[-1]
    return None


def find_gs():
    return _find_exe(["gswin64c", "gs"], [r"C:\Program Files\gs\gs*\bin\gswin64c.exe"])


def find_tesseract():
    return _find_exe(["tesseract"], [r"C:\Program Files\Tesseract-OCR\tesseract.exe"])


def _check_open(src: Path) -> int:
    try:
        doc = pymupdf.open(src)
    except Exception:
        raise ValueError("This file is not a valid PDF")
    try:
        if doc.needs_pass:
            raise ValueError("This PDF is password protected. Unlock it first")
        return doc.page_count
    finally:
        doc.close()


def compress_pdf(src: Path, level: str, out: Path) -> None:
    _check_open(src)
    gs = find_gs()
    if not gs:
        raise RuntimeError("Ghostscript is not installed on the server")
    setting = {"low": "/printer", "medium": "/ebook", "high": "/screen"}[level]
    result = subprocess.run(
        [gs, "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5",
         f"-dPDFSETTINGS={setting}", "-dNOPAUSE", "-dQUIET", "-dBATCH", "-dSAFER",
         f"-sOutputFile={out}", str(src)],
        capture_output=True, timeout=180,
    )
    if result.returncode != 0 or not out.exists():
        raise RuntimeError("Compression failed")
    if out.stat().st_size >= src.stat().st_size:
        shutil.copyfile(src, out)  # never return a bigger file than the original


def repair_pdf(src: Path, out: Path) -> None:
    try:
        doc = pymupdf.open(src)  # PyMuPDF rebuilds broken structure on open
        try:
            if doc.needs_pass:
                raise ValueError("This PDF is password protected. Unlock it first")
            if doc.page_count == 0:
                raise RuntimeError("no pages")
            doc.save(out, garbage=4, deflate=True, clean=True)
            return
        finally:
            doc.close()
    except ValueError:
        raise
    except Exception:
        pass  # fall back to Ghostscript below

    gs = find_gs()
    if gs:
        result = subprocess.run(
            [gs, "-sDEVICE=pdfwrite", "-dNOPAUSE", "-dQUIET", "-dBATCH", "-dSAFER",
             f"-sOutputFile={out}", str(src)],
            capture_output=True, timeout=180,
        )
        if result.returncode == 0 and out.exists() and out.stat().st_size > 0:
            return
    raise ValueError("This PDF is too damaged to repair")


def ocr_pdf(src: Path, lang: str, out: Path) -> None:
    pages = _check_open(src)
    if pages > MAX_OCR_PAGES:
        raise ValueError(f"Too many pages for OCR (max {MAX_OCR_PAGES})")
    tess, gs = find_tesseract(), find_gs()
    if not tess or not gs:
        raise RuntimeError("OCR needs Tesseract and Ghostscript installed on the server")

    env = os.environ.copy()
    env["PATH"] = os.pathsep.join(
        [str(Path(tess).parent), str(Path(gs).parent), env.get("PATH", "")]
    )
    cmd = [sys.executable, "-m", "ocrmypdf", "--skip-text", "--output-type", "pdf",
           "--jobs", "2", "-l", lang, str(src), str(out)]
    with _ocr_lock:
        result = subprocess.run(cmd, capture_output=True, timeout=600, env=env)

    if result.returncode == 0 and out.exists():
        return
    messages = {
        2: "This file is not a valid PDF",
        3: "OCR engine or language data is missing on the server",
        8: "This PDF is password protected. Unlock it first",
    }
    raise ValueError(messages.get(result.returncode, "OCR failed")) \
        if result.returncode in (2, 8) else RuntimeError(messages.get(result.returncode, "OCR failed"))