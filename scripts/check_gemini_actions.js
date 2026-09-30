// scripts/check_gemini_actions.js
//
// Live check of the chat assistant's booking/queue actions against the
// real Gemini API, using the route's own request config and response
// parser. It never touches the database, so nothing is booked.
//
// Usage: node scripts/check_gemini_actions.js   (needs GEMINI_API_KEY in .env)

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const { GoogleGenAI } = require('@google/genai');
const chat = require('../api/routes/chatbots');

const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const RESTAURANTS = ['Foo Bandra', 'Bombay Bistro', 'Copper Chimney', 'Veranda Bandra'];

function addDays(isoDate, days) {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

async function main() {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set.');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const now = chat.restaurantNow();
    const config = chat.buildActionConfig(RESTAURANTS, now);

    const cases = [
        {
            message: 'Book a table for 4 at Foo Bandra tomorrow at 8pm',
            expect: { name: 'book_table', args: { group_size: 4, reserve_date: addDays(now.date, 1), reserve_time: '20:00' } }
        },
        {
            message: 'Put me in the queue at Copper Chimney, we are 3',
            expect: { name: 'join_queue', args: { group_size: 3 } }
        },
        {
            message: 'Book a table at Bombay Bistro',
            expect: { name: null } // missing size/date/time → should ask, not call
        }
    ];

    let failures = 0;
    console.log(`Model ${model} · today ${now.weekday} ${now.date} ${now.time} (${now.tz})\n`);
    for (const c of cases) {
        const response = await ai.models.generateContent({ model, contents: c.message, config });
        const call = chat.extractFunctionCall(response);
        const got = call ? `${call.name}(${JSON.stringify(call.args)})` : `text: "${(chat.extractReplyText(response) || '').slice(0, 90)}"`;

        let ok = (call ? call.name : null) === c.expect.name;
        if (ok && c.expect.args) {
            for (const [k, v] of Object.entries(c.expect.args)) {
                if (String(call.args[k]).replace(/^(\d):/, '0$1:') !== String(v)) ok = false;
            }
        }
        if (!ok) failures++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  "${c.message}"\n      → ${got}\n`);
    }
    process.exit(failures ? 1 : 0);
}

main().catch((error) => {
    console.error('Gemini check failed:', error.status || '', error.message);
    process.exit(2);
});
