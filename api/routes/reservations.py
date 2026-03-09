from fastapi import APIRouter

router = APIRouter()

@router.post("/reservations")
def create_reservation(reservation: dict):

    return {"status":"reservation created"}