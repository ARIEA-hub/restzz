const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/restaurant/:id', async (req, res) => {
    const restaurantId = req.params.id;

    try {
        const [tables] = await db.query(
            "SELECT * FROM restaurant_tables WHERE restaurant_id = ?",
            [restaurantId]
        );
        res.json(tables);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;