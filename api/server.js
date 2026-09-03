// api/server.js
// Q-Sense Express Entry Point

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const express = require('express');
const cors    = require('cors');
const db      = require('./database.js');
const app     = express();

const allowedOrigins = [
    'http://127.0.0.1:5500',
    'http://127.0.0.1:5501',
    'http://localhost:5500',
    'http://localhost:5501',
    process.env.FRONTEND_ORIGIN
].filter(Boolean);

// ── CORS ────────────────────────────────────────────────────────────
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true
}));

app.use(express.json());

// ── HEALTH CHECKS ───────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Q-Sense Backend Running', version: '2.0.0' });
});

app.get('/test-db', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT NOW() AS server_time');
        res.json({
            message: 'Database Connected Successfully.',
            server_time: rows[0].server_time
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ── API ROUTES ───────────────────────────────────────────────────────
const userRoutes        = require('./routes/users');
const adminRoutes       = require('./routes/admin');
const restRoutes        = require('./routes/restaurant');
const tableRoutes       = require('./routes/tables');
const otpRoutes         = require('./routes/otp');
const reservationRoutes = require('./routes/reservations');
const queueRoutes       = require('./routes/queue');
const locationRoutes    = require('./routes/location');   // NEW — Feature C
const chatbotRoutes = require('./routes/chatbots');

app.use('/api/users',        userRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/restaurant',   restRoutes);
app.use('/api/tables',       tableRoutes);
app.use('/api',              otpRoutes);        // Mounts: /api/send-otp, /api/verify-otp
app.use('/api/reservations', reservationRoutes);
app.use('/api/queue',        queueRoutes);
app.use('/api/location',     locationRoutes);   // NEW — Feature C
app.use('/api/restaurant',   restRoutes);
app.use('/api/restaurants',  restRoutes);
app.use('/api/chatbots', chatbotRoutes);

// ── GLOBAL ERROR HANDLER (Express 5 requires this) ──────────────────
app.use((err, req, res, next) => {
    console.error('[Global Error]', err.stack);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// ── START SERVER ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ Q-Sense server running on port ${PORT}`);
    console.log(`   CORS origin: ${process.env.FRONTEND_ORIGIN}`);
});
