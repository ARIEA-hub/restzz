# src/models/predict_model.py
# Loads the trained decision tree and exposes predict_wait_time()

import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import joblib
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from src.features.feature_engineering import create_features
from src.utils.config import MODEL_META_PATH, MODEL_PKL_PATH

# Lazy-load the model on first call (not at import time)
_model = None
_meta = None


def _load_model():
    global _model, _meta
    if _model is None:
        if not MODEL_PKL_PATH.exists():
            raise FileNotFoundError(
                f"Model not found at: {MODEL_PKL_PATH}\n"
                "Run: python src/models/train_model.py"
            )
        _model = joblib.load(MODEL_PKL_PATH)
        _meta = json.loads(MODEL_META_PATH.read_text()) if MODEL_META_PATH.exists() else {}
    return _model, _meta


def model_info():
    _, meta = _load_model()
    return {k: v for k, v in meta.items() if k != "rules_preview"}


def predict_wait_time(party_size: int, queue_length: int, tables_available: int,
                      hour_of_day: int = None, day_of_week: int = None) -> float:
    """
    Predicted wait in minutes from the decision tree.

    hour_of_day (0-23) and day_of_week (0=Mon .. 6=Sun) default to now, in
    the restaurant's local time (RESTAURANT_TZ, default Asia/Kolkata) — the
    same clock the model was trained on.
    """
    model, meta = _load_model()
    now = datetime.now(ZoneInfo(os.environ.get("RESTAURANT_TZ", "Asia/Kolkata")))
    row = pd.DataFrame([{
        "party_size": party_size,
        "queue_length": queue_length,
        "tables_available": tables_available,
        "hour_of_day": now.hour if hour_of_day is None else hour_of_day,
        "day_of_week": now.weekday() if day_of_week is None else day_of_week,
    }])
    features = meta.get("features") or list(model.feature_names_in_)
    prediction = model.predict(create_features(row)[features])
    return round(max(0.0, float(prediction[0])), 1)
