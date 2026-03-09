import pandas as pd
from sklearn.linear_model import LinearRegression
import pickle
import os

# Load dataset
df = pd.read_csv("data/raw/restaurant_wait_times.csv")

X = df[["party_size", "queue_length", "tables_available"]]
y = df["wait_time"]

# Train model
model = LinearRegression()
model.fit(X, y)

# Create models folder if not exists
os.makedirs("models", exist_ok=True)

# Save model
with open("models/wait_time_model.pkl", "wb") as f:
    pickle.dump(model, f)

print("Model trained and saved successfully.")