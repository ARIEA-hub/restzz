// api/routes/tables.js

const express = require('express');
const router  = express.Router();
const db      = require('../database');

// ── GET /api/tables/restaurant/:id ───────────────────────────────────
router.get('/restaurant/:id', async (req, res) => {
    const restaurantId = req.params.id;
    try {
        const [tables] = await db.query(
            'SELECT * FROM restaurant_tables WHERE restaurant_id = $1 ORDER BY table_no ASC',
            [restaurantId]
        );
        res.json(tables);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ── PATCH /api/tables/:tableId/status ────────────────────────────────
// Updates table status: 'vacant' | 'occupied' | 'reserved' | 'unavailable'
router.patch('/:tableId/status', async (req, res) => {
    const { status } = req.body;
    const validStatuses = ['vacant', 'occupied', 'reserved', 'unavailable'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }
    try {
        await db.query(
            'UPDATE restaurant_tables SET status = $1 WHERE table_id = $2',
            [status, req.params.tableId]
        );
        res.json({ message: `Table status updated to ${status}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
