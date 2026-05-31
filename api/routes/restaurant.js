const express = require('express');
const router = express.Router();
const db = require('../config/db');


router.get('/', async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT restaurant_id, name, location FROM restaurant"
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


router.get('/', async (req, res) => {
    try {
       
        const [restaurants] = await db.query(
            "SELECT restaurant_id, name FROM restaurant WHERE status = 'open'"
        );
        res.json(restaurants);
    } catch (error) {
        console.error("Error fetching restaurants:", error);
        res.status(500).json({ message: "Failed to load restaurants." });
    }
});



module.exports = router;