const express = require('express');
const router = express.Router();
const db = require('../database.js');
const { GoogleGenAI } = require('@google/genai');

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
        'reserve a table', 'book a table', 'booking a table', 'join the queue', 'queue for', 'waitlist for'
    ];

    const greetingKeywords = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'thanks', 'thank you'];
    const generalHelpKeywords = ['help', 'can you help', 'what can you do', 'how do i', 'where can i'];

    const hasAllowedTopic = allowedKeywords.some(keyword => text.includes(keyword));
    const hasGreeting = greetingKeywords.some(keyword => text.includes(keyword));
    const hasGeneralHelp = generalHelpKeywords.some(keyword => text.includes(keyword));

    return hasAllowedTopic || hasGreeting || hasGeneralHelp;
}

const supportedFaqQuestions = [
    'Which restaurants are open right now?',
    'How do I book a table?',
    'Can I reserve a table for 2 tonight?',
    'What is my current queue position?',
    'How long is the estimated wait?',
    'How do I cancel a reservation?'
];

router.post('/message', async (req, res, next) => {
    try {
        const { message, userId } = req.body;

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

        if (userId) {
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
                ).then(([rows]) => [rows]),
                db.query(
                    `SELECT res.reserve_id, res.restaurant_id, res.reserve_date,
                            res.reserve_time, res.group_size, res.status,
                            r.name AS restaurant_name
                     FROM reservation res
                     JOIN restaurant r ON r.restaurant_id = res.restaurant_id
                     WHERE res.customer_id = $1 AND res.status = 'reserved'
                     ORDER BY res.reserve_date ASC, res.reserve_time ASC`,
                    [userId]
                ).then(([rows]) => [rows])
            ]);
        }

        const liveContext = JSON.stringify({
            restaurants: restaurantRows,
            activeQueues: queueRows,
            upcomingReservations: reservationRows
        });

        const systemInstruction = `
            You are Q-Sense AI, the restaurant assistant inside the Q-Sense app.
            Answer only about restaurant locations, opening status, reservations, table availability,
            queue position, estimated wait times, cancellations, and dining services.
            Keep every answer brief, direct, and under 80 words. Give one answer only.
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
                maxOutputTokens: 300,
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
