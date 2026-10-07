import subprocess
from pathlib import Path

from app.services.files import find_soffice


def office_to_pdf(src: Path, job_dir: Path) -> Path:
    # Separate profile per job so two conversions can run at the same time
    profile = (job_dir / "lo_profile").as_uri()
    result = subprocess.run(
        [find_soffice(), f"-env:UserInstallation={profile}",
         "--headless", "--convert-to", "pdf",
         "--outdir", str(job_dir), str(src)],
        capture_output=True, timeout=120,
    )
    out = job_dir / (src.stem + ".pdf")
    if result.returncode != 0 or not out.exists():
        raise RuntimeError("LibreOffice conversion failed")
    return out