# src/models/predict_model.py
# Loads the trained scikit-learn model and exposes predict_wait_time()

import os
import joblib
import pandas as pd

# Build absolute path to model file relative to this file's location
# This prevents FileNotFoundError when called from different working directories
_PROJECT_ROOT  = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_MODEL_PATH    = os.path.join(_PROJECT_ROOT, "models", "wait_time_model.pkl")

# Lazy-load the model on first call (not at import time)
_model = None


def _load_model():
    global _model
    if _model is None:
        if not os.path.exists(_MODEL_PATH):
            raise FileNotFoundError(
                f"Model not found at: {_MODEL_PATH}\n"
                "Run: python src/models/train_model.py"
            )
        _model = joblib.load(_MODEL_PATH)
    return _model


def predict_wait_time(party_size: int, queue_length: int, tables_available: int) -> float:
    """
    Predicts wait time in minutes using the trained LinearRegression model.

    Args:
        party_size:       Number of people in the group
        queue_length:     Current number of groups waiting
        tables_available: Number of vacant tables

    Returns:
        float: Predicted wait time in minutes (rounded to 1 decimal place)
    """
    model = _load_model()

    queue_per_table = queue_length / (tables_available + 1)

    data = pd.DataFrame(
        [[party_size, queue_length, tables_available, queue_per_table]],
        columns=["party_size", "queue_length", "tables_available", "queue_per_table"]
    )

    prediction = model.predict(data)
    return round(float(prediction[0]), 1)
