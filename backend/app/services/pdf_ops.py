import io
import re

from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Emu, Pt
import zipfile

import pymupdf
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

MAX_IMAGE_PAGES = 50


def pdf_to_images(src: Path, dpi: int, job_dir: Path) -> Path:
    doc = pymupdf.open(src)
    try:
        if doc.needs_pass:
            raise ValueError("This PDF is password protected. Unlock it first")
        total = doc.page_count
        if total > MAX_IMAGE_PAGES:
            raise ValueError(f"Too many pages (max {MAX_IMAGE_PAGES}). Extract fewer pages first")
        zoom = dpi / 72
        matrix = pymupdf.Matrix(zoom, zoom)

        if total == 1:
            out = job_dir / "page_1.jpg"
            pix = doc[0].get_pixmap(matrix=matrix, alpha=False)
            out.write_bytes(pix.tobytes("jpg", jpg_quality=90))
            return out

        out = job_dir / "pages.zip"
        with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
            for i, page in enumerate(doc, start=1):
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                z.writestr(f"page_{i}.jpg", pix.tobytes("jpg", jpg_quality=90))
        return out
    finally:
        doc.close()  

MAX_TABLE_PAGES = 100
_ILLEGAL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def pdf_to_excel(src: Path, out: Path) -> None:
    doc = pymupdf.open(src)
    try:
        if doc.needs_pass:
            raise ValueError("This PDF is password protected. Unlock it first")
        if doc.page_count > MAX_TABLE_PAGES:
            raise ValueError(f"Too many pages (max {MAX_TABLE_PAGES})")
        wb = Workbook()
        wb.remove(wb.active)
        found = 0
        for pno, page in enumerate(doc, start=1):
            for tno, table in enumerate(page.find_tables().tables, start=1):
                rows = table.extract()
                if not rows:
                    continue
                found += 1
                ws = wb.create_sheet(f"P{pno}_T{tno}")
                for r, row in enumerate(rows, start=1):
                    for c, value in enumerate(row, start=1):
                        if value is None:
                            continue
                        value = _ILLEGAL.sub("", str(value))
                        cell = ws.cell(row=r, column=c, value=value)
                        cell.data_type = "s"  # keep text as text, never as a formula
        if found == 0:
            raise ValueError(
                "No tables found. This tool needs a PDF with real tables "
                "(scanned PDFs are not supported)"
            )
        wb.save(out)
    finally:
        doc.close()

MAX_SHAPES = 400  # keeps heavy vector pages from creating thousands of shapes


def _rgb_int(value: int) -> RGBColor:
    return RGBColor((value >> 16) & 255, (value >> 8) & 255, value & 255)


def _rgb_float(color) -> RGBColor:
    return RGBColor(*(int(round(c * 255)) for c in color[:3]))


def _in_boxes(bbox, boxes) -> bool:
    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    return any(b[0] <= cx <= b[2] and b[1] <= cy <= b[3] for b in boxes)


