# src/utils/config.py
# Centralised project configuration and path constants

import os
from pathlib import Path
from dotenv import load_dotenv

# Resolve project root (2 levels up from src/utils/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

load_dotenv(PROJECT_ROOT / ".env")

# ── PATH CONSTANTS ─────────────────────────────────────────────────────
DATA_DIR       = PROJECT_ROOT / "data" / "raw"
MODELS_DIR     = PROJECT_ROOT / "models"
NOTEBOOKS_DIR  = PROJECT_ROOT / "notebooks"

RAW_CSV_PATH   = DATA_DIR   / "restaurant_wait_times.csv"
MODEL_PKL_PATH = MODELS_DIR / "wait_time_model.pkl"

# ── ENVIRONMENT ────────────────────────────────────────────────────────
DATABASE_URL   = os.environ.get("DATABASE_URL", "")
JWT_SECRET     = os.environ.get("JWT_SECRET", "")
EMAIL_USER     = os.environ.get("EMAIL_USER", "")

# ── TRAINING CONFIG ────────────────────────────────────────────────────
FEATURES       = ["party_size", "queue_length", "tables_available", "queue_per_table"]
TARGET         = "wait_time"
TEST_SIZE      = 0.2
RANDOM_STATE   = 42
