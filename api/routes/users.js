console.log("Users route file loaded.");
const express = require('express');
const router = express.Router();
const db = require('../database'); 
const bcrypt = require('bcrypt');

// 1. Register alias
router.post('/', async (req, res) => {
    const { name, email, phone, password } = req.body;

    try {
        const hashedPassword  = await bcrypt.hash(password, 10);
        // FIX: Swapped ? for $1-$4 and added RETURNING customer_id
        const result = await db.query(
            'INSERT INTO customer (name, email, phone, password, is_guest) VALUES ($1, $2, $3, $4, 0) RETURNING customer_id', 
            [name, email, phone, hashedPassword]
        );

        res.status(201).json({
            message : 'Customer registered successfully',
            customer_id : result.rows[0].customer_id // FIX: Accessed row ID directly
        });
    } catch (error) {
        res.status(500).json({error : error.message});
    }
});

// 2. Login Route (Added try/catch to prevent crashes)
router.post('/login', async (req,res) => {
    const {email, password} = req.body;

    try {
        // FIX: Swapped ? for $1 and removed array destructuring
        const result = await db.query(
            "SELECT * FROM customer WHERE email = $1",
            [email]
        );
        const rows = result.rows;

        if(rows.length === 0){
            return res.status(401).json({message: "Invalid credentials"});
        }

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password);

        if(!valid){
            return res.status(401).json({message: "Invalid credentials"});
        }

        res.json({
            message: "Login successful",
            user: user.customer_id
        });
    } catch (error) {
        res.status(500).json({error: error.message});
    }
});


router.post('/register', async (req, res) => {
    const { name, email, phone, password } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        // FIX: Swapped ? for $1-$4 and added RETURNING customer_id
        const result = await db.query(
            `INSERT INTO customer (name, email, phone, password, is_guest) VALUES ($1, $2, $3, $4, 0) RETURNING customer_id`,
            [name, email, phone, hashedPassword]
        );

        res.status(201).json({
            message: "Customer registered successfully",
            customer_id: result.rows[0].customer_id // FIX: Accessed row ID directly
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id', async (req,res) => {
    try {
        // FIX: Swapped ? for $1 and removed array destructuring
        const result = await db.query(
            'SELECT name, email, phone FROM customer WHERE customer_id = $1', 
            [req.params.id]
        );
        const userData = result.rows;

        if (userData.length > 0) {
            res.json({
                name: userData[0].name,
                email: userData[0].email,
                phone: userData[0].phone
            });
        } else {
            res.status(404).json({ message: "User not found" });
        }
    } catch(error) {
        res.status(500).json({error: error.message});
    }
});

module.exports = router;
