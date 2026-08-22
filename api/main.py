# api/main.py
# FastAPI application — ML prediction + data API

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from api.routes import restaurants, prediction, reservations, queue


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    print("✅ Q-Sense FastAPI started (ML prediction layer)")
    print(f"   DB connected: {'Yes' if os.environ.get('DATABASE_URL') else 'NO — DATABASE_URL not set!'}")
    yield
    print("FastAPI shutting down.")


app = FastAPI(
    title="Q-Sense ML API",
    description="Restaurant wait-time prediction and data layer",
    version="2.0.0",
    lifespan=lifespan
)

# CORS — allow the Express backend and frontend to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.environ.get("FRONTEND_ORIGIN", "http://127.0.0.1:5501"),
        "http://localhost:5000"    # Express backend may call this for wait-time predictions
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Include routers
app.include_router(restaurants.router,  prefix="/api",  tags=["Restaurants"])
app.include_router(prediction.router,   prefix="/api",  tags=["Prediction"])
app.include_router(reservations.router, prefix="/api",  tags=["Reservations"])
app.include_router(queue.router,        prefix="/api",  tags=["Queue"])


@app.get("/")
def home():
    return {
        "message": "Q-Sense ML API Running",
        "docs":    "/docs",
        "version": "2.0.0"
    }
