const express = require('express');
const router = express.Router();
const db = require('../database.js');
const { GoogleGenAI } = require('@google/genai');
const jwt = require('jsonwebtoken');

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
        return 'Customer reservation cancellation is not currently available in the app. Please contact the restaurant directly to request a cancellation.';
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
                    `SELECT q.queue_id, q.restaurant_id, q.group_size, q.status,
                            q.joined_at, r.name AS restaurant_name,
                            CASE WHEN q.status IN ('waiting', 'called') THEN
                                ROW_NUMBER() OVER (
                                    PARTITION BY q.restaurant_id
                                    ORDER BY q.joined_at ASC
                                )
                            END AS position,
                            CASE WHEN q.status IN ('waiting', 'called') THEN
                                ROW_NUMBER() OVER (
                                    PARTITION BY q.restaurant_id
                                    ORDER BY q.joined_at ASC
                                ) * 5
                            END AS estimated_wait_minutes
                     FROM queue q
                     JOIN restaurant r ON r.restaurant_id = q.restaurant_id
                     WHERE q.customer_id = $1 AND q.status IN ('waiting', 'called')
                     ORDER BY q.joined_at ASC`,
                    [userId]
                ).then(([rows]) => rows),
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

module.exports = router;
module.exports.isTopicRelevant = isTopicRelevant;
module.exports.supportedFaqQuestions = supportedFaqQuestions;
