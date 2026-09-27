# src/data/data_loader.py
# Training-data sources for the wait-time model.

import os

import pandas as pd

from src.utils.config import DATABASE_URL, SYNTHETIC_CSV_PATH, TARGET, BASE_FEATURES


def load_data(path):
    return pd.read_csv(path)


# Features are snapshotted into the queue row when a party joins
# (queue_length_at_join, tables_vacant_at_join — see
# scripts/migrate_ml_features.sql) and the label is seated_at − joined_at.
# Reconstructing "how many tables were free at 19:42 last Tuesday" after the
# fact isn't possible, which is why they're captured at join time.
REAL_DATA_SQL = """
    SELECT q.group_size                                   AS party_size,
           q.queue_length_at_join                         AS queue_length,
           q.tables_vacant_at_join                        AS tables_available,
           EXTRACT(HOUR FROM q.joined_at AT TIME ZONE %(tz)s)::int           AS hour_of_day,
           ((EXTRACT(ISODOW FROM q.joined_at AT TIME ZONE %(tz)s)::int) - 1) AS day_of_week,
           EXTRACT(EPOCH FROM (q.seated_at - q.joined_at)) / 60.0 AS wait_time
    FROM queue q
    WHERE q.status = 'seated'
      AND q.seated_at IS NOT NULL
      AND q.queue_length_at_join IS NOT NULL
      AND q.tables_vacant_at_join IS NOT NULL
      AND q.seated_at >= q.joined_at
"""


def load_real_data():
    """Real history from the queue table, or None if unavailable."""
    if not DATABASE_URL:
        return None
    try:
        import psycopg2
        with psycopg2.connect(DATABASE_URL) as conn:
            # Local restaurant time — timestamptz comes back in UTC otherwise.
            tz = os.environ.get("RESTAURANT_TZ", "Asia/Kolkata")
            return pd.read_sql_query(REAL_DATA_SQL, conn, params={"tz": tz})
    except Exception as exc:  # missing columns (migration not run), no network, ...
        print(f"  (real data unavailable: {exc.__class__.__name__}: {str(exc).splitlines()[0]})")
        return None


def load_synthetic_data():
    if not SYNTHETIC_CSV_PATH.exists():
        raise FileNotFoundError(
            f"{SYNTHETIC_CSV_PATH} not found. Run: python scripts/simulate_wait_data.py"
        )
    return pd.read_csv(SYNTHETIC_CSV_PATH)[BASE_FEATURES + [TARGET]]
