from pathlib import Path

from playwright.sync_api import sync_playwright


def html_to_pdf(html: str, out: Path) -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        # JavaScript off, and all network requests blocked, so an uploaded
        # HTML file can't call other sites or your internal network
        context = browser.new_context(java_script_enabled=False)
        page = context.new_page()
        page.route(
            "**/*",
            lambda route: route.abort()
            if route.request.url.startswith(("http:", "https:", "file:", "ftp:"))
            else route.continue_(),
        )
        page.set_content(html, wait_until="load")
        page.pdf(
            path=str(out), format="A4", print_background=True,
            margin={"top": "15mm", "bottom": "15mm", "left": "12mm", "right": "12mm"},
        )
        browser.close()