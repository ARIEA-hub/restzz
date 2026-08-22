// api/routes/admin.js
// Admin Auth & Dashboard Operations

const express    = require('express');
const router     = express.Router();
const db         = require('../database');
const bcrypt     = require('bcrypt');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
// Shared in-memory OTP store — see api/utils/otpStore.js. Required (not a
// locally-generated OTP) so that POST /api/verify-otp in otp.js can find
// and validate the code generated below.
const otpStore    = require('../utils/otpStore');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,  // Was hardcoded — now from .env
        pass: process.env.EMAIL_PASS   // Was hardcoded — now from .env
    }
});

// ── POST /api/admin/register ─────────────────────────────────────────
// FLOW D: Creates admin account with is_verified=false, sends OTP.
router.post('/register', async (req, res) => {
    const { restaurant_id, name, email, phone, password, role } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 12);

        const [rows] = await db.query(
            `INSERT INTO admin (restaurant_id, name, email, phone, password, role, is_verified)
             VALUES ($1, $2, $3, $4, $5, $6, false)
             RETURNING admin_id`,
            [restaurant_id, name, email, phone, hashedPassword, role || 'staff']
        );

        const newAdminId = rows[0].admin_id;

        // Send OTP for account activation.
        // Written into the SHARED otpStore (same object otp.js reads from)
        // so that POST /api/verify-otp can actually validate it — the
        // previous version generated and emailed an OTP but never stored
        // it anywhere, so verification always failed.
        const otp = Math.floor(100000 + Math.random() * 900000);
        const expiryMins = parseInt(process.env.OTP_EXPIRY_MINS || '10');
        otpStore[email] = {
            otp,
            role: role || 'staff',
            expiresAt: Date.now() + (expiryMins * 60 * 1000)
        };

        await transporter.sendMail({
            from: `"Q-Sense Admin" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Activate Your Q-Sense Admin Account',
            text: `Hello ${name},\n\nYour admin account verification code is: ${otp}\n\nEnter this code to activate your account.`
        });

        res.json({
            message: 'Admin registered. Please check your email for the verification code.',
            admin_id: newAdminId,
            requires_otp: true
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ── POST /api/admin/login ────────────────────────────────────────────
// FLOW D: Pure bcrypt check + is_verified guard. NO OTP at login.
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const [rows] = await db.query(
            'SELECT * FROM admin WHERE email = $1',
            [email]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const admin = rows[0];

        const valid = await bcrypt.compare(password, admin.password);
        if (!valid) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // FLOW D: Block unverified admin accounts
        if (!admin.is_verified) {
            return res.status(403).json({
                message: 'Account not verified. Please complete email verification first.',
                requires_otp: true,
                email: admin.email
            });
        }

        // Issue JWT — no OTP
        const token = jwt.sign(
            { admin_id: admin.admin_id, restaurant_id: admin.restaurant_id, role: admin.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRY || '24h' }
        );

        res.json({
            message: 'Login successful',
            admin_id: admin.admin_id,
            restaurant_id: admin.restaurant_id,
            role: admin.role,
            token
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ── GET /api/admin/:id ───────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const [rows] = await db.query(
            'SELECT name, email, phone, role, restaurant_id FROM admin WHERE admin_id = $1',
            [id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Admin not found' });
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ── GET /api/admin/reservations/pending/:restaurantId ────────────────
// Bug A fix: DATE_FORMAT → TO_CHAR (PostgreSQL)
router.get('/reservations/pending/:restaurantId', async (req, res) => {
    const restaurantId = req.params.restaurantId;

    try {
        const query = `
            SELECT
                r.reserve_id,
                u.name   AS customer_name,
                u.phone,
                r.group_size,
                TO_CHAR(r.reserve_date, 'FMMonth FMDD, YYYY') AS date,
                TO_CHAR(r.reserve_time::time, 'HH12:MI AM')   AS time
            FROM reservation r
            JOIN customer u ON r.customer_id = u.customer_id
            WHERE r.restaurant_id = $1
              AND r.status = 'reserved'
              AND r.table_id IS NULL
            ORDER BY r.reserve_date ASC, r.reserve_time ASC
        `;
        const [rows] = await db.query(query, [restaurantId]);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching pending reservations:', error);
        res.status(500).json({ message: 'Failed to fetch reservations.' });
    }
});

// ── PUT /api/admin/reservations/:reserveId/allocate ──────────────────
// Transaction rewritten with proper pg client (getClient) pattern
router.put('/reservations/:reserveId/allocate', async (req, res) => {
    const reserveId = req.params.reserveId;
    const { table_id } = req.body;

    const client = await db.getClient();   // Acquire dedicated connection for transaction
    try {
        await client.query('BEGIN');

        await client.query(
            'UPDATE reservation SET table_id = $1 WHERE reserve_id = $2',
            [table_id, reserveId]
        );

        await client.query(
            "UPDATE restaurant_tables SET status = 'reserved' WHERE table_id = $1",
            [table_id]
        );

        await client.query('COMMIT');

    } catch (txError) {
        await client.query('ROLLBACK');
        client.release();
        console.error('Transaction error during allocation:', txError);
        return res.status(500).json({ message: 'Failed to allocate table.' });
    }

    client.release();   // Release back to pool after transaction

    // After transaction, fetch customer info for notification email
    try {
        const [customerInfo] = await db.query(`
            SELECT c.email, c.name, r.reserve_date, t.table_no
            FROM reservation r
            JOIN customer c ON r.customer_id = c.customer_id
            JOIN restaurant_tables t ON r.table_id = t.table_id
            WHERE r.reserve_id = $1
        `, [reserveId]);

        if (customerInfo.length > 0) {
            const guest = customerInfo[0];
            const formattedDate = new Date(guest.reserve_date).toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric'
            });

            const mailOptions = {
                from: `"Q-Sense Reservations" <${process.env.EMAIL_USER}>`,
                to: guest.email,
                subject: '🎉 Your Table is Confirmed!',
                html: `
                    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e1e8ed;border-radius:10px;overflow:hidden;">
                        <div style="background:#3178c6;padding:20px;text-align:center;color:white;">
                            <h1 style="margin:0;font-size:24px;">Table Confirmed!</h1>
                        </div>
                        <div style="padding:30px;background:#f8fbff;text-align:center;">
                            <h2 style="color:#333;margin-top:0;">Hi ${guest.name},</h2>
                            <p style="color:#555;font-size:16px;">Your reservation has been confirmed and a table allocated.</p>
                            <div style="background:#fff;border:2px dashed #3178c6;border-radius:8px;padding:20px;margin:25px 0;">
                                <h3 style="margin:0;color:#3178c6;font-size:22px;">Table ${guest.table_no}</h3>
                                <p style="margin:10px 0 0;color:#666;font-weight:bold;">📅 ${formattedDate}</p>
                            </div>
                            <p style="color:#777;font-size:14px;">Please check in at the host stand when you arrive.</p>
                        </div>
                        <div style="background:#f4f7f9;padding:15px;text-align:center;color:#888;font-size:12px;">
                            © 2026 Q-Sense OS
                        </div>
                    </div>
                `
            };

            transporter.sendMail(mailOptions, (err) => {
                if (err) console.error('Failed to send confirmation email:', err.message);
                else console.log('Confirmation email sent to:', guest.email);
            });
        }

        res.json({ message: 'Table successfully allocated and customer notified!' });

    } catch (error) {
        console.error('Post-transaction error:', error);
        res.status(500).json({ message: 'Table allocated but notification failed.' });
    }
});

module.exports = router;
