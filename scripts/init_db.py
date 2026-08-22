# scripts/init_db.py
# Run once to create all tables in your Supabase PostgreSQL database.
# Usage: python scripts/init_db.py
# Requires: pip install psycopg2-binary python-dotenv

import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise EnvironmentError("DATABASE_URL not set in .env")

conn = psycopg2.connect(DATABASE_URL)
cur  = conn.cursor()

SCHEMA = """
-- ================================================================
-- Q-Sense PostgreSQL Schema (Supabase)
-- ================================================================

CREATE TABLE IF NOT EXISTS restaurant (
    restaurant_id   SERIAL PRIMARY KEY,
    name            VARCHAR(255)    NOT NULL,
    location        VARCHAR(500),
    status          VARCHAR(20)     DEFAULT 'open' CHECK (status IN ('open','closed')),
    latitude        DECIMAL(10, 8),
    longitude       DECIMAL(11, 8),
    created_at      TIMESTAMPTZ     DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer (
    customer_id         SERIAL PRIMARY KEY,
    name                VARCHAR(255)    NOT NULL,
    email               VARCHAR(255)    UNIQUE NOT NULL,
    phone               VARCHAR(20),
    password            VARCHAR(255),
    is_guest            BOOLEAN         DEFAULT FALSE,
    is_verified         BOOLEAN         DEFAULT FALSE,  -- Flow D: account activation
    latitude            DECIMAL(10, 8),                -- Feature C: live location
    longitude           DECIMAL(11, 8),                -- Feature C: live location
    location_updated_at TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin (
    admin_id        SERIAL PRIMARY KEY,
    restaurant_id   INTEGER         REFERENCES restaurant(restaurant_id),
    name            VARCHAR(255)    NOT NULL,
    email           VARCHAR(255)    UNIQUE NOT NULL,
    phone           VARCHAR(20),
    password        VARCHAR(255),
    role            VARCHAR(50)     DEFAULT 'staff' CHECK (role IN ('owner','manager','staff')),
    is_verified     BOOLEAN         DEFAULT FALSE,     -- Flow D: account activation
    created_at      TIMESTAMPTZ     DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
    table_id        SERIAL PRIMARY KEY,
    restaurant_id   INTEGER         NOT NULL REFERENCES restaurant(restaurant_id),
    table_no        VARCHAR(20)     NOT NULL,
    capacity        INTEGER         DEFAULT 4,
    status          VARCHAR(20)     DEFAULT 'vacant'
                    CHECK (status IN ('vacant','occupied','reserved','unavailable')),
    updated_at      TIMESTAMPTZ     DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reservation (
    reserve_id      SERIAL PRIMARY KEY,
    customer_id     INTEGER         REFERENCES customer(customer_id),
    restaurant_id   INTEGER         NOT NULL REFERENCES restaurant(restaurant_id),
    table_id        INTEGER         REFERENCES restaurant_tables(table_id),
    group_size      INTEGER         NOT NULL,
    reserve_date    DATE            NOT NULL,
    reserve_time    TIME            NOT NULL,
    status          VARCHAR(20)     DEFAULT 'reserved'
                    CHECK (status IN ('reserved','seated','cancelled','completed')),
    created_at      TIMESTAMPTZ     DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queue (
    queue_id        SERIAL PRIMARY KEY,
    restaurant_id   INTEGER         NOT NULL REFERENCES restaurant(restaurant_id),
    customer_id     INTEGER         REFERENCES customer(customer_id),
    group_size      INTEGER         NOT NULL,
    status          VARCHAR(20)     DEFAULT 'waiting'
                    CHECK (status IN ('waiting','called','seated','left')),
    joined_at       TIMESTAMPTZ     DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_queue_restaurant_status   ON queue(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_reservation_customer      ON reservation(customer_id);
CREATE INDEX IF NOT EXISTS idx_reservation_restaurant    ON reservation(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_customer_email            ON customer(email);
CREATE INDEX IF NOT EXISTS idx_admin_email               ON admin(email);

-- Seed data (optional — remove if you want a clean slate)
INSERT INTO restaurant (name, location, status, latitude, longitude)
VALUES
    ('Bombay Bistro',    'Bandra West, Mumbai',     'open',   19.0596, 72.8295),
    ('Copper Chimney',   'Worli, Mumbai',            'open',   19.0175, 72.8132),
    ('Foo Bandra',       'Linking Road, Bandra',     'open',   19.0611, 72.8342)
ON CONFLICT DO NOTHING;
"""

try:
    cur.execute(SCHEMA)
    conn.commit()
    print("✅ Database schema created successfully.")
    print("   Tables: restaurant, customer, admin, restaurant_tables, reservation, queue")
except Exception as e:
    conn.rollback()
    print(f"❌ Schema creation failed: {e}")
finally:
    cur.close()
    conn.close()
