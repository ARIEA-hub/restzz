# api/routes/prediction.py
# FastAPI wait-time prediction endpoint
# Uses the trained scikit-learn model from models/wait_time_model.pkl

import os
import sys
from fastapi import APIRouter, HTTPException

# Ensure project root is in Python path so src/ imports resolve
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

router = APIRouter()


@router.get("/predict")
def predict(party_size: int, queue_length: int, tables_available: int):
    """
    Predicts restaurant wait time using the trained ML model.

    Parameters (query string):
        party_size:       Number of people in the party (>= 1)
        queue_length:     Current number of groups waiting
        tables_available: Number of vacant tables right now

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

    try:
        from src.models.predict_model import predict_wait_time
        wait_time = predict_wait_time(party_size, queue_length, tables_available)
        return {
            "predicted_wait_time_minutes": round(wait_time, 1),
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
