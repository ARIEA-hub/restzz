// api/routes/location.js
// Feature C: Live Location Tracking
// Receives GPS coordinates from browser's Geolocation API and stores them.

const express = require('express');
const router  = express.Router();
const db      = require('../database');

// ── POST /api/location/update ─────────────────────────────────────────
// Called by frontend watchPosition handler.
// Body: { customer_id, latitude, longitude }
router.post('/update', async (req, res) => {
    const { customer_id, latitude, longitude } = req.body;

    if (!customer_id || latitude == null || longitude == null) {
        return res.status(400).json({ message: 'customer_id, latitude, and longitude are required.' });
    }

    // Basic bounds validation
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return res.status(400).json({ message: 'Invalid GPS coordinates.' });
    }

    try {
        await db.query(
            `UPDATE customer
             SET latitude = $1, longitude = $2, location_updated_at = NOW()
             WHERE customer_id = $3`,
            [latitude, longitude, customer_id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating customer location:', error.message);
        res.status(500).json({ message: 'Failed to update location.' });
    }
});

// ── GET /api/location/restaurant/:restaurantId ────────────────────────
// Returns a restaurant's registered coordinates
router.get('/restaurant/:restaurantId', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT restaurant_id, name, latitude, longitude FROM restaurant WHERE restaurant_id = $1',
            [req.params.restaurantId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Restaurant not found.' });
        }
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch restaurant location.' });
    }
});

// ── GET /api/location/nearby ─────────────────────────────────────────
// Returns restaurants sorted by distance from user's coordinates
// Query params: ?lat=19.076&lng=72.877&radius_km=10
router.get('/nearby', async (req, res) => {
    const { lat, lng, radius_km = 10 } = req.query;
    if (!lat || !lng) {
        return res.status(400).json({ message: 'lat and lng query parameters are required.' });
    }

    try {
        // Haversine distance formula in SQL (PostgreSQL)
        const [rows] = await db.query(`
            SELECT
                restaurant_id, name, location, status, latitude, longitude,
                ROUND(
                    6371 * acos(
                        cos(radians($1)) * cos(radians(latitude)) *
                        cos(radians(longitude) - radians($2)) +
                        sin(radians($1)) * sin(radians(latitude))
                    )::numeric, 2
                ) AS distance_km
            FROM restaurant
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
              AND status = 'open'
            HAVING distance_km <= $3
            ORDER BY distance_km ASC
        `, [parseFloat(lat), parseFloat(lng), parseFloat(radius_km)]);

        res.json(rows);
    } catch (error) {
        console.error('Nearby query error:', error.message);
        res.status(500).json({ message: 'Failed to find nearby restaurants.' });
    }
});

module.exports = router;
