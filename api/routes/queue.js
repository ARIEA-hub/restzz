// api/routes/queue.js

const express = require('express');
const router  = express.Router();
const db      = require('../database');
const jwt     = require('jsonwebtoken');

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

        const [rows] = await db.query(
            `INSERT INTO queue (restaurant_id, customer_id, group_size)
             VALUES ($1, $2, $3)
             RETURNING queue_id`,
            [restaurant_id, customer_id, group_size]
        );

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
        const estimatedWaitTime = myPosition * 5;

        res.json({
            queue_id: myRecord.queue_id,
            status: myRecord.status,
            group_size: myRecord.group_size,
            position: myPosition,
            people_ahead: peopleAhead,
            estimated_wait_time: estimatedWaitTime
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
        await db.query(
            'UPDATE queue SET status = $1 WHERE queue_id = $2',
            [status, queueId]
        );
        res.json({ message: `Queue status updated to ${status}` });
    } catch (error) {
        console.error('Error updating queue status:', error);
        res.status(500).json({ message: 'Failed to update status.' });
    }
});

module.exports = router;
