-- Adds 'no_show' as a valid reservation status for existing databases
-- (fresh installs via init_db.py already have this from the schema).
-- Needed for the admin customer-behavior-summary feature, which was
-- previously impossible to build meaningfully since there was no way
-- to record a no-show at all.
--
-- Safe to re-run — looks up the actual constraint name rather than
-- assuming it, since Postgres auto-generates it and a hardcoded guess
-- could be wrong depending on how the table was created.

DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'reservation'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%status%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE reservation DROP CONSTRAINT %I', constraint_name);
    END IF;

    ALTER TABLE reservation
        ADD CONSTRAINT reservation_status_check
        CHECK (status IN ('reserved','seated','cancelled','completed','no_show'));
END $$;

-- Confirm it worked
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'reservation'::regclass AND contype = 'c';
