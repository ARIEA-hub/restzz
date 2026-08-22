# tests/test_prediction.py
# Run with: pytest tests/test_prediction.py -v

import sys
import os
import pytest

# Ensure project root is on the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


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
        """More people queuing should predict a longer wait."""
        from src.models.predict_model import predict_wait_time
        low_wait  = predict_wait_time(party_size=2, queue_length=1,  tables_available=10)
        high_wait = predict_wait_time(party_size=2, queue_length=20, tables_available=2)
        assert high_wait > low_wait, "Higher queue should result in longer predicted wait"

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

    def test_restaurants_endpoint(self, client):
        response = client.get("/api/restaurants")
        assert response.status_code == 200
        assert isinstance(response.json(), list)
