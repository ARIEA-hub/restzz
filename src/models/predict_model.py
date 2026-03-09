import joblib
import pandas as pd

model = joblib.load("models/wait_time_model.pkl")

def predict_wait_time(party_size, queue_length, tables_available):

    queue_per_table = queue_length / (tables_available + 1)

    data = pd.DataFrame([[party_size, queue_length, tables_available, queue_per_table]],
                        columns=["party_size","queue_length","tables_available","queue_per_table"])

    prediction = model.predict(data)

    return float(prediction[0])