// api/routes/admin.js
// Admin Auth & Dashboard Operations

const express    = require('express');
const router     = express.Router();
const db         = require('../database');
const bcrypt     = require('bcrypt');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { GoogleGenAI } = require('@google/genai');

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
// Shared in-memory OTP store — see api/utils/otpStore.js. Required (not a
// locally-generated OTP) so that POST /api/verify-otp in otp.js can find
// and validate the code generated below.
const otpStore    = require('../utils/otpStore');
const { requireAdmin } = require('../utils/auth');
const { findPeakHours } = require('../utils/kmeans');

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

// ── GET /api/admin/reservations/restaurant/:restaurantId ────────────
router.get('/reservations/restaurant/:restaurantId', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                r.reserve_id,
                c.name AS customer_name,
                c.phone,
                r.group_size,
                r.status,
                TO_CHAR(r.reserve_date, 'FMMonth FMDD, YYYY') AS date,
                TO_CHAR(r.reserve_time::time, 'HH12:MI AM') AS time,
                t.table_no
            FROM reservation r
            JOIN customer c ON r.customer_id = c.customer_id
            LEFT JOIN restaurant_tables t ON r.table_id = t.table_id
            WHERE r.restaurant_id = $1
            ORDER BY r.reserve_date DESC, r.reserve_time DESC
        `, [req.params.restaurantId]);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching restaurant reservations:', error);
        res.status(500).json({ message: 'Failed to fetch restaurant reservations.' });
    }
});

// ── POST /api/admin/reservations/auto-allocate/:restaurantId ────────
// Assigns the earliest unassigned reservation to the smallest suitable free table.
router.post('/reservations/auto-allocate/:restaurantId', async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const reservationResult = await client.query(
            `SELECT reserve_id, group_size
             FROM reservation
             WHERE restaurant_id = $1
               AND status = 'reserved'
               AND table_id IS NULL
             ORDER BY reserve_date ASC, reserve_time ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
            [req.params.restaurantId]
        );

        if (reservationResult.rows.length === 0) {
            await client.query('COMMIT');
            client.release();
            return res.json({ allocated: false, message: 'No unassigned reservations are waiting.' });
        }

        const reservation = reservationResult.rows[0];
        const tableResult = await client.query(
            `SELECT table_id, table_no, capacity
             FROM restaurant_tables
             WHERE restaurant_id = $1
               AND status = 'vacant'
               AND capacity >= $2
             ORDER BY capacity ASC, table_no ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
            [req.params.restaurantId, reservation.group_size]
        );

        if (tableResult.rows.length === 0) {
            await client.query('COMMIT');
            client.release();
            return res.json({ allocated: false, message: 'No suitable free table is available for the next reservation.' });
        }

        const table = tableResult.rows[0];
        await client.query(
            'UPDATE reservation SET table_id = $1 WHERE reserve_id = $2',
            [table.table_id, reservation.reserve_id]
        );
        await client.query(
            "UPDATE restaurant_tables SET status = 'reserved' WHERE table_id = $1",
            [table.table_id]
        );

        await client.query('COMMIT');
        client.release();
        res.json({ allocated: true, reserve_id: reservation.reserve_id, table_no: table.table_no });
    } catch (error) {
        await client.query('ROLLBACK');
        client.release();
        console.error('Auto reservation allocation error:', error);
        res.status(500).json({ message: 'Failed to auto-allocate reservation.' });
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


// ── GET /api/admin/customer-summary/:customerId ──────────────────────
// Plain-language summary of a customer's booking behavior for admin
// staff — real computed stats (not invented ones) narrated by Gemini.
// This is the ONE place Gemini is used here: it only phrases numbers
// that were already computed from the database, it doesn't decide or
// invent anything about the customer.
//
// NOTE ON SCOPE: most other admin routes in this file currently have
// NO JWT verification at all (a pre-existing gap from before this
// change, not something introduced here) — this new endpoint adds
// real admin-token verification since it's new code, but it's
// currently the exception rather than the rule. Worth a dedicated
// pass to add the same protection everywhere else.
function getAuthenticatedAdmin(req) {
    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) return null;
    try {
        return jwt.verify(authorization.slice(7), process.env.JWT_SECRET);
    } catch (error) {
        return null;
    }
}

router.get('/customer-summary/:customerId', async (req, res) => {
    const admin = getAuthenticatedAdmin(req);
    if (!admin) {
        return res.status(401).json({ message: 'Admin login required.' });
    }

    const customerId = req.params.customerId;

    try {
        const [customerRows] = await db.query(
            'SELECT name, email, phone, created_at FROM customer WHERE customer_id = $1',
            [customerId]
        );
        if (customerRows.length === 0) {
            return res.status(404).json({ message: 'Customer not found.' });
        }
        const customer = customerRows[0];

        const [reservationStats] = await db.query(`
            SELECT status, COUNT(*) AS count, AVG(group_size) AS avg_party_size
            FROM reservation
            WHERE customer_id = $1
            GROUP BY status
        `, [customerId]);

        const [queueStats] = await db.query(`
            SELECT status, COUNT(*) AS count
            FROM queue
            WHERE customer_id = $1
            GROUP BY status
        `, [customerId]);

        const totalReservations = reservationStats.reduce((sum, r) => sum + parseInt(r.count, 10), 0);
        const noShowCount = parseInt(reservationStats.find((r) => r.status === 'no_show')?.count || 0, 10);
        const completedCount = parseInt(reservationStats.find((r) => r.status === 'completed')?.count || 0, 10);
        const cancelledCount = parseInt(reservationStats.find((r) => r.status === 'cancelled')?.count || 0, 10);
        const avgPartySize = reservationStats.length
            ? (reservationStats.reduce((sum, r) => sum + (parseFloat(r.avg_party_size) || 0) * parseInt(r.count, 10), 0) / (totalReservations || 1)).toFixed(1)
            : null;
        const noShowRate = totalReservations > 0 ? Math.round((noShowCount / totalReservations) * 100) : null;

        const stats = {
            total_reservations: totalReservations,
            completed: completedCount,
            cancelled: cancelledCount,
            no_show: noShowCount,
            no_show_rate_percent: noShowRate,
            avg_party_size: avgPartySize,
            queue_joins: queueStats.reduce((sum, q) => sum + parseInt(q.count, 10), 0),
            queue_left_early: parseInt(queueStats.find((q) => q.status === 'left')?.count || 0, 10),
            customer_since: customer.created_at
        };

        let summary = null;
        if (ai) {
            try {
                const prompt = `Write a brief (under 50 words), plain-language summary of this customer's
                    booking behavior for a restaurant staff member. Use ONLY these real numbers, don't
                    invent anything: ${JSON.stringify(stats)}. If total_reservations is 0, just say they
                    haven't booked yet. Be neutral and factual, not judgmental.`;

                const response = await ai.models.generateContent({
                    model: geminiModel,
                    contents: prompt,
                    config: { maxOutputTokens: 120, temperature: 0.2 }
                });
                summary = (response.text || '').trim() || null;
            } catch (summaryError) {
                console.error('Customer summary narration error:', summaryError.message);
                // Stats are still useful without the narration — don't fail the request.
            }
        }

        res.json({ customer: { name: customer.name, email: customer.email, phone: customer.phone }, stats, summary });

    } catch (error) {
        console.error('Error building customer summary:', error);
        res.status(500).json({ message: 'Failed to build customer summary.' });
    }
});


