from fastapi import FastAPI


app = FastAPI()
from api.routes import restaurants
app.include_router(restaurants.router)

@app.get("/")
def home():
    return {"message": "Restaurant Wait Time API Running"}
