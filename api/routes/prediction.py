# api/routes/prediction.py
# FastAPI wait-time prediction endpoint
# Serves the DecisionTreeRegressor trained by src/models/train_model.py
# (models/wait_time_model.pkl). The Express backend calls this from
# GET /api/queue/status and falls back to its 5-min-per-party rule if this
# service is down.

import os
import sys
from typing import Optional

from fastapi import APIRouter, HTTPException

# Ensure project root is in Python path so src/ imports resolve
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

router = APIRouter()


@router.get("/predict")
def predict(party_size: int, queue_length: int, tables_available: int,
            hour_of_day: Optional[int] = None, day_of_week: Optional[int] = None):
    """
    Predicts restaurant wait time using the trained ML model.

    Parameters (query string):
        party_size:       Number of people in the party (>= 1)
        queue_length:     Current number of groups waiting
        tables_available: Number of vacant tables right now
        hour_of_day:      0-23 (optional, defaults to now)
        day_of_week:      0=Mon .. 6=Sun (optional, defaults to now)

    Returns:
        predicted_wait_time: float (minutes)

    Example:
        GET /api/predict?party_size=4&queue_length=8&tables_available=2
    """
    if party_size < 1:
        raise HTTPException(status_code=400, detail="party_size must be >= 1")
    if queue_length < 0:
        raise HTTPException(status_code=400, detail="queue_length must be >= 0")
    if tables_available < 0:
        raise HTTPException(status_code=400, detail="tables_available must be >= 0")
    if hour_of_day is not None and not 0 <= hour_of_day <= 23:
        raise HTTPException(status_code=400, detail="hour_of_day must be 0-23")
    if day_of_week is not None and not 0 <= day_of_week <= 6:
        raise HTTPException(status_code=400, detail="day_of_week must be 0-6")

    try:
        from src.models.predict_model import predict_wait_time
        wait_time = predict_wait_time(party_size, queue_length, tables_available, hour_of_day, day_of_week)
        return {
            "predicted_wait_time_minutes": round(wait_time, 1),
            "model": "DecisionTreeRegressor",
            "inputs": {
                "party_size":       party_size,
                "queue_length":     queue_length,
                "tables_available": tables_available
            }
        }
    except FileNotFoundError:
        raise HTTPException(
            status_code=503,
            detail="ML model not found. Run 'python src/models/train_model.py' first."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@router.get("/model-info")
def get_model_info():
    """Training metadata: data source (real vs. synthetic), metrics, feature importances."""
    try:
        from src.models.predict_model import model_info
        return model_info()
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="ML model not trained yet.")
