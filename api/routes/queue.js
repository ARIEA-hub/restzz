// api/routes/queue.js

const express = require('express');
const router  = express.Router();
const db      = require('../database');
const jwt     = require('jsonwebtoken');
const { requireAdmin } = require('../utils/auth');
const { predictWait, hasMlColumns, countVacantTables } = require('../utils/waitPredictor');
const allocation = require('../utils/tableAllocation');

function getAuthenticatedCustomerId(req) {
    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) return null;

    try {
        return jwt.verify(authorization.slice(7), process.env.JWT_SECRET).customer_id;
    } catch (error) {
        return null;
    }
}

// ── POST /api/queue/join ──────────────────────────────────────────────
router.post('/join', async (req, res) => {
    const { restaurant_id, group_size } = req.body;
    const customer_id = getAuthenticatedCustomerId(req);

    if (!customer_id) {
        return res.status(401).json({ message: 'Please log in again to join the queue.' });
    }

    try {
        // Check if already in queue
        const [existing] = await db.query(
            `SELECT * FROM queue
             WHERE customer_id = $1
               AND restaurant_id = $2
               AND status IN ('waiting', 'called')`,
            [customer_id, restaurant_id]
        );
        if (existing.length > 0) {
            return res.status(400).json({ message: 'You are already in the queue!' });
        }

        let rows;
        if (await hasMlColumns()) {
            // Snapshot the wait-time model's features at join time — the
            // training label (seated_at − joined_at) is only meaningful
            // against the conditions the party actually walked into.
            [rows] = await db.query(
                `INSERT INTO queue (restaurant_id, customer_id, group_size, queue_length_at_join, tables_vacant_at_join)
                 VALUES ($1, $2, $3,
                         (SELECT COUNT(*) FROM queue WHERE restaurant_id = $1 AND status = 'waiting'),
                         (SELECT COUNT(*) FROM restaurant_tables WHERE restaurant_id = $1 AND status = 'vacant'))
                 RETURNING queue_id`,
                [restaurant_id, customer_id, group_size]
            );
        } else {
            [rows] = await db.query(
                `INSERT INTO queue (restaurant_id, customer_id, group_size)
                 VALUES ($1, $2, $3)
                 RETURNING queue_id`,
                [restaurant_id, customer_id, group_size]
            );
        }

        res.status(201).json({
            message: 'Successfully joined the queue!',
            queue_id: rows[0].queue_id
        });
    } catch (error) {
        console.error('Error joining queue:', error);
        res.status(500).json({ message: 'Failed to join queue.' });
    }
});

