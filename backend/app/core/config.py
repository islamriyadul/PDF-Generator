from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]  # the backend folder
TMP_DIR = BASE_DIR / "tmp"
TMP_DIR.mkdir(exist_ok=True)

MAX_SIZE = 20 * 1024 * 1024  # 20 MB
ALLOWED_ORIGINS = ["http://localhost:5173"]