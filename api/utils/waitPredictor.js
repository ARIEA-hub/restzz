// api/utils/waitPredictor.js
//
// Bridge from Express to the FastAPI decision-tree service (api/main.py,
// GET /api/predict). If that service is down, slow, or untrained, every
// caller falls back to the rule the app always used — 5 minutes per party
// ahead, counting yourself — and says so via `source`, so the UI never
// presents the rule-of-thumb as a model prediction.
//
// Also owns the "ML columns" feature check: queue.queue_length_at_join,
// tables_vacant_at_join and seated_at only exist after
// scripts/migrate_ml_features.sql has been run. Until then, joins and
// seating work exactly as before; they just don't record training data.

const db = require('../database');

const ML_API_URL = process.env.ML_API_URL || 'http://localhost:8000';
const TIMEOUT_MS = 1500;
const MIN_PER_PARTY = 5;

function fallbackMinutes(peopleAhead) {
    return (peopleAhead + 1) * MIN_PER_PARTY;
}

/**
 * @returns {Promise<{ minutes: number, source: 'decision_tree' | 'fallback' }>}
 */
async function predictWait({ partySize, peopleAhead, tablesAvailable }) {
    try {
        const params = new URLSearchParams({
            party_size: String(Math.max(1, partySize)),
            queue_length: String(peopleAhead),
            tables_available: String(tablesAvailable)
        });
        const res = await fetch(`${ML_API_URL}/api/predict?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`ML service HTTP ${res.status}`);
        const data = await res.json();
        const minutes = Number(data.predicted_wait_time_minutes);
        if (!Number.isFinite(minutes)) throw new Error('ML service returned no prediction');
        return { minutes: Math.round(minutes), source: 'decision_tree' };
    } catch (error) {
        return { minutes: fallbackMinutes(peopleAhead), source: 'fallback' };
    }
}

let mlColumnsPromise = null;

/** True once scripts/migrate_ml_features.sql has been run. Cached per process. */
function hasMlColumns() {
    if (!mlColumnsPromise) {
        mlColumnsPromise = db.query(`
            SELECT COUNT(*) AS n
            FROM information_schema.columns
            WHERE table_name = 'queue'
              AND column_name IN ('queue_length_at_join', 'tables_vacant_at_join', 'seated_at')
        `)
            .then(([rows]) => parseInt(rows[0].n, 10) === 3)
            .catch(() => {
                mlColumnsPromise = null; // transient DB error — re-check next time
                return false;
            });
    }
    return mlColumnsPromise;
}

async function countVacantTables(queryable, restaurantId) {
    const result = await queryable.query(
        "SELECT COUNT(*) AS n FROM restaurant_tables WHERE restaurant_id = $1 AND status = 'vacant'",
        [restaurantId]
    );
    // db.query returns [rows]; a pg client returns { rows }.
    const rows = Array.isArray(result) ? result[0] : result.rows;
    return parseInt(rows[0].n, 10);
}

module.exports = { predictWait, fallbackMinutes, hasMlColumns, countVacantTables, ML_API_URL };
