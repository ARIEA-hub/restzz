from fastapi import APIRouter
from src.models.predict_model import predict_wait_time

router = APIRouter()

@router.get("/predict")

def predict(party_size:int, queue_length:int, tables_available:int):

    wait_time = predict_wait_time(party_size, queue_length, tables_available)

    return {"predicted_wait_time": wait_time}