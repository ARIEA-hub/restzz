-- scripts/migrate_ml_features.sql
-- Run once in the Supabase SQL Editor (existing databases only; fresh
-- installs get these columns from scripts/init_db.py).
--
-- Lets the wait-time decision tree train on REAL history instead of the
-- simulation:
--   * queue_length_at_join / tables_vacant_at_join — the model's features,
--     snapshotted when a party joins (they can't be reconstructed later).
--   * seated_at — when the party was seated; the label is seated_at − joined_at.
-- All nullable, so existing rows and code paths are unaffected.

ALTER TABLE queue ADD COLUMN IF NOT EXISTS queue_length_at_join  INTEGER;
ALTER TABLE queue ADD COLUMN IF NOT EXISTS tables_vacant_at_join INTEGER;
ALTER TABLE queue ADD COLUMN IF NOT EXISTS seated_at             TIMESTAMPTZ;

-- K-means peak-hour analytics scans reservations/queue by restaurant and time.
CREATE INDEX IF NOT EXISTS idx_queue_restaurant_joined ON queue(restaurant_id, joined_at);
