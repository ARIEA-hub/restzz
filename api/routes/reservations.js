const express = require('express');
const router = express.Router();
const db = require('../config/db'); 


router.post('/create', async (req, res) => {
    const { customer_id, restaurant_id, group_size, reserve_date, reserve_time } = req.body;

    try {
        await db.query(
            "INSERT INTO reservation (customer_id, restaurant_id, group_size, reserve_date, reserve_time) VALUES (?, ?, ?, ?, ?)",
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
      
        const query = `
            SELECT 
                res.reserve_id AS reservation_id,
                res.group_size AS party_size,
                res.status,
                DATE_FORMAT(res.reserve_date, '%M %d, %Y') AS date, 
                TIME_FORMAT(res.reserve_time, '%h:%i %p') AS time,
                r.name AS name
            FROM reservation res
            JOIN restaurant r ON res.restaurant_id = r.restaurant_id
            WHERE res.customer_id = ? AND res.status = 'reserved'
            ORDER BY res.reserve_date ASC, res.reserve_time ASC
        `;
        
        const [reservations] = await db.query(query, [customerId]);
        res.json(reservations);
    } catch (error) {
        console.error("Error fetching reservations:", error);
        res.status(500).json({ message: "Failed to fetch reservations" });
    }
});

module.exports = router;