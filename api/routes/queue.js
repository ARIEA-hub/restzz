const express = require('express');
const router = express.Router();
const db = require('../database');  


router.post('/join', async (req, res) => {
    const { restaurant_id, customer_id, group_size } = req.body;

    try {
    
        const [existing] = await db.query(
            "SELECT * FROM queue WHERE customer_id = ? AND restaurant_id = ? AND status IN ('waiting', 'called')",
            [customer_id, restaurant_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({ message: "You are already in the queue!" });
        }

      
        const [result] = await db.query(
            "INSERT INTO queue (restaurant_id, customer_id, group_size) VALUES (?, ?, ?)",
            [restaurant_id, customer_id, group_size]
        );

        res.status(201).json({ 
            message: "Successfully joined the queue!", 
            queue_id: result.insertId 
        });

    } catch (error) {
        console.error("Error joining queue:", error);
        res.status(500).json({ message: "Failed to join queue." });
    }
});


router.get('/status/:queueId', async (req, res) => {
    const queueId = req.params.queueId;

    try {

        const [userQueue] = await db.query("SELECT * FROM queue WHERE queue_id = ?", [queueId]);
        
        if (userQueue.length === 0) {
            return res.status(404).json({ message: "Queue record not found." });
        }

        const myRecord = userQueue[0];
        
    
        if (myRecord.status !== 'waiting' && myRecord.status !== 'called') {
            return res.json({ status: myRecord.status, position: 0, estimated_wait_time: 0 });
        }

      
        const [positionData] = await db.query(`
            SELECT COUNT(*) AS people_ahead  
            FROM queue 
            WHERE restaurant_id = ?  
              AND status = 'waiting' 
              AND joined_at < ?
        `, [myRecord.restaurant_id, myRecord.joined_at]); 

        const peopleAhead = positionData[0].people_ahead;
        const myPosition = peopleAhead + 1; 

     
        const estimatedWaitTime = myPosition * 5; 

        res.json({
            queue_id: myRecord.queue_id,
            status: myRecord.status,
            group_size: myRecord.group_size,
            position: myPosition,
            people_ahead: peopleAhead,
            estimated_wait_time: estimatedWaitTime 
        });

    } catch (error) {
        console.error("Error fetching queue status:", error);
        res.status(500).json({ message: "Failed to get queue status." });
    }
});

router.get('/admin/:restaurantId', async (req, res) => {
    const restaurantId = req.params.restaurantId;

    try {
        
        const [queueList] = await db.query(`
            SELECT q.queue_id, q.group_size, q.joined_at, q.status, c.name AS customer_name, c.phone
            FROM queue q
            JOIN customer c ON q.customer_id = c.customer_id
            WHERE q.restaurant_id = ? AND q.status IN ('waiting', 'called')
            ORDER BY q.joined_at ASC
        `, [restaurantId]);

        res.json(queueList);
    } catch (error) {
        console.error("Error fetching admin queue:", error);
        res.status(500).json({ message: "Failed to fetch queue." });
    }
});


router.put('/update/:queueId', async (req, res) => {
    const queueId = req.params.queueId;
    const { status } = req.body; 

    try {
        await db.query("UPDATE queue SET status = ? WHERE queue_id = ?", [status, queueId]);
        res.json({ message: `Queue status updated to ${status}` });
    } catch (error) {
        console.error("Error updating queue status:", error);
        res.status(500).json({ message: "Failed to update status." });
    }
});

module.exports = router;