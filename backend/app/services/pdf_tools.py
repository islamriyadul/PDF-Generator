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

def list_ocr_langs() -> list[str]:
    tess = find_tesseract()
    if not tess:
        return []
    r = subprocess.run([tess, "--list-langs"], capture_output=True, text=True, timeout=20)
    lines = r.stdout.splitlines()[1:]  # first line is a header
    return [l.strip() for l in lines if l.strip() and l.strip() != "osd"]


LANG_NAMES = {
    "afr": "Afrikaans",
    "amh": "Amharic",
    "ara": "Arabic",
    "asm": "Assamese",
    "aze": "Azerbaijani",
    "aze_cyrl": "Azerbaijani (Cyrillic)",
    "bel": "Belarusian",
    "ben": "Bengali",
    "bod": "Tibetan",
    "bos": "Bosnian",
    "bre": "Breton",
    "bul": "Bulgarian",
    "cat": "Catalan",
    "ceb": "Cebuano",
    "ces": "Czech",
    "chi_sim": "Chinese (Simplified)",
    "chi_sim_vert": "Chinese (Simplified, vertical)",
    "chi_tra": "Chinese (Traditional)",
    "chi_tra_vert": "Chinese (Traditional, vertical)",
    "chr": "Cherokee",
    "cos": "Corsican",
    "cym": "Welsh",
    "dan": "Danish",
    "deu": "German",
    "deu_latf": "German (Fraktur)",
    "div": "Dhivehi",
    "dzo": "Dzongkha",
    "ell": "Greek",
    "eng": "English",
    "enm": "Middle English",
    "epo": "Esperanto",
    "equ": "Math / Equations (helper)",
    "est": "Estonian",
    "eus": "Basque",
    "fao": "Faroese",
    "fas": "Persian",
    "fil": "Filipino",
    "fin": "Finnish",
    "fra": "French",
    "frm": "Middle French",
    "fry": "Western Frisian",
    "gla": "Scottish Gaelic",
    "gle": "Irish",
    "glg": "Galician",
    "grc": "Ancient Greek",
    "guj": "Gujarati",
    "hat": "Haitian Creole",
    "heb": "Hebrew",
    "hin": "Hindi",
    "hrv": "Croatian",
    "hun": "Hungarian",
    "hye": "Armenian",
    "iku": "Inuktitut",
    "ind": "Indonesian",
    "isl": "Icelandic",
    "ita": "Italian",
    "ita_old": "Italian (Old)",
    "jav": "Javanese",
    "jpn": "Japanese",
    "jpn_vert": "Japanese (vertical)",
    "kan": "Kannada",
    "kat": "Georgian",
    "kat_old": "Georgian (Old)",
    "kaz": "Kazakh",
    "khm": "Khmer",
    "kir": "Kyrgyz",
    "kmr": "Kurdish (Kurmanji)",
    "kor": "Korean",
    "lao": "Lao",
    "lat": "Latin",
    "lav": "Latvian",
    "lit": "Lithuanian",
    "ltz": "Luxembourgish",
    "mal": "Malayalam",
    "mar": "Marathi",
    "mkd": "Macedonian",
    "mlt": "Maltese",
    "mon": "Mongolian",
    "mri": "Maori",
    "msa": "Malay",
    "mya": "Burmese",
    "nep": "Nepali",
    "nld": "Dutch",
    "nor": "Norwegian",
    "oci": "Occitan",
    "ori": "Odia",
    "osd": "Orientation detection (helper)",
    "pan": "Punjabi",
    "pol": "Polish",
    "por": "Portuguese",
    "pus": "Pashto",
    "que": "Quechua",
    "ron": "Romanian",
    "rus": "Russian",
    "san": "Sanskrit",
    "sin": "Sinhala",
    "slk": "Slovak",
    "slv": "Slovenian",
    "snd": "Sindhi",
    "spa": "Spanish",
    "spa_old": "Spanish (Old)",
    "sqi": "Albanian",
    "srp": "Serbian",
    "srp_latn": "Serbian (Latin)",
    "sun": "Sundanese",
    "swa": "Swahili",
    "swe": "Swedish",
    "syr": "Syriac",
    "tam": "Tamil",
    "tat": "Tatar",
    "tel": "Telugu",
    "tgk": "Tajik",
    "tha": "Thai",
    "tir": "Tigrinya",
    "ton": "Tongan",
    "tur": "Turkish",
    "uig": "Uyghur",
    "ukr": "Ukrainian",
    "urd": "Urdu",
    "uzb": "Uzbek",
    "uzb_cyrl": "Uzbek (Cyrillic)",
    "vie": "Vietnamese",
    "yid": "Yiddish",
    "yor": "Yoruba",
}

HELPER_CODES = {"osd", "equ"}  # data files, not real languages


def list_ocr_languages() -> list[dict]:
    codes = [c for c in list_ocr_langs() if c not in HELPER_CODES]
    result = [{"value": c, "label": LANG_NAMES.get(c, c)} for c in codes]
    return sorted(result, key=lambda x: x["label"])


def list_ocr_languages() -> list[dict]:
    return [
        {"value": code, "label": LANG_NAMES.get(code, code)}
        for code in list_ocr_langs()
        if code in LANG_NAMES
    ]