# src/models/train_model.py
#
# Trains the wait-time model: a DecisionTreeRegressor (supervised learning).
#
#   python src/models/train_model.py            # auto: real DB data if enough, else simulation
#   python src/models/train_model.py --source synthetic
#   python src/models/train_model.py --source real
#
# Hyperparameters (max_depth, min_samples_leaf) are chosen by 5-fold
# cross-validation. The model is compared on a held-out test set against the
# rule the app used before (5 minutes per party ahead), so "is the tree
# actually better?" is answered with a number, not assumed.
#
# Outputs:
#   models/wait_time_model.pkl   the fitted tree (joblib)
#   models/wait_time_model.json  metadata: features, data source, metrics,
#                                and the top of the tree as readable rules

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import joblib
import numpy as np
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GridSearchCV, train_test_split
from sklearn.tree import DecisionTreeRegressor, export_text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from src.data.data_loader import load_real_data, load_synthetic_data
from src.data.preprocessing import preprocess_data
from src.features.feature_engineering import create_features
from src.utils.config import (FEATURES, MIN_REAL_ROWS, MODEL_META_PATH, MODEL_PKL_PATH,
                              MODELS_DIR, RANDOM_STATE, TARGET, TEST_SIZE)


def choose_data(source):
    if source in ("auto", "real"):
        real = load_real_data()
        n = 0 if real is None else len(real)
        if n >= MIN_REAL_ROWS:
            return real, "real"
        if source == "real":
            raise SystemExit(f"Only {n} usable real rows (need {MIN_REAL_ROWS}).")
        print(f"  {n} real rows (< {MIN_REAL_ROWS}) - falling back to simulated data.")
    return load_synthetic_data(), "synthetic"


def baseline_minutes(df):
    """The rule the app used before this model: 5 min per party, counting yourself."""
    return (df["queue_length"] + 1) * 5


def train(source="auto"):
    raw, used = choose_data(source)
    df = create_features(preprocess_data(raw))
    print(f"Training on {len(df)} rows of {used} data.")

    X, y = df[FEATURES], df[TARGET]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE)

    search = GridSearchCV(
        DecisionTreeRegressor(random_state=RANDOM_STATE),
        param_grid={"max_depth": [3, 4, 5, 6, 8, 10], "min_samples_leaf": [5, 10, 20, 40]},
        scoring="neg_mean_absolute_error",
        cv=5,
    )
    search.fit(X_train, y_train)
    model = search.best_estimator_

    pred = np.clip(model.predict(X_test), 0, None)
    base = baseline_minutes(X_test)
    metrics = {
        "test_mae_minutes": round(float(mean_absolute_error(y_test, pred)), 2),
        "test_r2": round(float(r2_score(y_test, pred)), 3),
        "baseline_mae_minutes": round(float(mean_absolute_error(y_test, base)), 2),
        "cv_mae_minutes": round(float(-search.best_score_), 2),
    }
    importances = {f: round(float(v), 3) for f, v in sorted(
        zip(FEATURES, model.feature_importances_), key=lambda kv: -kv[1])}

    os.makedirs(MODELS_DIR, exist_ok=True)
    joblib.dump(model, MODEL_PKL_PATH)
    meta = {
        "model": "DecisionTreeRegressor",
        "features": FEATURES,
        "target": TARGET,
        "data_source": used,
        "rows": int(len(df)),
        "best_params": search.best_params_,
        "depth": int(model.get_depth()),
        "leaves": int(model.get_n_leaves()),
        "metrics": metrics,
        "feature_importances": importances,
        "rules_preview": export_text(model, feature_names=FEATURES, max_depth=3, decimals=1),
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    MODEL_META_PATH.write_text(json.dumps(meta, indent=2))

    print(f"  best params: {search.best_params_} (depth {meta['depth']}, {meta['leaves']} leaves)")
    print(f"  test MAE {metrics['test_mae_minutes']} min vs. old 5-min-per-party rule "
          f"{metrics['baseline_mae_minutes']} min, R^2 {metrics['test_r2']}")
    print(f"  feature importances: {importances}")
    print(f"Saved {MODEL_PKL_PATH} and {MODEL_META_PATH.name}")
    return model, meta


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["auto", "real", "synthetic"], default="auto")
    train(parser.parse_args().source)
