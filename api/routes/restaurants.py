from fastapi import APIRouter

router = APIRouter()

restaurants = [
    {"id":1,"name":"Bombay Bistro","wait_time":20},
    {"id":2,"name":"Spice Garden","wait_time":15}
]

@router.get("/restaurants")
def get_restaurants():
    return restaurants