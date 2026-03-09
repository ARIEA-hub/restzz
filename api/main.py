from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def home():
    return {"message": "Restaurant Wait Time API Running"}