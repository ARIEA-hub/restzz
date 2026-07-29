const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Required for secure cloud connections
    }
});

// Wrapper to match your existing pool promise execution behavior
module.exports = {
    query: (text, params) => pool.query(text, params)
};
