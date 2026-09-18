"""Dataset locations."""

from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
DATASETS_ROOT = REPO_ROOT / "NebulaX-Hackathon-ProblemStatement" / "PS3" / "02_Datasets"
ARTIFACTS_DIR = BACKEND_DIR / "artifacts"