// ── GET /api/admin/analytics/peak-hours/:restaurantId ────────────────
// Unsupervised peak-hour discovery (api/utils/kmeans.js): K-means over the
// time of day of every booking/arrival. Admin-only.
//
// Query params: source = "all" (default) | "reservations" | "queue";
// k (optional — chosen by silhouette score if omitted); days (lookback,
// default 90).
//
// Times are converted to the restaurant's local time (RESTAURANT_TZ,
// default Asia/Kolkata) — timestamptz values come back from Supabase in
// UTC, which would put the dinner rush at 14:30.
router.get('/analytics/peak-hours/:restaurantId', requireAdmin, async (req, res) => {
    const { restaurantId } = req.params;
    const source = ['reservations', 'queue'].includes(req.query.source) ? req.query.source : 'all';
    const k = parseInt(req.query.k, 10) || undefined;
    const days = Math.min(parseInt(req.query.days, 10) || 90, 730);
    const tz = process.env.RESTAURANT_TZ || 'Asia/Kolkata';

    try {
        const minutes = [];
        if (source !== 'queue') {
            // reserve_time is a plain TIME — already local, no conversion.
            const [rows] = await db.query(`
                SELECT EXTRACT(HOUR FROM reserve_time) * 60 + EXTRACT(MINUTE FROM reserve_time) AS m
                FROM reservation
                WHERE restaurant_id = $1
                  AND status <> 'cancelled'
                  AND reserve_date >= CURRENT_DATE - $2::int
            `, [restaurantId, days]);
            rows.forEach((r) => minutes.push(Number(r.m)));
        }
        if (source !== 'reservations') {
            const [rows] = await db.query(`
                SELECT EXTRACT(HOUR FROM joined_at AT TIME ZONE $3) * 60
                     + EXTRACT(MINUTE FROM joined_at AT TIME ZONE $3) AS m
                FROM queue
                WHERE restaurant_id = $1
                  AND joined_at >= NOW() - ($2::int * INTERVAL '1 day')
            `, [restaurantId, days, tz]);
            rows.forEach((r) => minutes.push(Number(r.m)));
        }

        const hourly = Array(24).fill(0);
        minutes.forEach((m) => { hourly[Math.floor(m / 60) % 24]++; });

        if (minutes.length < 10) {
            return res.json({
                source, days, samples: minutes.length, hourly, k: 0, clusters: [],
                message: 'Not enough bookings yet to find meaningful peak hours (need at least 10).'
            });
        }

        res.json({ source, days, samples: minutes.length, hourly, ...findPeakHours(minutes, { k }) });
    } catch (error) {
        console.error('Peak-hour analytics error:', error);
        res.status(500).json({ message: 'Failed to compute peak hours.' });
    }
});

module.exports = router;