// ── PATCH /api/queue/leave/:queueId ─────────────────────────────────
router.patch('/leave/:queueId', async (req, res) => {
    const customerId = getAuthenticatedCustomerId(req);
    if (!customerId) {
        return res.status(401).json({ message: 'Please log in again to leave the queue.' });
    }

    try {
        const [rows] = await db.query(
            `UPDATE queue
             SET status = 'left'
             WHERE queue_id = $1
               AND customer_id = $2
               AND status IN ('waiting', 'called')
             RETURNING queue_id`,
            [req.params.queueId, customerId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Active queue entry not found.' });
        }

        res.json({ message: 'You have left the queue.', queue_id: rows[0].queue_id });
    } catch (error) {
        console.error('Error leaving queue:', error);
        res.status(500).json({ message: 'Failed to leave queue.' });
    }
});

// ── Batch table allocation (CSP / hill climbing / GA) ───────────────
// See api/utils/tableAllocation.js. Parties = 'waiting' queue entries,
// tables = 'vacant' tables. `lock` takes row locks inside a transaction so
// two allocations running at once can't hand out the same table.
async function loadAllocationProblem(client, restaurantId, { minWaitMinutes = 0, lock = false } = {}) {
    const lockClause = lock ? 'FOR UPDATE SKIP LOCKED' : '';
    const parties = await client.query(
        `SELECT queue_id, group_size, customer_id,
                EXTRACT(EPOCH FROM (NOW() - joined_at)) / 60.0 AS waited_min
         FROM queue
         WHERE restaurant_id = $1
           AND status = 'waiting'
           AND joined_at <= NOW() - ($2 * INTERVAL '1 minute')
         ORDER BY joined_at ASC
         ${lockClause}`,
        [restaurantId, minWaitMinutes]
    );
    const tables = await client.query(
        `SELECT table_id, table_no, capacity
         FROM restaurant_tables
         WHERE restaurant_id = $1 AND status = 'vacant'
         ORDER BY capacity ASC, table_no ASC
         ${lockClause}`,
        [restaurantId]
    );
    return allocation.createProblem(
        parties.rows.map((p) => ({ id: p.queue_id, size: p.group_size, waited_min: Math.round(p.waited_min), customer_id: p.customer_id })),
        tables.rows.map((t) => ({ id: t.table_id, capacity: t.capacity, table_no: t.table_no }))
    );
}

async function applyAssignment(client, problem, result) {
    const recordSeatedAt = await hasMlColumns();
    const applied = [];
    for (const seat of result.seated) {
        const table = problem.tables.find((t) => t.id === seat.table_id);
        const party = problem.parties.find((p) => p.id === seat.party_id);
        await client.query("UPDATE restaurant_tables SET status = 'occupied' WHERE table_id = $1", [table.id]);
        await client.query(
            recordSeatedAt
                ? "UPDATE queue SET status = 'seated', seated_at = NOW() WHERE queue_id = $1"
                : "UPDATE queue SET status = 'seated' WHERE queue_id = $1",
            [party.id]
        );
        applied.push({ queue_id: party.id, customer_id: party.customer_id, group_size: party.size, table_no: table.table_no, capacity: table.capacity });
    }
    return applied;
}

const summarize = (result) => ({
    algorithm: result.algorithm,
    cost: result.cost,
    guests_seated: result.guests_seated,
    wasted_seats: result.wasted_seats,
    seated: result.seated,
    unseated: result.unseated,
    stats: result.stats
});

// ── POST /api/queue/auto-allocate/:restaurantId ─────────────────────
// Previously: oldest guest → smallest free table that fits, ONE party per
// call. Now: every guest who has waited at least a minute is assigned in
// one batch by the CSP solver (optimal under capacity + one-party-per-
// table constraints). Response keeps `allocated` / `table_no` for the
// existing dashboard, plus the full `assignments` list.
router.post('/auto-allocate/:restaurantId', async (req, res) => {
    const restaurantId = req.params.restaurantId;
    const client = await db.getClient();

    try {
        await client.query('BEGIN');
        const problem = await loadAllocationProblem(client, restaurantId, { minWaitMinutes: 1, lock: true });

        if (problem.parties.length === 0) {
            await client.query('COMMIT');
            return res.json({ allocated: false, message: 'No queued guest has waited at least one minute.' });
        }

        const result = allocation.solveCSP(problem);
        if (result.seated.length === 0) {
            await client.query('COMMIT');
            return res.json({ allocated: false, message: 'No suitable free table is available.' });
        }

        const assignments = await applyAssignment(client, problem, result);
        await client.query('COMMIT');
        res.json({
            allocated: true,
            // Back-compat with the old one-guest response shape:
            queue_id: assignments[0].queue_id,
            table_no: assignments[0].table_no,
            customer_id: assignments[0].customer_id,
            assignments,
            still_waiting: result.unseated.length,
            solver: { algorithm: 'csp', ...result.stats }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Auto-allocation error:', error);
        res.status(500).json({ message: 'Failed to auto-allocate a table.' });
    } finally {
        client.release();
    }
});

// ── POST /api/queue/optimize/demo ────────────────────────────────────
// Pure computation, no database: runs the greedy baseline, CSP, hill
// climbing and GA on a posted instance (or the built-in one where hill
// climbing provably gets stuck). Body: { parties?, tables?, weights? }.
router.post('/optimize/demo', (req, res) => {
    const body = req.body || {};
    const parties = Array.isArray(body.parties) ? body.parties : allocation.DEMO_INSTANCE.parties;
    const tables = Array.isArray(body.tables) ? body.tables : allocation.DEMO_INSTANCE.tables;

    if (parties.length > 40 || tables.length > 40) {
        return res.status(400).json({ message: 'Demo instances are limited to 40 parties and 40 tables.' });
    }
    const bad = parties.some((p) => !(Number(p.size) >= 1)) || tables.some((t) => !(Number(t.capacity) >= 1));
    if (bad) return res.status(400).json({ message: 'Every party needs size >= 1 and every table capacity >= 1.' });

    const problem = allocation.createProblem(parties, tables, body.weights);
    const all = allocation.compareAll(problem);
    res.json({
        instance: { parties: problem.parties, tables: problem.tables, weights: problem.weights },
        results: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, summarize(v)]))
    });
});

