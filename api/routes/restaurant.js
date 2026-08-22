// api/routes/restaurant.js
// Restaurant data endpoints
// Bug B Fixed: Merged duplicate router.get('/') into one handler

const express = require('express');
const router  = express.Router();
const db      = require('../database');

// ── GET /api/restaurant ──────────────────────────────────────────────
// Returns all restaurants with location and coordinates
// Bug B: Previously two competing GET '/' handlers existed.
// The second one (filtering status='open') was dead code.
// Now merged into one complete handler.
router.get('/', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT restaurant_id, name, location, status, latitude, longitude
             FROM restaurant
             ORDER BY name ASC`
        );
        res.json(rows);
    } catch (error) {
        console.error('Error fetching restaurants:', error.message);
        res.status(500).json({ message: 'Failed to load restaurants.' });
    }
});

// ── GET /api/restaurant/open ─────────────────────────────────────────
// Returns only open restaurants (what the old dead handler intended)
router.get('/open', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT restaurant_id, name, location, latitude, longitude
             FROM restaurant
             WHERE status = 'open'
             ORDER BY name ASC`
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load restaurants.' });
    }
});

// ── GET /api/restaurant/:id ──────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT * FROM restaurant WHERE restaurant_id = $1',
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Restaurant not found.' });
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load restaurant.' });
    }
});

module.exports = router;
