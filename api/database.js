// api/database.js
// PostgreSQL connection pool for Supabase
// Uses pg (node-postgres) instead of mysql2

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL is not set in .env');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false   // Required for Supabase pooler
    },
    max: 10,                        // Maximum pool connections
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err.message);
});

// ------------------------------------------------------------------
// db.query(text, params)
//   Returns [rows] to match mysql2's array destructuring convention.
//   Example:  const [rows] = await db.query('SELECT ...', [id]);
//
// For INSERT with RETURNING:
//   const [rows] = await db.query('INSERT ... RETURNING id', [...]);
//   const newId = rows[0].id;
// ------------------------------------------------------------------
const db = {
    query: async (text, params) => {
        const result = await pool.query(text, params);
        return [result.rows];   // Wrap in array to match mysql2 pattern
    },

    // Use getClient() for multi-statement transactions
    // Remember to call client.release() in finally block
    getClient: () => pool.connect()
};

module.exports = db;
