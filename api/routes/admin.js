console.log("Admin route file loaded.");
const express = require('express');
const router = express.Router();
const db = require('../database'); 
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer'); // Bring in your email sender!


const transporter = nodemailer.createTransport({
    service: 'gmail', 
    auth: {
        user: 'pandeyneelansh2@gmail.com',
        pass: 'kciu xwie psnv ubvi'     
    }
});
router.post('/register', async (req, res) => {
   
    const { restaurant_id, name, email, phone, password, role } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        // FIX: Changed placeholders to $1-$6 and added RETURNING statement to get the generated ID
        const result = await db.query(
            `INSERT INTO admin (restaurant_id, name, email, phone, password, role)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING admin_id`,
            [restaurant_id, name, email, phone, hashedPassword, role || 'staff']
        );

        res.json({
            message: "Admin registered successfully!",
            admin_id: result.rows[0].admin_id // FIX: Extracted ID using PostgreSQL rows return structure
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


router.post('/login', async (req,res)=>{
    const {email, password} = req.body;

    try {
        // FIX: Changed to $1 placeholder and extracted .rows
        const result = await db.query(
            "SELECT * FROM admin WHERE email = $1",
            [email]
        );
        const rows = result.rows;

        if(rows.length === 0){
            return res.status(401).json({message:"Invalid credentials"}); //no entry in the database
        }

        const admin = rows[0];

        const valid = await bcrypt.compare(password, admin.password);

        if(!valid){
            return res.status(401).json({message:"Invalid credentials"});
        }

        res.json({
            message: "Login successful",
            admin_id: admin.admin_id,
            restaurant_id: admin.restaurant_id, 
            role: admin.role
        });
    } catch(error) {
        res.status(500).json({error: error.message});
    }
});


router.get('/:id', async (req,res)=>{
    const id = req.params.id;

    try {
        // FIX: Changed to $1 placeholder and extracted .rows
        const result = await db.query(
            "SELECT name, email, phone, role, restaurant_id FROM admin WHERE admin_id = $1",
            [id]
        );
        const rows = result.rows;

        if(rows.length === 0){
            return res.status(404).json({message:"Admin not found"});
        }

        res.json(rows[0]);

    } catch(error){
        res.status(500).json({error: error.message});
    }
});



// GET ALL PENDING RESERVATIONS FOR A SPECIFIC RESTAURANT
router.get('/reservations/pending/:restaurantId', async (req, res) => {
    const restaurantId = req.params.restaurantId;

    try {
        // FIX: Changed MySQL DATE_FORMAT/TIME_FORMAT to PostgreSQL TO_CHAR and changed placeholders to $1, $2
        const query = `
            SELECT 
                r.reserve_id, 
                u.name AS customer_name, 
                u.phone,
                r.group_size, 
                TO_CHAR(r.reserve_date, 'Month DD, YYYY') AS date, 
                TO_CHAR(r.reserve_time, 'HH12:MI AM') AS time
            FROM reservation r
            JOIN customer u ON r.customer_id = u.customer_id
            WHERE r.restaurant_id = $1 
            AND r.status = 'reserved' 
            AND r.table_id IS NULL
            ORDER BY r.reserve_date ASC, r.reserve_time ASC
        `;
        
        const result = await db.query(query, [restaurantId]);
        res.json(result.rows); // FIX: Send rows array directly
    } catch (error) {
        console.error("Error fetching pending reservations:", error);
        res.status(500).json({ message: "Failed to fetch reservations." });
    }
});


// ASSIGN A TABLE TO A RESERVATION
// ASSIGN A TABLE AND UPDATE TABLE STATUS
// ASSIGN A TABLE AND NOTIFY THE CUSTOMER
router.put('/reservations/:reserveId/allocate', async (req, res) => {
    const reserveId = req.params.reserveId;
    const { table_id } = req.body; 

    try {
        await db.query('BEGIN');

        // FIX: Placeholders changed to $1, $2
        await db.query(`UPDATE reservation SET table_id = $1 WHERE reserve_id = $2`, [table_id, reserveId]);

        // FIX: Placeholder changed to $1
        await db.query(`UPDATE restaurant_tables SET status = 'reserved' WHERE table_id = $1`, [table_id]);

        await db.query('COMMIT'); 

        
        // FIX: Placeholder changed to $1
        const result = await db.query(`
            SELECT c.email, c.name, r.reserve_date, r.reserve_time, t.table_no
            FROM reservation r
            JOIN customer c ON r.customer_id = c.customer_id
            JOIN restaurant_tables t ON r.table_id = t.table_id
            WHERE r.reserve_id = $1
        `, [reserveId]);
        
        const customerInfo = result.rows;

        // If we found the customer, send the email!
        if (customerInfo.length > 0) {
            const guest = customerInfo[0];
            
            // Format the date/time nicely
            const dateObj = new Date(guest.reserve_date);
            const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

            const mailOptions = {
                from: '"Q-Sense Reservations" <your-email@gmail.com>',
                to: guest.email,
                subject: '🎉 Your Table is Confirmed!',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e1e8ed; border-radius: 10px; overflow: hidden;">
                        <div style="background-color: #3178c6; padding: 20px; text-align: center; color: white;">
                            <h1 style="margin: 0; font-size: 24px;">Table Confirmed!</h1>
                        </div>
                        <div style="padding: 30px; background-color: #f8fbff; text-align: center;">
                            <h2 style="color: #333; margin-top: 0;">Hi ${guest.name},</h2>
                            <p style="color: #555; font-size: 16px;">Great news! The restaurant has successfully reviewed your reservation and allocated a table for you.</p>
                            
                            <div style="background: #fff; border: 2px dashed #3178c6; border-radius: 8px; padding: 20px; margin: 25px 0;">
                                <h3 style="margin: 0; color: #3178c6; font-size: 22px;">Table ${guest.table_no}</h3>
                                <p style="margin: 10px 0 0 0; color: #666; font-weight: bold;">📅 ${formattedDate}</p>
                            </div>
                            
                            <p style="color: #777; font-size: 14px;">Please check in at the host stand when you arrive. We look forward to serving you!</p>
                        </div>
                        <div style="background-color: #f4f7f9; padding: 15px; text-align: center; color: #888; font-size: 12px;">
                            © 2026 Q-Sense OS
                        </div>
                    </div>
                `
            };

           
            transporter.sendMail(mailOptions, (error, info) => {
                if (error) console.error("Failed to send confirmation email:", error);
                else console.log("Confirmation email sent to:", guest.email);
            });
        }

        // Send success back to the Admin Dashboard immediately
        res.json({ message: "Table successfully allocated and customer notified!" });
        
    } catch (error) {
        await db.query('ROLLBACK');
        console.error("Error allocating table:", error);
        res.status(500).json({ message: "Failed to allocate table." });
    }
});

module.exports = router;
