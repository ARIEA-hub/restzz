// api/routes/users.js
// Customer Auth — Registration with OTP Activation, Login with JWT (Flow D)

const express      = require('express');
const router       = express.Router();
const db           = require('../database');
const bcrypt       = require('bcrypt');
const jwt          = require('jsonwebtoken');
const nodemailer   = require('nodemailer');

// ── EMAIL TRANSPORTER ────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: { rejectUnauthorized: false }
});

// Shared in-memory OTP store (keyed by email) — see api/utils/otpStore.js.
// Using the shared module (not a local object) so that otp.js's
// POST /api/verify-otp can see the OTP that was generated here during
// registration. In production, replace with Redis or a DB table with expiry.
const otpStore = require('../utils/otpStore');

function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000);
}

async function sendRegistrationOtp(email, name) {
    const otp = generateOtp();
    otpStore[email] = {
        otp,
        role: 'customer',
        expiresAt: Date.now() + (parseInt(process.env.OTP_EXPIRY_MINS || '10') * 60 * 1000)
    };

    await transporter.sendMail({
        from: `"Q-Sense" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Activate Your Q-Sense Account',
        html: `
            <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e1e8ed;border-radius:10px;overflow:hidden;">
                <div style="background:#3178c6;padding:20px;text-align:center;color:white;">
                    <h2 style="margin:0;">Welcome to Q-Sense, ${name}!</h2>
                </div>
                <div style="padding:30px;text-align:center;">
                    <p>Your account verification code is:</p>
                    <h1 style="letter-spacing:12px;color:#3178c6;font-size:2.5rem;">${otp}</h1>
                    <p style="color:#888;font-size:13px;">This code expires in ${process.env.OTP_EXPIRY_MINS || 10} minutes.</p>
                </div>
                <div style="background:#f4f7f9;padding:10px;text-align:center;color:#aaa;font-size:11px;">
                    © 2026 Q-Sense OS
                </div>
            </div>
        `
    });

    return true;
}

// ── POST /api/users/register ─────────────────────────────────────────
// FLOW D: Creates account with is_verified=false, then sends OTP.
// The account is NOT active until OTP is verified via POST /api/verify-otp
router.post('/register', async (req, res) => {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !phone || !password) {
        return res.status(400).json({ error: 'All fields (name, email, phone, password) are required.' });
    }

    try {
        // Check if email already exists
        const [existing] = await db.query(
            'SELECT customer_id FROM customer WHERE email = $1',
            [email]
        );
        if (existing.length > 0) {
            return res.status(409).json({ error: 'An account with this email already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        // Insert with is_verified = false — account is inactive until OTP verified
        const [rows] = await db.query(
            `INSERT INTO customer (name, email, phone, password, is_guest, is_verified)
             VALUES ($1, $2, $3, $4, false, false)
             RETURNING customer_id`,
            [name, email, phone, hashedPassword]
        );

        const newCustomerId = rows[0].customer_id;

        // Send OTP immediately after account creation
        await sendRegistrationOtp(email, name);

        res.status(201).json({
            message: 'Account created. Please check your email for the verification code.',
            customer_id: newCustomerId,
            requires_otp: true   // Frontend should redirect to OTP page
        });

    } catch (error) {
        console.error('[Register Error]', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ── POST /api/users/login ────────────────────────────────────────────
// FLOW D: Pure password check + is_verified guard. NO OTP at login.
// Returns JWT token on success.
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }

    try {
        const [rows] = await db.query(
            'SELECT * FROM customer WHERE email = $1',
            [email]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const user = rows[0];

        // Check password
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        // FLOW D: Block unverified accounts from logging in
        if (!user.is_verified) {
            return res.status(403).json({
                message: 'Account not verified. Please complete email verification first.',
                requires_otp: true,
                email: user.email
            });
        }

        // Issue JWT — no OTP needed anymore
        const token = jwt.sign(
            { customer_id: user.customer_id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRY || '24h' }
        );

        res.json({
            message: 'Login successful',
            customer_id: user.customer_id,
            token   // Frontend stores this in localStorage
        });

    } catch (error) {
        console.error('[Login Error]', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ── GET /api/users/:id ───────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT name, email, phone FROM customer WHERE customer_id = $1',
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
