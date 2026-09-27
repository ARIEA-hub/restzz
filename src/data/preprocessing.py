# src/data/preprocessing.py

from src.utils.config import BASE_FEATURES, TARGET


def preprocess_data(df):
    df = df.dropna(subset=BASE_FEATURES + [TARGET]).copy()

    for col in BASE_FEATURES:
        df[col] = df[col].astype(int)
    df[TARGET] = df[TARGET].astype(float)

    # Negative waits are clock/entry errors; multi-hour waits are almost
    # always a party that was never marked seated on time.
    df = df[(df[TARGET] >= 0) & (df[TARGET] <= 240)]
    return df
