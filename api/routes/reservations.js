// api/routes/reservations.js

const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { requireAdmin, requireCustomer } = require('../utils/auth');
const { createReservation, syncReservationTable } = require('../utils/bookings');

const RESTAURANT_TZ = process.env.RESTAURANT_TZ || 'Asia/Kolkata';

// ── POST /api/reservations/create ────────────────────────────────────
// The customer comes from the login token, never the request body, so a
// guest can only book for themselves.
router.post('/create', requireCustomer, async (req, res) => {
    const { restaurant_id, group_size, reserve_date, reserve_time } = req.body;
    try {
        const result = await createReservation({
            customerId: req.customerId,
            restaurantId: restaurant_id,
            groupSize: group_size,
            date: reserve_date,
            time: reserve_time
        });
        if (result.error) return res.status(result.status).json({ success: false, message: result.error });
        res.json({ success: true, reserve_id: result.reserve_id, message: `Table booked at ${result.restaurant.name}.` });
    } catch (error) {
        console.error('Error creating reservation:', error);
        res.status(500).json({ success: false, message: 'Failed to book table.' });
    }
});

// ── GET /api/reservations/user/:customerId ────────────────────────────
// Upcoming bookings for the logged-in customer (the :customerId must be
// their own). "Upcoming" is judged on the restaurant's clock.
router.get('/user/:customerId', requireCustomer, async (req, res) => {
    if (String(req.params.customerId) !== String(req.customerId)) {
        return res.status(403).json({ message: 'You can only view your own reservations.' });
    }
    try {
        const [reservations] = await db.query(`
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
              AND (res.reserve_date + res.reserve_time) >= (NOW() AT TIME ZONE $2)
            ORDER BY res.reserve_date ASC, res.reserve_time ASC
        `, [req.customerId, RESTAURANT_TZ]);
        res.json(reservations);
    } catch (error) {
        console.error('Error fetching reservations:', error);
        res.status(500).json({ message: 'Failed to fetch reservations' });
    }
});

// ── DELETE /api/reservations/:reserveId ──────────────────────────────
// A customer cancels their own upcoming booking. If a table was already
// set aside for it, that table is freed.
router.delete('/:reserveId', requireCustomer, async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `UPDATE reservation SET status = 'cancelled'
             WHERE reserve_id = $1 AND customer_id = $2 AND status = 'reserved'
               AND (reserve_date + reserve_time) >= (NOW() AT TIME ZONE $3)
             RETURNING reserve_id`,
            [req.params.reserveId, req.customerId, RESTAURANT_TZ]
        );
        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Upcoming reservation not found.' });
        }
        await syncReservationTable(client, req.params.reserveId, 'cancelled');
        await client.query('COMMIT');
        res.json({ success: true, message: 'Reservation cancelled.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error cancelling reservation:', error);
        res.status(500).json({ message: 'Failed to cancel reservation.' });
    } finally {
        client.release();
    }
});

// ── PATCH /api/reservations/:reserveId/status ────────────────────────
// Staff mark a booking seated, completed, cancelled or a no-show. The
// no-show status is what makes the customer summary's no-show rate
// meaningful. The reservation's table (if any) follows: freed on
// cancel / no-show / completed, occupied on seated.
router.patch('/:reserveId/status', requireAdmin, async (req, res) => {
    const { status } = req.body;
    const validStatuses = ['reserved', 'seated', 'cancelled', 'completed', 'no_show'];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            'UPDATE reservation SET status = $1 WHERE reserve_id = $2 AND restaurant_id = $3 RETURNING reserve_id',
            [status, req.params.reserveId, req.admin.restaurant_id]
        );
        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Reservation not found.' });
        }
        await syncReservationTable(client, req.params.reserveId, status);
        await client.query('COMMIT');
        res.json({ success: true, message: `Reservation marked as ${status.replace('_', '-')}.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating reservation status:', error);
        res.status(500).json({ message: 'Failed to update reservation status.' });
    } finally {
        client.release();
    }
});

module.exports = router;
