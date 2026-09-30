const express = require('express');
const router = express.Router();
const db = require('../database.js');
const { GoogleGenAI } = require('@google/genai');
const jwt = require('jsonwebtoken');
const { rankByConvenience } = require('../utils/scoring');
const { predictWait } = require('../utils/waitPredictor');
const { createReservation, joinQueue } = require('../utils/bookings');

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

function extractReplyText(response) {
    if (!response) return '';

    if (typeof response.text === 'string' && response.text.trim()) return response.text.trim();
    if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text.trim();

    const candidates = response.candidates || response.response?.candidates || [];
    const textFromCandidates = candidates
        .map(candidate => {
            const parts = candidate?.content?.parts || candidate?.parts || [];
            return parts
                .map(part => part?.text || '')
                .join('')
                .trim();
        })
        .filter(Boolean)
        .join('\n')
        .trim();

    if (textFromCandidates) return textFromCandidates;

    return '';
}

function isTopicRelevant(message) {
    const text = (message || '').toLowerCase().trim();
    if (!text) return false;

    const allowedKeywords = [
        'reservation', 'reserve', 'book', 'booking', 'table', 'tables', 'queue', 'waitlist', 'waiting',
        'wait time', 'restaurant', 'restaurants', 'location', 'locations', 'food', 'menu', 'dining',
        'seating', 'seat', 'check-in', 'cancel', 'line', 'table availability', 'opening time', 'hours',
        'service', 'order', 'pickup', 'bar', 'cafe', 'lounge', 'restaurant info', 'cuisine', 'meal',
        'reservation status', 'queue status', 'available table', 'join queue', 'dinner', 'lunch', 'breakfast',
        'brunch', 'eat', 'dine', 'have dinner', 'have lunch', 'food place', 'restaurant booking', 'table for',
        'reserve a table', 'book a table', 'booking a table', 'join the queue', 'queue for', 'waitlist for',
        'estimated wait', 'estimated wait time'
    ];

    const greetingKeywords = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'thanks', 'thank you'];
    const generalHelpKeywords = ['help', 'can you help', 'what can you do', 'how do i', 'where can i'];

    const containsPhrase = (keyword) => {
        const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^a-z])${escapedKeyword}(?=$|[^a-z])`).test(text);
    };

    const hasAllowedTopic = allowedKeywords.some(containsPhrase);
    const hasGreeting = greetingKeywords.some(containsPhrase);
    const hasGeneralHelp = generalHelpKeywords.some(containsPhrase);

    return hasAllowedTopic || hasGreeting || hasGeneralHelp;
}

const supportedFaqQuestions = [
    'Which restaurants are open right now?',
    'How do I book a table?',
    'Can I reserve a table for 2 tonight?',
    'What is my current queue position?',
    'How long is the estimated wait?',
    'How do I leave the queue?',
    'Am I in more than one queue?',
    'How do I cancel a reservation?'
];

function getFaqResponse(message, restaurantRows, queueRows) {
    const question = message.toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
    const has = (...keywords) => keywords.every((keyword) => question.includes(keyword));

    if (has('table', '2') && (question.includes('tonight') || question.includes('today'))) {
        return 'Yes, you can request a table for 2 tonight. Open Reservation, select a restaurant, choose party size 2, select tonight and an available time, then confirm.';
    }

    if (has('book', 'table') || has('reserve', 'table')) {
        return 'To book a table, open Reservation, choose a restaurant, party size, date, and time, then select Confirm Reservation.';
    }

    if (has('cancel', 'reservation') || has('cancel', 'booking')) {
        return 'Open your Dashboard, find the booking under upcoming reservations, and choose Cancel reservation. If a table was already set aside, it is released for other guests.';
    }

    if (question === 'which restaurants are open right now') {
        const openRestaurants = restaurantRows.filter((restaurant) => restaurant.status === 'open');
        if (!openRestaurants.length) return 'No restaurants are currently marked as open.';

        const names = openRestaurants.map((restaurant) => restaurant.name).join(', ');
        return `Currently open restaurants are: ${names}.`;
    }

    if (has('queue', 'position') || has('position', 'queue') || has('where', 'queue')) {
        if (!queueRows.length) return 'You are not currently in an active queue.';

        if (queueRows.length > 1) {
            const queues = queueRows.map((queue) => `${queue.restaurant_name} at position ${queue.position}`).join('; ');
            return `You are currently in ${queueRows.length} active queues: ${queues}.`;
        }

        const queue = queueRows[0];
        return `You are currently number ${queue.position} in the queue at ${queue.restaurant_name}.`;
    }

    if ((question.includes('more than one') || question.includes('multiple') || question.includes('how many')) &&
        (question.includes('queue') || question.includes('waitlist') || question.includes('line'))) {
        if (!queueRows.length) return 'You are not currently in an active queue.';
        if (queueRows.length === 1) return `You are currently in one active queue at ${queueRows[0].restaurant_name}.`;

        const names = queueRows.map((queue) => queue.restaurant_name).join(', ');
        return `Yes. You are currently in ${queueRows.length} active queues: ${names}.`;
    }

    if ((question.includes('queue') || question.includes('wait')) &&
        (question.includes('estimated') || question.includes('how long') || question.includes('time'))) {
        if (!queueRows.length) return 'You do not currently have an active queue wait time.';

        const queue = queueRows[0];
        return `Your estimated wait at ${queue.restaurant_name} is ${queue.estimated_wait_minutes} minutes.`;
    }

    if (has('leave', 'queue') || has('exit', 'queue') || has('remove', 'queue')) {
        return 'The customer Leave Queue option is not currently available in the app. Please ask the restaurant host to remove your queue entry.';
    }

    if ((question.includes('join') || question.includes('enter')) &&
        (question.includes('queue') || question.includes('waitlist') || question.includes('line'))) {
        return 'To join a queue, open a restaurant location, select Join Live Queue, choose your party size, and select Join Waitlist.';
    }

    return '';
}

router.post('/message', async (req, res, next) => {
    try {
        const { message, userId } = req.body;
        const authorization = req.headers.authorization || '';
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        let authenticatedUserId = null;

        if (token) {
            try {
                authenticatedUserId = jwt.verify(token, process.env.JWT_SECRET).customer_id;
            } catch (error) {
                return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
            }
        }

        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'Message content is required.' });
        }

        if (!isTopicRelevant(message)) {
            return res.json({
                reply: 'I mainly help with restaurant reservations, queue updates, table availability, wait times, and restaurant info. Ask me about booking a table or joining a queue.'
            });
        }

        if (!ai) {
            return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
        }

        const [restaurantRows] = await db.query(`
            SELECT r.restaurant_id, r.name, r.location, r.status,
                   COUNT(t.table_id) FILTER (WHERE t.status = 'vacant') AS vacant_tables,
                   COUNT(t.table_id) AS total_tables
            FROM restaurant r
            LEFT JOIN restaurant_tables t ON t.restaurant_id = r.restaurant_id
            GROUP BY r.restaurant_id, r.name, r.location, r.status
            ORDER BY r.name ASC
        `);

        let queueRows = [];
        let reservationRows = [];

        if (userId && authenticatedUserId && String(userId) === String(authenticatedUserId)) {
            [queueRows, reservationRows] = await Promise.all([
                db.query(
                    // Position counts everyone waiting ahead at that restaurant
                    // (a window over this customer's own rows would always say 1).
                    `SELECT q.queue_id, q.restaurant_id, q.group_size, q.status,
                            q.joined_at, r.name AS restaurant_name,
                            (SELECT COUNT(*) FROM queue a
                              WHERE a.restaurant_id = q.restaurant_id
                                AND a.status = 'waiting'
                                AND a.joined_at < q.joined_at)::int AS people_ahead,
                            (SELECT COUNT(*) FROM restaurant_tables t
                              WHERE t.restaurant_id = q.restaurant_id
                                AND t.status = 'vacant')::int AS vacant_tables
                     FROM queue q
                     JOIN restaurant r ON r.restaurant_id = q.restaurant_id
                     WHERE q.customer_id = $1 AND q.status IN ('waiting', 'called')
                     ORDER BY q.joined_at ASC`,
                    [userId]
                ).then(([rows]) => Promise.all(rows.map(async (row) => {
                    // Same wait prediction the queue page shows.
                    const estimate = await predictWait({
                        partySize: row.group_size,
                        peopleAhead: row.people_ahead,
                        tablesAvailable: row.vacant_tables
                    });
                    return { ...row, position: row.people_ahead + 1, estimated_wait_minutes: estimate.minutes };
                }))),
                db.query(
                    `SELECT res.reserve_id, res.restaurant_id, res.reserve_date,
                            res.reserve_time, res.group_size, res.status,
                            r.name AS restaurant_name
                     FROM reservation res
                     JOIN restaurant r ON r.restaurant_id = res.restaurant_id
                     WHERE res.customer_id = $1 AND res.status = 'reserved'
                     ORDER BY res.reserve_date ASC, res.reserve_time ASC`,
                    [userId]
                ).then(([rows]) => rows)
            ]);
        }

        const liveContext = JSON.stringify({
            restaurants: restaurantRows,
            activeQueues: queueRows,
            upcomingReservations: reservationRows
        });

        const faqResponse = getFaqResponse(message, restaurantRows, queueRows);
        if (faqResponse) {
            return res.json({ reply: faqResponse });
        }

        const systemInstruction = `
            You are Q-Sense AI, the restaurant assistant inside the Q-Sense app.
            Answer only about restaurant locations, opening status, reservations, table availability,
            queue position, estimated wait times, cancellations, and dining services.
            Keep every answer brief, direct, and under 80 words. Give one answer only.
            Always finish with a complete sentence. Never stop after a comma, colon, or unfinished phrase.
            Never invent restaurant names, prices, availability, wait times, reservation details, or policies.
            Use the live data context below whenever the question needs current information.
            If the live data does not contain the answer, say that the information is not available right now.
            For unrelated questions, politely redirect the user to Q-Sense restaurant features.
            Supported FAQ questions include: ${supportedFaqQuestions.join(' | ')}
            Live data context: ${liveContext}
        `;

        const response = await ai.models.generateContent({
            model,
            contents: message,
            config: {
                systemInstruction,
                maxOutputTokens: 500,
                // Thinking tokens count against maxOutputTokens; for short Q&A
                // they only risk cutting the answer off.
                thinkingConfig: { thinkingBudget: 0 },
                temperature: 0.2
            }
        });

        const reply = extractReplyText(response) || 'I could not generate a response for that question.';
        console.log('Gemini reply for:', message, '=>', reply);

        res.json({ reply });
    } catch (error) {
        console.error('Chatbot error:', error);

        if (error?.status === 404 || error?.error?.code === 404) {
            return res.status(502).json({
                error: `Gemini model "${model}" is unavailable for this API key. Set GEMINI_MODEL to an available model.`
            });
        }

        next(error);
    }
});


// ============================================================
// Function-calling: let the chatbot actually book a table or
// join a queue, instead of only answering questions about them.
// ============================================================
function extractFunctionCall(response) {
    if (!response) return null;

    if (Array.isArray(response.functionCalls) && response.functionCalls.length > 0) {
        return response.functionCalls[0];
    }

    const candidates = response.candidates || response.response?.candidates || [];
    for (const candidate of candidates) {
        const parts = candidate?.content?.parts || candidate?.parts || [];
        for (const part of parts) {
            if (part?.functionCall) return part.functionCall;
        }
    }
    return null;
}

function resolveRestaurantByName(name, restaurantRows) {
    if (!name) return null;
    const normalized = name.trim().toLowerCase();

    let match = restaurantRows.find((r) => r.name.toLowerCase() === normalized);
    if (match) return match;

    match = restaurantRows.find((r) =>
        r.name.toLowerCase().includes(normalized) || normalized.includes(r.name.toLowerCase())
    );
    return match || null;
}

const bookTableDeclaration = {
    name: 'book_table',
    description: 'Books a table reservation for the currently logged-in customer at a specific restaurant, date, and time.',
    parameters: {
        type: 'OBJECT',
        properties: {
            restaurant_name: { type: 'STRING', description: "The restaurant's name, as the user said it." },
            group_size: { type: 'INTEGER', description: 'Number of people in the party.' },
            reserve_date: { type: 'STRING', description: 'Reservation date in YYYY-MM-DD format. Resolve relative dates like "tonight" or "tomorrow" to an actual date.' },
            reserve_time: { type: 'STRING', description: 'Reservation time in 24-hour HH:MM format.' }
        },
        required: ['restaurant_name', 'group_size', 'reserve_date', 'reserve_time']
    }
};

const joinQueueDeclaration = {
    name: 'join_queue',
    description: 'Joins the currently logged-in customer to the live walk-in waitlist at a specific restaurant, right now.',
    parameters: {
        type: 'OBJECT',
        properties: {
            restaurant_name: { type: 'STRING', description: "The restaurant's name, as the user said it." },
            group_size: { type: 'INTEGER', description: 'Number of people in the party.' }
        },
        required: ['restaurant_name', 'group_size']
    }
};

// Today's date and time on the restaurant's clock, so Gemini can turn
// "tonight" / "tomorrow at 8" into a real date instead of guessing one.
function restaurantNow() {
    const tz = process.env.RESTAURANT_TZ || 'Asia/Kolkata';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'long', hour12: false
    }).formatToParts(new Date()).map((p) => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday: parts.weekday, tz };
}

/** Gemini request config for booking/queue actions (shared with the live test). */
function buildActionConfig(openRestaurantNames, now = restaurantNow()) {
    return {
        systemInstruction: `You help customers book tables or join waitlists at Q-Sense restaurants.
            Today is ${now.weekday}, ${now.date}, and the time is ${now.time} (${now.tz}).
            Resolve relative dates and times ("tonight", "tomorrow at 8") from that, and output
            reserve_date as YYYY-MM-DD and reserve_time as 24-hour HH:MM.
            Open restaurants right now: ${openRestaurantNames.join(', ') || 'none currently open'}.
            If the user's message clearly requests booking a table or joining a queue, call the
            matching function. If required details are missing (date, time, or party size), do NOT
            call a function — ask a brief clarifying question in plain text instead.
            If the message isn't a booking/queue request, respond normally in plain text.`,
        tools: [{ functionDeclarations: [bookTableDeclaration, joinQueueDeclaration] }],
        // Some thinking helps resolve dates; the larger limit keeps it from
        // starving the function call (thinking counts against this limit).
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingLevel: 'low' },
        temperature: 0.1
    };
}

