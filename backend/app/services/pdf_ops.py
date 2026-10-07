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