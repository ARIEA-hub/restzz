-- scripts/seed_table_layouts.sql
-- Gives each restaurant its own floor layout. Before this, every restaurant
-- had the identical six tables: T1:2 T2:2 T3:4 T4:4 T5:6 T6:8.
--
-- Every layout still mixes 2-, 4- and 6-seat tables, so the seating rule
-- (a party of 2 gets a 2-seater, or the next size up, never a bigger table
-- while a smaller one that fits is free) has real choices to make.
--
-- Safe to re-run: resizes only VACANT tables (an occupied or reserved table
-- keeps its size until it frees up) and inserts tables only if missing.
-- Nothing is deleted, because reservation.table_id references these rows.
--
-- Resulting layouts (T1..Tn):
--   1 Q-Sense HQ Diner  large, mixed:   2 2 2 4 6 6 4 6 8
--   2 Bombay Bistro     mid-size:       2 4 4 4 6 6
--   3 Copper Chimney    family dining:  2 2 4 6 6 8 8
--   4 Foo Bandra        couples/small:  2 2 4 2 4 6 2
--   5 Veranda Bandra    original six +: 2 2 4 4 6 8 4
--   6 The Nest Bandra   cafe:           2 2 2 4 6 6

BEGIN;

WITH layout(restaurant_id, table_no, capacity) AS (VALUES
    (1, 'T3', 2), (1, 'T6', 6),
    (2, 'T2', 4), (2, 'T6', 6),
    (3, 'T4', 6),
    (4, 'T4', 2), (4, 'T5', 4), (4, 'T6', 6),
    (6, 'T3', 2), (6, 'T6', 6)
)
UPDATE restaurant_tables t
SET capacity = l.capacity
FROM layout l
WHERE t.restaurant_id = l.restaurant_id
  AND t.table_no = l.table_no
  AND t.status = 'vacant'
  AND t.capacity <> l.capacity;

INSERT INTO restaurant_tables (restaurant_id, table_no, capacity, status)
SELECT n.restaurant_id, n.table_no, n.capacity, 'vacant'
FROM (VALUES
    (1, 'T7', 4), (1, 'T8', 6), (1, 'T9', 8),
    (3, 'T7', 8),
    (4, 'T7', 2),
    (5, 'T7', 4)
) AS n(restaurant_id, table_no, capacity)
WHERE EXISTS (SELECT 1 FROM restaurant r WHERE r.restaurant_id = n.restaurant_id)
  AND NOT EXISTS (
      SELECT 1 FROM restaurant_tables t
      WHERE t.restaurant_id = n.restaurant_id AND t.table_no = n.table_no
  );

COMMIT;

-- Check the result
SELECT restaurant_id, string_agg(table_no || ':' || capacity, ' ' ORDER BY table_no) AS layout
FROM restaurant_tables
GROUP BY restaurant_id
ORDER BY restaurant_id;
