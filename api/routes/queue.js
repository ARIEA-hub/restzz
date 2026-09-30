// api/routes/queue.js

const express = require('express');
const router  = express.Router();
const db      = require('../database');
const jwt     = require('jsonwebtoken');
const { requireAdmin, adminOwnsRow } = require('../utils/auth');
const { predictWait, hasMlColumns, countVacantTables } = require('../utils/waitPredictor');
const allocation = require('../utils/tableAllocation');
const { joinQueue } = require('../utils/bookings');

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
        const result = await joinQueue({ customerId: customer_id, restaurantId: restaurant_id, groupSize: group_size });
        if (result.error) {
            // Already queued: hand back the existing entry so the page can
            // resume tracking it instead of showing an error.
            return res.status(result.queue_id ? 409 : result.status)
                .json({ message: result.error, queue_id: result.queue_id });
        }
        res.status(201).json({ message: `You're in the queue at ${result.restaurant.name}.`, queue_id: result.queue_id });
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

// ── Batch seating ─────────────────────────────────────────────────────
// See api/utils/tableAllocation.js (planSeating). Parties = 'waiting' queue entries,
// tables = 'vacant' tables. `lock` takes row locks inside a transaction so
// two allocations running at once can't hand out the same table.
async function loadAllocationProblem(client, restaurantId, { minWaitMinutes = 0, lock = false } = {}) {
    const lockClause = lock ? 'FOR UPDATE SKIP LOCKED' : '';
    const parties = await client.query(
        `SELECT q.queue_id, q.group_size, q.customer_id, c.name AS customer_name,
                EXTRACT(EPOCH FROM (NOW() - q.joined_at)) / 60.0 AS waited_min
         FROM queue q
         LEFT JOIN customer c ON c.customer_id = q.customer_id
         WHERE q.restaurant_id = $1
           AND q.status = 'waiting'
           AND q.joined_at <= NOW() - ($2 * INTERVAL '1 minute')
         ORDER BY q.joined_at ASC
         ${lock ? 'FOR UPDATE OF q SKIP LOCKED' : ''}`,
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
        parties.rows.map((p) => ({ id: p.queue_id, size: p.group_size, waited_min: Math.round(p.waited_min), customer_id: p.customer_id, name: p.customer_name })),
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

// Staff-facing version of a plan: names and table numbers, not ids.
function readablePlan(problem, result) {
    const party = (id) => problem.parties.find((p) => p.id === id);
    const table = (id) => problem.tables.find((t) => t.id === id);
    return {
        method: result.method,
        guests_seated: result.guests_seated,
        empty_seats: result.wasted_seats,
        seats: result.seated.map((s) => ({
            queue_id: s.party_id,
            table_id: s.table_id,
            name: party(s.party_id).name || 'Guest',
            size: s.size,
            waited_min: party(s.party_id).waited_min,
            table_no: table(s.table_id).table_no,
            capacity: s.capacity
        })),
        still_waiting: result.unseated.map((u) => ({
            queue_id: u.party_id,
            name: party(u.party_id).name || 'Guest',
            size: u.size,
            waited_min: party(u.party_id).waited_min
        }))
    };
}

// ── POST /api/queue/auto-allocate/:restaurantId ─────────────────────
// Seats every guest who has waited at least a minute, in one batch, using
// planSeating(): smallest suitable table per party (a pair gets a
// 2-seater, else a 4, never a 6 while a 4 is free), as many guests seated
// as possible, longest-waiting first when not everyone fits. Response
// keeps `allocated` / `table_no` for the existing dashboard, plus the full
// `assignments` list.
router.post('/auto-allocate/:restaurantId', requireAdmin, async (req, res) => {
    const restaurantId = req.params.restaurantId;
    const client = await db.getClient();

    try {
        await client.query('BEGIN');
        const problem = await loadAllocationProblem(client, restaurantId, { minWaitMinutes: 1, lock: true });

        if (problem.parties.length === 0) {
            await client.query('COMMIT');
            return res.json({ allocated: false, message: 'No queued guest has waited at least one minute.' });
        }

        const result = allocation.planSeating(problem);
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
            planned_by: result.method
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
// Admin-only. Behind the dashboard's "Plan seating" button.
// Body: { algorithm: 'plan' (default) | 'csp' | 'hill_climbing' | 'genetic'
// | 'compare', apply: boolean }. 'plan' returns a staff-readable plan plus
// how seating in plain arrival order would compare; `apply` seats it.
// The individual solvers and 'compare' are kept for testing and demos.
router.post('/optimize/:restaurantId', requireAdmin, async (req, res) => {
    const restaurantId = req.params.restaurantId;
    const algorithm = (req.body && req.body.algorithm) || 'plan';
    const apply = Boolean(req.body && req.body.apply);

    if (!['plan', 'compare'].includes(algorithm) && !allocation.SOLVERS[algorithm]) {
        return res.status(400).json({ message: `algorithm must be plan, compare or one of: ${Object.keys(allocation.SOLVERS).join(', ')}` });
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

        if (algorithm === 'plan' && apply) {
            // Seat exactly the plan staff approved on screen — not a fresh
            // re-plan, which could differ if the queue moved in between.
            const { assignment, error } = allocation.assignmentFromSeats(
                problem,
                (req.body.seats || []).map((x) => ({ party_id: x.queue_id, table_id: x.table_id }))
            );
            if (error) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: `${error} Plan again to see the current queue.`, stale: true });
            }
            const approved = allocation.describe(problem, assignment);
            const assignments = await applyAssignment(client, problem, approved);
            await client.query('COMMIT');
            return res.json({ applied: true, assignments });
        }

        if (algorithm === 'plan') {
            const plan = allocation.planSeating(problem);
            await client.query('COMMIT');
            const arrivalOrder = allocation.describe(problem, allocation.greedyFifo(problem));
            return res.json({
                applied: false,
                assignments: [],
                parties_waiting: problem.parties.length,
                free_tables: problem.tables.length,
                plan: readablePlan(problem, plan),
                arrival_order: { guests_seated: arrivalOrder.guests_seated, empty_seats: arrivalOrder.wasted_seats }
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
router.get('/admin/:restaurantId', requireAdmin, async (req, res) => {
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
// Staff actions on one queue entry: call, seat, or remove ('left').
// The queue table only allows waiting/called/seated/left — the dashboard's
// "Remove" used to send 'cancelled', which the database rejected.
const STAFF_QUEUE_STATUSES = ['waiting', 'called', 'seated', 'left'];

router.put('/update/:queueId', requireAdmin, async (req, res) => {
    const queueId = req.params.queueId;
    const { status } = req.body;
    if (!STAFF_QUEUE_STATUSES.includes(status)) {
        return res.status(400).json({ message: `Status must be one of: ${STAFF_QUEUE_STATUSES.join(', ')}` });
    }
    try {
        if (!(await adminOwnsRow(req, res, 'queue', 'queue_id', queueId))) return;
        if (status === 'seated') return seatOneParty(req, res, queueId);

        await db.query('UPDATE queue SET status = $1 WHERE queue_id = $2', [status, queueId]);
        res.json({ message: `Queue status updated to ${status}` });
    } catch (error) {
        console.error('Error updating queue status:', error);
        res.status(500).json({ message: 'Failed to update status.' });
    }
});

// Seating one party by hand. Uses the same rule as everywhere else — the
// smallest free table that fits — unless staff name a table (table_id).
// If nothing fits, it says so; staff can still seat them without a table
// (without_table: true), e.g. at the bar.
async function seatOneParty(req, res, queueId) {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { rows: [party] } = await client.query(
            "SELECT queue_id, restaurant_id, group_size, status FROM queue WHERE queue_id = $1 FOR UPDATE",
            [queueId]
        );
        if (!['waiting', 'called'].includes(party.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: 'This party is no longer in the queue.' });
        }

        const { rows: free } = await client.query(
            "SELECT table_id, table_no, capacity FROM restaurant_tables WHERE restaurant_id = $1 AND status = 'vacant' FOR UPDATE",
            [party.restaurant_id]
        );
        const requested = req.body.table_id != null
            ? free.find((t) => String(t.table_id) === String(req.body.table_id) && t.capacity >= party.group_size)
            : allocation.smallestFittingTable(party.group_size, free);

        if (!requested && req.body.without_table !== true) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                message: req.body.table_id != null
                    ? 'That table is not free or is too small for this party.'
                    : `No free table seats ${party.group_size}.`,
                can_seat_without_table: true
            });
        }

        if (requested) {
            await client.query("UPDATE restaurant_tables SET status = 'occupied' WHERE table_id = $1", [requested.table_id]);
        }
        await client.query(
            (await hasMlColumns())
                ? "UPDATE queue SET status = 'seated', seated_at = NOW() WHERE queue_id = $1"
                : "UPDATE queue SET status = 'seated' WHERE queue_id = $1",
            [queueId]
        );
        await client.query('COMMIT');
        res.json({ message: 'Seated.', table_no: requested ? requested.table_no : null });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error seating party:', error);
        res.status(500).json({ message: 'Failed to seat party.' });
    } finally {
        client.release();
    }
}

module.exports = router;