// ── POST /api/chatbots/action ────────────────────────────────────────
// Separate from /message (which stays pure Q&A) so this higher-stakes,
// harder-to-fully-verify-offline path can't destabilize the working
// chatbot. Requires login — booking/joining a queue always needs a
// real customer_id.
//
// Function-calling response shapes can vary slightly between
// @google/genai SDK versions; extractFunctionCall() above checks both the
// convenience `.functionCalls` array and the raw candidates/parts.
// Tested live with scripts/check_gemini_actions.js.
router.post('/action', async (req, res) => {
    try {
        const { message } = req.body;
        const authorization = req.headers.authorization || '';
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

        if (!token) {
            return res.status(401).json({ error: 'Please log in to book a table or join a queue through the chatbot.' });
        }

        let customerId;
        try {
            customerId = jwt.verify(token, process.env.JWT_SECRET).customer_id;
        } catch (error) {
            return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
        }

        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'Message content is required.' });
        }

        if (!ai) {
            return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
        }

        const [restaurantRows] = await db.query(
            `SELECT restaurant_id, name, status FROM restaurant WHERE status = 'open'`
        );

        const response = await ai.models.generateContent({
            model,
            contents: message,
            config: buildActionConfig(restaurantRows.map((r) => r.name))
        });

        const functionCall = extractFunctionCall(response);

        if (!functionCall) {
            const reply = extractReplyText(response) || "Could you clarify what you'd like to do?";
            return res.json({ reply, action: null });
        }

        const args = functionCall.args || {};
        const restaurant = resolveRestaurantByName(args.restaurant_name, restaurantRows);

        if (!restaurant) {
            return res.json({
                reply: `I couldn't find an open restaurant matching "${args.restaurant_name || 'that name'}". Could you double-check the name?`,
                action: null
            });
        }

        if (functionCall.name === 'book_table') {
            const { group_size, reserve_date, reserve_time } = args;
            if (!group_size || !reserve_date || !reserve_time) {
                const missing = [!group_size && 'party size', !reserve_date && 'date', !reserve_time && 'time']
                    .filter(Boolean).join(', ');
                return res.json({ reply: `To book at ${restaurant.name}, I still need the ${missing}.`, action: null });
            }

            // Same checks as the booking page (party fits a table, time not past).
            const booking = await createReservation({
                customerId,
                restaurantId: restaurant.restaurant_id,
                groupSize: group_size,
                date: reserve_date,
                time: reserve_time
            });
            if (booking.error) return res.json({ reply: booking.error, action: null });

            return res.json({
                reply: `Booked: a table for ${group_size} at ${restaurant.name} on ${reserve_date} at ${reserve_time}.`,
                action: { type: 'book_table', restaurant_id: restaurant.restaurant_id }
            });
        }

        if (functionCall.name === 'join_queue') {
            const { group_size } = args;
            if (!group_size) {
                return res.json({ reply: `How many people are in your party for ${restaurant.name}?`, action: null });
            }

            // Same path as the waitlist page, so the wait model's join-time
            // snapshot is recorded here too.
            const joined = await joinQueue({ customerId, restaurantId: restaurant.restaurant_id, groupSize: group_size });
            if (joined.error) return res.json({ reply: joined.error, action: null });

            return res.json({
                reply: `You're in the queue at ${restaurant.name} for ${group_size}.`,
                action: { type: 'join_queue', restaurant_id: restaurant.restaurant_id, queue_id: joined.queue_id }
            });
        }

        res.json({ reply: "I understood a request but couldn't complete it. Please try the Reservation or Join Queue page directly.", action: null });

    } catch (error) {
        console.error('Chatbot action error:', error);
        res.status(500).json({ error: 'Something went wrong processing that request.' });
    }
});

