import pandas as pd

def preprocess_data(df):

    df = df.dropna()

    df["party_size"] = df["party_size"].astype(int)
    df["queue_length"] = df["queue_length"].astype(int)

    return df