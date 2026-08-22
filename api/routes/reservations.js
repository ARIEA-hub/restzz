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

module.exports = router;
