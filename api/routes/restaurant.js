// api/routes/restaurant.js
// Restaurant data endpoints
// Bug B Fixed: Merged duplicate router.get('/') into one handler

const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { rankByConvenience } = require('../utils/scoring');
const { bfsReachable, dfsPath } = require('../utils/graphSearch');
const { GoogleGenAI } = require('@google/genai');

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

// Shared query: restaurants with their live queue length, needed by
// both /recommended and /reachable to compute real wait estimates.
async function getRestaurantsWithQueueLoad() {
    const [rows] = await db.query(`
        SELECT r.restaurant_id, r.name, r.location, r.status, r.latitude, r.longitude,
               COUNT(q.queue_id) FILTER (WHERE q.status = 'waiting') AS waiting_count
        FROM restaurant r
        LEFT JOIN queue q ON q.restaurant_id = r.restaurant_id
        WHERE r.status = 'open'
        GROUP BY r.restaurant_id
    `);
    return rows;
}

// ── GET /api/restaurant ──────────────────────────────────────────────
// Returns all restaurants with location and coordinates
// Bug B: Previously two competing GET '/' handlers existed.
// The second one (filtering status='open') was dead code.
// Now merged into one complete handler.
router.get('/', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT restaurant_id, name, location, status, latitude, longitude
             FROM restaurant
             ORDER BY name ASC`
        );
        res.json(rows);
    } catch (error) {
        console.error('Error fetching restaurants:', error.message);
        res.status(500).json({ message: 'Failed to load restaurants.' });
    }
});

// ── GET /api/restaurant/open ─────────────────────────────────────────
// Returns only open restaurants (what the old dead handler intended)
router.get('/open', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT restaurant_id, name, location, latitude, longitude
             FROM restaurant
             WHERE status = 'open'
             ORDER BY name ASC`
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load restaurants.' });
    }
});

// ── GET /api/restaurant/recommended ──────────────────────────────────
// "Most convenient restaurant" ranking — combines real distance from
// the customer's location with real current wait (queue length * 5
// min, same formula queue.js already uses). This is deterministic
// scoring, not something delegated to an LLM — see api/utils/scoring.js.
//
// Query params: lat, lng (required), limit (default 5), explain
// (optional — if "true", asks Gemini for a one-line plain-language
// explanation of the #1 pick, using the real computed numbers; this
// is the ONLY part of this endpoint that touches AI, and it narrates
// a decision the scoring already made, it doesn't make the decision).
router.get('/recommended', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const limit = parseInt(req.query.limit, 10) || 5;

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return res.status(400).json({ message: 'lat and lng query parameters are required.' });
    }

    try {
        const restaurants = await getRestaurantsWithQueueLoad();
        const ranked = rankByConvenience(lat, lng, restaurants).slice(0, limit);

        let explanation = null;
        if (req.query.explain === 'true' && ranked.length > 0 && ai) {
            const top = ranked[0];
            const runnerUp = ranked[1] || null;
            try {
                const prompt = `In one short sentence (under 30 words), explain why "${top.name}" ` +
                    `(${top.distance_km}km away, ${top.estimated_wait_min}min estimated wait) is a ` +
                    `convenient pick right now` +
                    (runnerUp ? `, optionally comparing briefly to "${runnerUp.name}" (${runnerUp.distance_km}km, ${runnerUp.estimated_wait_min}min wait)` : '') +
                    `. Only use these exact numbers — don't invent any other details.`;

                const response = await ai.models.generateContent({
                    model: geminiModel,
                    contents: prompt,
                    config: { maxOutputTokens: 100, temperature: 0.3 }
                });
                explanation = (response.text || '').trim() || null;
            } catch (explainError) {
                console.error('Recommendation explanation error:', explainError.message);
                // Explanation is a nice-to-have — never fail the whole
                // request just because the narration call failed.
            }
        }

        res.json({ recommendations: ranked, explanation });
    } catch (error) {
        console.error('Error computing recommendations:', error.message);
        res.status(500).json({ message: 'Failed to compute recommendations.' });
    }
});

// ── GET /api/restaurant/reachable ────────────────────────────────────
// Real BFS/DFS graph traversal — see api/utils/graphSearch.js for the
// honest limitation (straight-line "walkable hop" proximity, not real
// road-network routing).
//
// Query params: lat, lng (required), algorithm ("bfs" default, or
// "dfs"), max_hops (default 2 for bfs, 3 for dfs), walk_km (default 1.2)
router.get('/reachable', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const algorithm = req.query.algorithm === 'dfs' ? 'dfs' : 'bfs';
    const walkKm = parseFloat(req.query.walk_km) || undefined;

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return res.status(400).json({ message: 'lat and lng query parameters are required.' });
    }

    try {
        const restaurants = await getRestaurantsWithQueueLoad();
        const options = { walkKm };

        let result;
        if (algorithm === 'dfs') {
            options.maxHops = parseInt(req.query.max_hops, 10) || 3;
            result = dfsPath(lat, lng, restaurants, options);
        } else {
            options.maxHops = parseInt(req.query.max_hops, 10) || 2;
            result = bfsReachable(lat, lng, restaurants, options);
        }

        res.json({ algorithm, restaurants: result });
    } catch (error) {
        console.error('Error computing reachable restaurants:', error.message);
        res.status(500).json({ message: 'Failed to compute reachable restaurants.' });
    }
});

// ── GET /api/restaurant/:id ──────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT * FROM restaurant WHERE restaurant_id = $1',
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Restaurant not found.' });
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load restaurant.' });
    }
});

module.exports = router;
