// api/routes/reservations.js

const express = require('express');
const router  = express.Router();
const db      = require('../database');

// ── POST /api/reservations/create ────────────────────────────────────
router.post('/create', async (req, res) => {
    const { customer_id, restaurant_id, group_size, reserve_date, reserve_time } = req.body;

    if (!customer_id || !restaurant_id || !group_size || !reserve_date || !reserve_time) {
        return res.status(400).json({ success: false, message: 'All reservation fields are required.' });
    }

    try {
        await db.query(
            `INSERT INTO reservation (customer_id, restaurant_id, group_size, reserve_date, reserve_time)
             VALUES ($1, $2, $3, $4, $5)`,
            [customer_id, restaurant_id, group_size, reserve_date, reserve_time]
        );
        res.json({ success: true, message: 'Reservation confirmed!' });
    } catch (error) {
        console.error('Error creating reservation:', error);
        res.status(500).json({ success: false, message: 'Failed to book table.' });
    }
});

// ── GET /api/reservations/user/:customerId ────────────────────────────
// Bug A fix: TO_CHAR replaces DATE_FORMAT and TIME_FORMAT
router.get('/user/:customerId', async (req, res) => {
    const customerId = req.params.customerId;
    try {
        const query = `
            SELECT
                res.reserve_id   AS reservation_id,
                res.group_size   AS party_size,
                res.status,
                TO_CHAR(res.reserve_date, 'FMMonth FMDD, YYYY') AS date,
                TO_CHAR(res.reserve_time::time, 'HH12:MI AM')   AS time,
                r.name
            FROM reservation res
            JOIN restaurant r ON res.restaurant_id = r.restaurant_id
            WHERE res.customer_id = $1
              AND res.status = 'reserved'
            ORDER BY res.reserve_date ASC, res.reserve_time ASC
        `;
        const [reservations] = await db.query(query, [customerId]);
        res.json(reservations);
    } catch (error) {
        console.error('Error fetching reservations:', error);
        res.status(500).json({ message: 'Failed to fetch reservations' });
    }
});

// ── DELETE /api/reservations/:reserveId ──────────────────────────────
router.delete('/:reserveId', async (req, res) => {
    try {
        await db.query(
            "UPDATE reservation SET status = 'cancelled' WHERE reserve_id = $1",
            [req.params.reserveId]
        );
        res.json({ success: true, message: 'Reservation cancelled.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to cancel reservation.' });
    }
});

// ── PATCH /api/reservations/:reserveId/status ────────────────────────
// General admin status-setter — added so admins have a way to mark a
// reservation as 'no_show', which previously had no path in the app at
// all (only 'cancelled', via the customer-facing DELETE above). This is
// what makes the admin customer-behavior-summary feature meaningful —
// without a way to ever record a no-show, "no-show rate" could never
// be anything but zero.
router.patch('/:reserveId/status', async (req, res) => {
    const { status } = req.body;
    const validStatuses = ['reserved', 'seated', 'cancelled', 'completed', 'no_show'];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    try {
        const [rows] = await db.query(
            'UPDATE reservation SET status = $1 WHERE reserve_id = $2 RETURNING reserve_id',
            [status, req.params.reserveId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Reservation not found.' });
        }
        res.json({ success: true, message: `Reservation marked as ${status}.` });
    } catch (error) {
        console.error('Error updating reservation status:', error);
        res.status(500).json({ message: 'Failed to update reservation status.' });
    }
});

module.exports = router;
