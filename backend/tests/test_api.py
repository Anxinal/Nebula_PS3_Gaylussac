"""Tests for the HTTP API the frontend talks to.

The contract these lock down is written in ``frontend/README.md``; if a field
name here changes, the app silently renders empty charts, so the response shape
is asserted explicitly rather than just checking for a 200.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cdm import SUBSYSTEMS
from cdm.paths import ARTIFACTS_DIR, DATASETS_ROOT
from cdm.server import create_app

DATA = DATASETS_ROOT
HAS_MODELS = (ARTIFACTS_DIR / "rail_forest.joblib").exists()
HAS_DATA = DATA.exists()

needs_models = pytest.mark.skipif(not (HAS_MODELS and HAS_DATA),
                                  reason="trained models or dataset not available")


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as c:
        yield c


def _upload(path: Path) -> dict:
    return {"files": (path.name, path.read_bytes(), "application/octet-stream")}


# -- health ---------------------------------------------------------------
def test_health_reports_every_subsystem(client):
    body = client.get("/health").json()
    assert body["status"] in {"ok", "loading"}
    # The app keys its per-subsystem fallback off exactly these names.
    assert set(body["models"]) == set(SUBSYSTEMS)
    assert all(isinstance(v, bool) for v in body["models"].values())


# -- input validation -----------------------------------------------------
def test_unknown_subsystem_is_404(client):
    response = client.post("/predict/bogus", files=_upload(Path(__file__)))
    assert response.status_code == 404
    assert "unknown subsystem" in response.json()["detail"]


def test_unsupported_extension_is_rejected(client, tmp_path):
    bad = tmp_path / "notes.txt"
    bad.write_text("hello")
    response = client.post("/predict/rail", files=_upload(bad))
    assert response.status_code == 400
    assert ".csv or .xlsx" in response.json()["detail"]


def test_missing_files_is_an_error(client):
    assert client.post("/predict/rail").status_code == 422


@needs_models
def test_file_for_the_wrong_subsystem_is_refused_with_a_useful_message(client):
    """Routing a rail file to /predict/door must not silently produce nonsense."""
    response = client.post("/predict/door", files=_upload(DATA / "Rail_Corrugation/Test/Test1.csv"))
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "looks like a rail file" in detail
    assert "/predict/rail" in detail  # tells the caller where it belongs


@needs_models
def test_unrecognised_file_is_refused(client):
    response = client.post("/predict/rail", files=_upload(DATA / "Rail_Corrugation/Train_Labels.csv"))
    assert response.status_code == 400
    assert "does not look like any known subsystem" in response.json()["detail"]


# -- response contract ----------------------------------------------------
@needs_models
def test_rail_response_matches_the_documented_contract(client):
    body = client.post("/predict/rail",
                       files=_upload(DATA / "Rail_Corrugation/Test/Test13.csv")).json()
    entry = body["files"][0]
    assert entry["file_id"] == "Test13.csv"
    assert entry["prediction"] in {"Normal", "Side I", "Side II"}
    for key in ("confidence", "side_i", "side_ii", "n_rows", "speed_kmh"):
        assert key in entry
    assert entry["n_rows"] == 10000  # 1 s at 10 kHz
    # prediction and explanation are separate fields, not one blob
    assert "explanation" in entry and entry["explanation"]["top_nodes"]


@needs_models
def test_shm_response_matches_the_documented_contract(client):
    body = client.post("/predict/shm", files=_upload(DATA / "SHM/Test/test02.csv")).json()
    entry = body["files"][0]
    assert isinstance(entry["prediction"], float) and entry["prediction"] > 0
    assert entry["cycles"] > 0 and entry["max_range"] > 0
    assert entry["bins"] and {"rangeMid", "cycles", "damage"} <= set(entry["bins"][0])
    assert entry["explanation"]["extra_terms"]["miner_anchor_log"]


@needs_models
def test_acv_response_matches_the_documented_contract(client):
    body = client.post("/predict/acv", files=_upload(DATA / "ACV/Test/acv_test_case.xlsx")).json()
    entry = body["files"][0]
    assert len(entry["ranked_cars"]) == 8
    # Car ids must be the file's own two-digit form, e.g. "03" not "Car 3".
    assert all(car.isdigit() and len(car) == 2 for car in entry["ranked_cars"])
    assert set(entry["scores"]) == set(entry["ranked_cars"])
    assert set(entry["evidence"]) == set(entry["ranked_cars"])
    assert entry["sample_count"] > 0 and entry["series"]


@needs_models
def test_door_response_matches_the_documented_contract(client):
    body = client.post("/predict/door", files=_upload(DATA / "Door/Test.csv")).json()
    assert body["segments"] and body["trace"]
    assert body["total_rows"] > 0 and body["duration_sec"] > 0
    segment = body["segments"][0]
    for key in ("start_time", "end_time", "prediction", "operation",
                "mean_current", "margin", "n_rows"):
        assert key in segment
    assert segment["prediction"] in {"Normal", "Abnormal resistance"}
    assert segment["operation"] in {"Open", "Close"}
    # Native dataset timestamp format, which the app parses directly.
    assert segment["start_time"].startswith("2023-")


@needs_models
def test_batch_upload_returns_one_entry_per_file(client):
    files = [
        ("files", (p.name, p.read_bytes(), "text/csv"))
        for p in [DATA / "Rail_Corrugation/Test/Test1.csv",
                  DATA / "Rail_Corrugation/Test/Test2.csv"]
    ]
    body = client.post("/predict/rail", files=files).json()
    assert body["n_files"] == 2
    assert [f["file_id"] for f in body["files"]] == ["Test1.csv", "Test2.csv"]


@needs_models
def test_prediction_matches_the_offline_pipeline(client):
    """The API must not be a second implementation that drifts from the CLI."""
    from cdm.pipeline import HierarchicalPipeline

    path = DATA / "Rail_Corrugation/Test/Test13.csv"
    offline = HierarchicalPipeline.load().experts["rail"].submission_rows([path])
    served = client.post("/predict/rail", files=_upload(path)).json()["files"][0]
    assert served["prediction"] == offline.prediction.iloc[0]


# -- CORS -----------------------------------------------------------------
def test_cors_allows_the_browser_origin(client):
    response = client.options(
        "/predict/rail",
        headers={"Origin": "https://example.github.io",
                 "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 200
    assert "access-control-allow-origin" in {k.lower() for k in response.headers}
