from fastapi import FastAPI
from api.routes.prediction import router

app = FastAPI()

app.include_router(router)