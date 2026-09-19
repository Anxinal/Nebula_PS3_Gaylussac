#!/usr/bin/env python
"""Run the model API for the frontend.

    python serve.py                          # http://127.0.0.1:8000
    python serve.py --host 0.0.0.0 --port 8080
    python serve.py --origins https://anxinal.github.io
    python serve.py --static ../frontend/dist    # app + API on one origin

Endpoints are documented in cdm/server.py and frontend/README.md.
Interactive API docs are served at /docs once running.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cdm.server import main  # noqa: E402

if __name__ == "__main__":
    main()
