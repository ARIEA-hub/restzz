const express = require('express');
const router = express.Router();
const db = require('../database'); 

// GET ALL RESTAURANTS
router.get('/', async (req, res) => {
    try {
        // FIX: Removed array destructuring and extracted result.rows
        const result = await db.query(
            "SELECT restaurant_id, name, location FROM restaurant"
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET ONLY OPEN RESTAURANTS 
// FIX: Renamed path to '/open' because having two '/' routes conflicts in Express
router.get('/', async (req, res) => {
    try {
        // FIX: Removed array destructuring and extracted result.rows
        const result = await db.query(
            "SELECT restaurant_id, name FROM restaurant WHERE status = 'open'"
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching restaurants:", error);
        res.status(500).json({ message: "Failed to load restaurants." });
    }
});

module.exports = router;
