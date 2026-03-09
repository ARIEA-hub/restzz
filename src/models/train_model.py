import joblib
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor

from src.data.data_loader import load_data
from src.data.preprocessing import preprocess_data
from src.features.feature_engineering import create_features


data = load_data("data/raw/restaurant_wait_times.csv")

data = preprocess_data(data)

data = create_features(data)

X = data[["party_size", "queue_length", "tables_available", "queue_per_table"]]

y = data["wait_time"]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

model = RandomForestRegressor()

model.fit(X_train, y_train)

joblib.dump(model, "models/wait_time_model.pkl")