// ============================================================
// Natural-language search: Gemini parses free-text into REAL
// structured filters (only fields that actually exist in the
// schema — no "cuisine", that column doesn't exist). The actual
// filtering below is plain SQL/JS; Gemini only does the parsing.
// ============================================================

// ── POST /api/chatbots/search ────────────────────────────────────────
// Body: { query: "quiet place for 2 with a table free soon", lat, lng (optional) }
router.post('/search', async (req, res) => {
    const { query, lat, lng } = req.body;

    if (!query || typeof query !== 'string' || !query.trim()) {
        return res.status(400).json({ error: 'A search query is required.' });
    }

    if (!ai) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
    }

    try {
        const parsePrompt = `
            Extract search filters from this restaurant search request: "${query}"

            Respond with ONLY a JSON object, no other text, in exactly this shape:
            {
              "party_size": <integer or null — number of people, if mentioned>,
              "max_wait_minutes": <integer or null — max acceptable wait in minutes. "quick"/"no wait"/"fast" implies roughly 10-15>,
              "keyword": <string or null — a restaurant name or area to text-search for, if mentioned. Do not invent one>
            }
            If a field isn't mentioned or implied, use null for it. Include only these three fields.
        `;

        const response = await ai.models.generateContent({
            model,
            contents: parsePrompt,
            config: {
                responseMimeType: 'application/json',
                maxOutputTokens: 150,
                temperature: 0,
                // Without this the model spent 142 of 150 tokens thinking and
                // returned truncated JSON, so every search came back unfiltered.
                thinkingConfig: { thinkingBudget: 0 }
            }
        });

        const rawText = extractReplyText(response);
        let filters = {};
        try {
            filters = JSON.parse(rawText);
        } catch (parseError) {
            console.error('Could not parse Gemini search filters, raw text was:', rawText);
        }

        // Never trust the model's output shape blindly — validate/clamp
        // every field ourselves before using it in a query.
        const party_size = Number.isInteger(filters.party_size) ? filters.party_size : null;
        const max_wait_minutes = Number.isInteger(filters.max_wait_minutes) ? filters.max_wait_minutes : null;
        const keyword = typeof filters.keyword === 'string' && filters.keyword.trim() ? filters.keyword.trim() : null;

        const conditions = [`r.status = 'open'`];
        const params = [];
        if (keyword) {
            params.push(`%${keyword}%`);
            conditions.push(`(r.name ILIKE $${params.length} OR r.location ILIKE $${params.length})`);
        }

        // Subqueries rather than two LEFT JOINs: joining tables AND queue
        // multiplies the rows, so each count was inflated by the other.
        const partySize = Number(party_size) || 0;
        params.push(partySize);
        const [rows] = await db.query(`
            SELECT r.restaurant_id, r.name, r.location, r.latitude, r.longitude,
                   (SELECT COUNT(*) FROM restaurant_tables t
                     WHERE t.restaurant_id = r.restaurant_id AND t.status = 'vacant')::int AS vacant_tables,
                   (SELECT COUNT(*) FROM restaurant_tables t
                     WHERE t.restaurant_id = r.restaurant_id AND t.status = 'vacant'
                       AND t.capacity >= $${params.length})::int AS fitting_tables,
                   (SELECT COUNT(*) FROM queue q
                     WHERE q.restaurant_id = r.restaurant_id AND q.status = 'waiting')::int AS waiting_count
            FROM restaurant r
            WHERE ${conditions.join(' AND ')}
            ORDER BY r.name ASC
        `, params);

        let results = await Promise.all(rows.map(async (r) => {
            const estimate = await predictWait({
                partySize: partySize || 2,
                peopleAhead: r.waiting_count,
                tablesAvailable: r.vacant_tables
            });
            return { ...r, estimated_wait_min: estimate.minutes };
        }));

        if (partySize) {
            // Only places with a free table big enough for this party.
            results = results.filter((r) => r.fitting_tables > 0);
        }
        if (max_wait_minutes != null) {
            results = results.filter((r) => r.estimated_wait_min <= max_wait_minutes);
        }

        if (lat != null && lng != null) {
            results = rankByConvenience(parseFloat(lat), parseFloat(lng), results);
        }

        res.json({ filters: { party_size, max_wait_minutes, keyword }, results });

    } catch (error) {
        console.error('Search parsing error:', error.message);
        res.status(500).json({ error: 'Failed to process search.' });
    }
});

module.exports = router;
module.exports.isTopicRelevant = isTopicRelevant;
module.exports.supportedFaqQuestions = supportedFaqQuestions;
module.exports.buildActionConfig = buildActionConfig;
module.exports.extractFunctionCall = extractFunctionCall;
module.exports.extractReplyText = extractReplyText;
module.exports.restaurantNow = restaurantNow;
