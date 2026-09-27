# src/features/feature_engineering.py

def create_features(df):
    df = df.copy()
    # Parties competing for each free table (+1 so zero free tables is finite).
    df["queue_per_table"] = df["queue_length"] / (df["tables_available"] + 1)
    return df
