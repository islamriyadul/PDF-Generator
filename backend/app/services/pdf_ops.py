from pathlib import Path

from PIL import Image
from pypdf import PdfReader, PdfWriter


def parse_pages(spec: str, total: int) -> list[int]:
    """'1-3,5' -> [0, 1, 2, 4]. Raises ValueError on bad input."""
    pages = []
    for part in spec.replace(" ", "").split(","):
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-")
            start, end = int(a), int(b)
        else:
            start = end = int(part)
        if start < 1 or end < start or end > total:
            raise ValueError(f"Pages must be between 1 and {total}")
        pages.extend(range(start - 1, end))
    if not pages:
        raise ValueError("No pages selected")
    return pages


def merge_pdfs(streams: list, out: Path) -> None:
    writer = PdfWriter()
    for s in streams:
        writer.append(PdfReader(s))
    with out.open("wb") as fh:
        writer.write(fh)


def extract_pages(stream, spec: str, out: Path) -> None:
    reader = PdfReader(stream)
    writer = PdfWriter()
    for i in parse_pages(spec, len(reader.pages)):
        writer.add_page(reader.pages[i])
    with out.open("wb") as fh:
        writer.write(fh)


def images_to_pdf(streams: list, out: Path) -> None:
    images = [Image.open(s).convert("RGB") for s in streams]
    images[0].save(out, save_all=True, append_images=images[1:])

    def rotate_pdf(stream, angle: int, spec: str, out: Path) -> None:
    reader = PdfReader(stream)
    writer = PdfWriter()
    total = len(reader.pages)
    targets = set(parse_pages(spec, total)) if spec.strip() else set(range(total))
    for i, page in enumerate(reader.pages):
        if i in targets:
            page.rotate(angle)  # clockwise
        writer.add_page(page)
    with out.open("wb") as fh:
        writer.write(fh)


def protect_pdf(stream, password: str, out: Path) -> None:
    reader = PdfReader(stream)
    if reader.is_encrypted:
        raise ValueError("This PDF is already password protected")
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.encrypt(user_password=password, algorithm="AES-256")
    with out.open("wb") as fh:
        writer.write(fh)


def unlock_pdf(stream, password: str, out: Path) -> None:
    reader = PdfReader(stream)
    if not reader.is_encrypted:
        raise ValueError("This PDF is not password protected")
    if reader.decrypt(password) == 0:
        raise ValueError("Wrong password")
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    with out.open("wb") as fh:
        writer.write(fh)