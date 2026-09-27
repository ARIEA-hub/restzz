# api/main.py
# FastAPI application — ML prediction + data API

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from api.routes import prediction

# The restaurants router needs DATABASE_URL at import time (api/database.py
# raises without it). Prediction must not depend on the database, so the
# ML service still starts — and still predicts — when the DB is unavailable.
try:
    from api.routes import restaurants
except EnvironmentError as exc:
    restaurants = None
    print(f"[warn] Restaurant routes disabled: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    print("[ok] Q-Sense FastAPI started (ML prediction layer)")
    print(f"   DB connected: {'Yes' if os.environ.get('DATABASE_URL') else 'NO - DATABASE_URL not set!'}")
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
# (reservations/queue are served by the Express backend, not here — the
# modules this file used to import for them never existed.)
app.include_router(prediction.router,   prefix="/api",  tags=["Prediction"])
if restaurants is not None:
    app.include_router(restaurants.router, prefix="/api", tags=["Restaurants"])


@app.get("/")
def home():
    return {
        "message": "Q-Sense ML API Running",
        "docs":    "/docs",
        "version": "2.0.0"
    }
