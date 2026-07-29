const express = require('express');
const router = express.Router();
const db = require('../database');  


router.post('/create', async (req, res) => {
    const { customer_id, restaurant_id, group_size, reserve_date, reserve_time } = req.body;

    try {
        // FIX: Changed positional placeholders to sequential $1-$5 formats
        await db.query(
            "INSERT INTO reservation (customer_id, restaurant_id, group_size, reserve_date, reserve_time) VALUES ($1, $2, $3, $4, $5)",
            [customer_id, restaurant_id, group_size, reserve_date, reserve_time]
        );

        res.json({ success: true, message: "Reservation confirmed!" });
    } catch (error) {
        console.error("Error creating reservation:", error);
        res.status(500).json({ success: false, message: "Failed to book table." });
    }
});


router.get('/user/:customerId', async (req, res) => {
    const customerId = req.params.customerId;

    try {
        // FIX: Replaced MySQL DATE_FORMAT/TIME_FORMAT with PostgreSQL TO_CHAR equivalents
        // FIX: Swapped placeholder from ? to $1
        const query = `
            SELECT 
                res.reserve_id AS reservation_id,
                res.group_size AS party_size,
                res.status,
                TO_CHAR(res.reserve_date, 'Month DD, YYYY') AS date, 
                TO_CHAR(res.reserve_time, 'HH12:MI AM') AS time,
                r.name AS name
            FROM reservation res
            JOIN restaurant r ON res.restaurant_id = r.restaurant_id
            WHERE res.customer_id = $1 AND res.status = 'reserved'
            ORDER BY res.reserve_date ASC, res.reserve_time ASC
        `;
        
        // FIX: Removed array destructuring and extracted the raw query rows array
        const result = await db.query(query, [customerId]);
        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching reservations:", error);
        res.status(500).json({ message: "Failed to fetch reservations" });
    }
});

module.exports = router;