// ── POST /api/queue/optimize/:restaurantId ───────────────────────────
// Admin-only. Runs the solvers on the restaurant's LIVE queue and vacant
// tables. Body: { algorithm: 'csp' | 'hill_climbing' | 'genetic' | 'compare',
// apply: boolean }. `apply` (not allowed with 'compare') commits the chosen
// solver's seating.
router.post('/optimize/:restaurantId', requireAdmin, async (req, res) => {
    const restaurantId = req.params.restaurantId;
    const algorithm = (req.body && req.body.algorithm) || 'compare';
    const apply = Boolean(req.body && req.body.apply);

    if (algorithm !== 'compare' && !allocation.SOLVERS[algorithm]) {
        return res.status(400).json({ message: `algorithm must be compare or one of: ${Object.keys(allocation.SOLVERS).join(', ')}` });
    }
    if (apply && algorithm === 'compare') {
        return res.status(400).json({ message: 'Pick one algorithm to apply.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const problem = await loadAllocationProblem(client, restaurantId, { lock: apply });

        if (algorithm === 'compare') {
            await client.query('COMMIT');
            const all = allocation.compareAll(problem);
            return res.json({
                parties: problem.parties.length,
                tables: problem.tables.length,
                results: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, summarize(v)]))
            });
        }

        const result = allocation.SOLVERS[algorithm](problem);
        const assignments = apply ? await applyAssignment(client, problem, result) : [];
        await client.query('COMMIT');
        res.json({ applied: apply, assignments, result: summarize(result) });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Queue optimization error:', error);
        res.status(500).json({ message: 'Failed to optimize table allocation.' });
    } finally {
        client.release();
    }
});

// ── GET /api/queue/status/:queueId ───────────────────────────────────
router.get('/status/:queueId', async (req, res) => {
    const queueId = req.params.queueId;
    const customerId = getAuthenticatedCustomerId(req);

    if (!customerId) {
        return res.status(401).json({ message: 'Please log in again to view queue status.' });
    }

    try {
        const [userQueue] = await db.query(
            'SELECT * FROM queue WHERE queue_id = $1 AND customer_id = $2',
            [queueId, customerId]
        );
        if (userQueue.length === 0) {
            return res.status(404).json({ message: 'Queue record not found.' });
        }

        const myRecord = userQueue[0];

        if (myRecord.status !== 'waiting' && myRecord.status !== 'called') {
            return res.json({ status: myRecord.status, position: 0, estimated_wait_time: 0 });
        }

        const [positionData] = await db.query(`
            SELECT COUNT(*) AS people_ahead
            FROM queue
            WHERE restaurant_id = $1
              AND status = 'waiting'
              AND joined_at < $2
        `, [myRecord.restaurant_id, myRecord.joined_at]);

        // PostgreSQL COUNT returns a string; parseInt converts it
        const peopleAhead  = parseInt(positionData[0].people_ahead, 10);
        const myPosition   = peopleAhead + 1;
        const tablesAvailable = await countVacantTables(db, myRecord.restaurant_id);
        // Decision-tree prediction from the FastAPI ML service, or the old
        // 5-min-per-party rule if that service is unavailable.
        const estimate = await predictWait({
            partySize: myRecord.group_size,
            peopleAhead,
            tablesAvailable
        });

        res.json({
            queue_id: myRecord.queue_id,
            status: myRecord.status,
            group_size: myRecord.group_size,
            position: myPosition,
            people_ahead: peopleAhead,
            estimated_wait_time: estimate.minutes,
            estimate_source: estimate.source
        });
    } catch (error) {
        console.error('Error fetching queue status:', error);
        res.status(500).json({ message: 'Failed to get queue status.' });
    }
});

// ── GET /api/queue/admin/:restaurantId ───────────────────────────────
router.get('/admin/:restaurantId', async (req, res) => {
    const restaurantId = req.params.restaurantId;
    try {
        const [queueList] = await db.query(`
            SELECT q.queue_id, q.group_size, q.joined_at, q.status,
                   c.name AS customer_name, c.phone
            FROM queue q
            JOIN customer c ON q.customer_id = c.customer_id
            WHERE q.restaurant_id = $1
              AND q.status IN ('waiting', 'called')
            ORDER BY q.joined_at ASC
        `, [restaurantId]);
        res.json(queueList);
    } catch (error) {
        console.error('Error fetching admin queue:', error);
        res.status(500).json({ message: 'Failed to fetch queue.' });
    }
});

// ── PUT /api/queue/update/:queueId ───────────────────────────────────
router.put('/update/:queueId', async (req, res) => {
    const queueId = req.params.queueId;
    const { status } = req.body;
    try {
        const recordSeatedAt = status === 'seated' && await hasMlColumns();
        await db.query(
            recordSeatedAt
                ? 'UPDATE queue SET status = $1, seated_at = NOW() WHERE queue_id = $2'
                : 'UPDATE queue SET status = $1 WHERE queue_id = $2',
            [status, queueId]
        );
        res.json({ message: `Queue status updated to ${status}` });
    } catch (error) {
        console.error('Error updating queue status:', error);
        res.status(500).json({ message: 'Failed to update status.' });
    }
});

module.exports = router;
