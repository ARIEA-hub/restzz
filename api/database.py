# api/database.py
# PostgreSQL connection for FastAPI routes (Supabase)
# Was: hardcoded mysql+pymysql://root:password@localhost/restaurant_db

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise EnvironmentError(
        "DATABASE_URL is not set. Add it to your .env file.\n"
        "Format: postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"
    )

# SQLAlchemy does not accept postgresql+asyncpg:// in sync mode.
# The Supabase URI sometimes starts with "postgres://" — normalise it:
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,         # Automatically reconnect if connection drops
    pool_size=5,
    max_overflow=10,
    connect_args={
        "sslmode": "require"    # Supabase requires SSL
    }
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models."""
    pass


def get_db():
    """
    FastAPI dependency — yields a DB session and guarantees cleanup.

    Usage in a route:
        from api.database import get_db
        from sqlalchemy.orm import Session
        from fastapi import Depends

        @router.get("/example")
        def example(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
