const express = require('express');
const router = express.Router();
const db = require('../database');

router.get('/restaurant/:id', async (req, res) => {
    const restaurantId = req.params.id;

    try {
        // FIX: Changed placeholder to $1 and removed array destructuring
        const result = await db.query(
            "SELECT * FROM restaurant_tables WHERE restaurant_id = $1",
            [restaurantId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
