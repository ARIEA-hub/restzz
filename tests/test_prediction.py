# tests/test_prediction.py
# Run with: pytest tests/test_prediction.py -v

import sys
import os
import pytest

# Ensure project root is on the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load .env before the skipif below reads DATABASE_URL.
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))


# ── UNIT TESTS: predict_wait_time() ───────────────────────────────────

class TestPredictWaitTime:
    """Tests for src/models/predict_model.predict_wait_time()"""

    @pytest.fixture(autouse=True)
    def skip_if_no_model(self):
        """Skip tests if model file doesn't exist yet."""
        from src.utils.config import MODEL_PKL_PATH
        if not MODEL_PKL_PATH.exists():
            pytest.skip(f"Model not found at {MODEL_PKL_PATH}. Run train_model.py first.")

    def test_returns_float(self):
        from src.models.predict_model import predict_wait_time
        result = predict_wait_time(party_size=4, queue_length=5, tables_available=3)
        assert isinstance(result, float), "predict_wait_time should return a float"

    def test_positive_wait_time(self):
        from src.models.predict_model import predict_wait_time
        result = predict_wait_time(party_size=2, queue_length=3, tables_available=5)
        assert result >= 0, "Wait time should not be negative"

    def test_larger_queue_means_more_wait(self):
        """With no free tables, more people queuing should predict a longer wait.

        (Not true in general: under skip-ahead seating, a long queue WITH free
        tables means the waiting parties don't fit them, so a small party is
        seated at once — the tree correctly learns that.)"""
        from src.models.predict_model import predict_wait_time
        low_wait  = predict_wait_time(party_size=2, queue_length=1,  tables_available=0, hour_of_day=20, day_of_week=5)
        high_wait = predict_wait_time(party_size=2, queue_length=12, tables_available=0, hour_of_day=20, day_of_week=5)
        assert high_wait > low_wait, "Higher queue should result in longer predicted wait"

    def test_bigger_party_waits_at_least_as_long_when_busy(self):
        """Big parties compete for few big tables — the tree should learn that."""
        from src.models.predict_model import predict_wait_time
        small = predict_wait_time(party_size=2, queue_length=6, tables_available=1, hour_of_day=20, day_of_week=5)
        large = predict_wait_time(party_size=8, queue_length=6, tables_available=1, hour_of_day=20, day_of_week=5)
        assert large >= small

    def test_never_negative(self):
        from src.models.predict_model import predict_wait_time
        for q in range(0, 15, 3):
            assert predict_wait_time(party_size=1, queue_length=q, tables_available=12) >= 0

    def test_model_is_a_decision_tree(self):
        from src.models.predict_model import model_info
        assert model_info()["model"] == "DecisionTreeRegressor"

    def test_zero_queue_returns_result(self):
        from src.models.predict_model import predict_wait_time
        result = predict_wait_time(party_size=1, queue_length=0, tables_available=10)
        assert result is not None

    def test_one_decimal_precision(self):
        from src.models.predict_model import predict_wait_time
        result = predict_wait_time(party_size=3, queue_length=4, tables_available=2)
        assert result == round(result, 1), "Result should be rounded to 1 decimal"


# ── INTEGRATION TESTS: FastAPI /api/predict endpoint ─────────────────

class TestPredictEndpoint:
    """Tests for the FastAPI GET /api/predict endpoint."""

    @pytest.fixture(scope="class")
    def client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        return TestClient(app)

    def test_predict_returns_200(self, client):
        response = client.get("/api/predict?party_size=4&queue_length=5&tables_available=3")
        # 200 if model exists, 503 if model not trained yet — both are acceptable
        assert response.status_code in (200, 503)

    def test_predict_response_structure(self, client):
        response = client.get("/api/predict?party_size=2&queue_length=3&tables_available=4")
        if response.status_code == 200:
            data = response.json()
            assert "predicted_wait_time_minutes" in data
            assert "inputs" in data
            assert isinstance(data["predicted_wait_time_minutes"], float)

    def test_predict_invalid_party_size(self, client):
        response = client.get("/api/predict?party_size=0&queue_length=3&tables_available=4")
        assert response.status_code == 400

    def test_predict_missing_params(self, client):
        response = client.get("/api/predict?party_size=4")
        assert response.status_code == 422    # FastAPI validation error

    def test_predict_rejects_bad_hour(self, client):
        response = client.get("/api/predict?party_size=2&queue_length=1&tables_available=1&hour_of_day=25")
        assert response.status_code == 400

    def test_model_info(self, client):
        response = client.get("/api/model-info")
        assert response.status_code in (200, 503)
        if response.status_code == 200:
            assert response.json()["data_source"] in ("real", "synthetic")

    @pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="needs DATABASE_URL")
    def test_restaurants_endpoint(self, client):
        response = client.get("/api/restaurants")
        assert response.status_code == 200
        assert isinstance(response.json(), list)