def _build_editable_slide(page, slide, left, top, scale):
    pt = 12700

    def size(v):
        return Emu(int(v * pt * scale))

    def X(x):
        return Emu(int(left + x * pt * scale))

    def Y(y):
        return Emu(int(top + y * pt * scale))

    tables = page.find_tables().tables
    table_boxes = [t.bbox for t in tables]
    blocks = page.get_text("dict")["blocks"]

    # 1. Images (bottom layer)
    for b in blocks:
        if b["type"] == 1 and b.get("image"):
            x0, y0, x1, y1 = b["bbox"]
            try:
                slide.shapes.add_picture(
                    io.BytesIO(b["image"]), X(x0), Y(y0), size(x1 - x0), size(y1 - y0)
                )
            except Exception:
                pass  # skip image formats PowerPoint can't take

    # 2. Shapes: filled rectangles and straight lines
    count = 0
    for d in page.get_drawings():
        if count >= MAX_SHAPES:
            break
        r = d["rect"]
        if _in_boxes(tuple(r), table_boxes):
            continue  # table borders are rebuilt as a real table below
        items = d["items"]
        fill, stroke = d.get("fill"), d.get("color")
        width = Pt(max((d.get("width") or 1) * scale, 0.5))

        if items and all(i[0] == "re" for i in items):
            shape = slide.shapes.add_shape(
                MSO_SHAPE.RECTANGLE, X(r.x0), Y(r.y0),
                size(max(r.width, 0.5)), size(max(r.height, 0.5)),
            )
            if fill:
                shape.fill.solid()
                shape.fill.fore_color.rgb = _rgb_float(fill)
            else:
                shape.fill.background()
            if stroke:
                shape.line.color.rgb = _rgb_float(stroke)
                shape.line.width = width
            else:
                shape.line.fill.background()
            shape.shadow.inherit = False
            count += 1
        elif len(items) == 1 and items[0][0] == "l" and stroke:
            p1, p2 = items[0][1], items[0][2]
            line = slide.shapes.add_connector(
                MSO_CONNECTOR.STRAIGHT, X(p1.x), Y(p1.y), X(p2.x), Y(p2.y)
            )
            line.line.color.rgb = _rgb_float(stroke)
            line.line.width = width
            count += 1
        # curves, gradients and complex paths are skipped in this version

    # 3. Real tables
    for t in tables:
        rows = t.extract()
        if not rows:
            continue
        x0, y0, x1, y1 = t.bbox
        n_rows, n_cols = len(rows), max(len(r) for r in rows)
        graphic = slide.shapes.add_table(
            n_rows, n_cols, X(x0), Y(y0), size(x1 - x0), size(y1 - y0)
        )
        for r_i, row in enumerate(rows):
            for c_i in range(n_cols):
                value = row[c_i] if c_i < len(row) and row[c_i] is not None else ""
                cell = graphic.table.cell(r_i, c_i)
                cell.text = _ILLEGAL.sub("", str(value))
                for para in cell.text_frame.paragraphs:
                    for run in para.runs:
                        run.font.size = Pt(max(10 * scale, 6))

    # 4. Text boxes (top layer), skipping text that is inside a table
    for b in blocks:
        if b["type"] != 0 or not b["lines"] or _in_boxes(b["bbox"], table_boxes):
            continue
        x0, y0, x1, y1 = b["bbox"]
        box = slide.shapes.add_textbox(
            X(x0), Y(y0), Emu(int(size(x1 - x0) * 1.05)), size(y1 - y0)
        )
        frame = box.text_frame
        frame.word_wrap = False
        frame.margin_left = frame.margin_right = 0
        frame.margin_top = frame.margin_bottom = 0
        first = True
        for line in b["lines"]:
            para = frame.paragraphs[0] if first else frame.add_paragraph()
            first = False
            for span in line["spans"]:
                text = _ILLEGAL.sub("", span["text"])
                if not text:
                    continue
                run = para.add_run()
                run.text = text
                run.font.size = Pt(max(span["size"] * scale, 4))
                run.font.bold = bool(span["flags"] & 16)
                run.font.italic = bool(span["flags"] & 2)
                run.font.name = span["font"].split("+")[-1]
                run.font.color.rgb = _rgb_int(span["color"])
def pdf_to_pptx(src: Path, mode: str, out: Path) -> None:
    doc = pymupdf.open(src)
    try:
        if doc.needs_pass:
            raise ValueError("This PDF is password protected. Unlock it first")
        if doc.page_count > MAX_IMAGE_PAGES:
            raise ValueError(f"Too many pages (max {MAX_IMAGE_PAGES})")

        pt = 12700  # EMU per point
        first = doc[0].rect
        slide_w, slide_h = first.width * pt, first.height * pt
        prs = Presentation()
        prs.slide_width, prs.slide_height = Emu(int(slide_w)), Emu(int(slide_h))
        blank = prs.slide_layouts[6]

        for page in doc:
            rect = page.rect
            scale = min(slide_w / (rect.width * pt), slide_h / (rect.height * pt))
            left = (slide_w - rect.width * pt * scale) / 2
            top = (slide_h - rect.height * pt * scale) / 2
            slide = prs.slides.add_slide(blank)

            if mode == "image":
                zoom = 150 / 72
                pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
                slide.shapes.add_picture(
                    io.BytesIO(pix.tobytes("jpg", jpg_quality=85)),
                    Emu(int(left)), Emu(int(top)),
                    Emu(int(rect.width * pt * scale)), Emu(int(rect.height * pt * scale)),
                )
            else:
                _build_editable_slide(page, slide, left, top, scale)
        prs.save(out)
    finally:
        doc.close()