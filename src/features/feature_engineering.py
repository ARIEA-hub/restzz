def create_features(df):

    df["queue_per_table"] = df["queue_length"] / (df["tables_available"] + 1)

    return df