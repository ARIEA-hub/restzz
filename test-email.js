// Standalone SMTP credential test — run this directly with Node to check
// EMAIL_USER/EMAIL_PASS without going through the whole signup flow.
// Usage: node test-email.js
require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('Testing with EMAIL_USER =', process.env.EMAIL_USER);
console.log('EMAIL_PASS length =', (process.env.EMAIL_PASS || '').length, '(should be 16, no spaces)');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

transporter.sendMail({
    from: `"Q-Sense Test" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_USER,
    subject: 'Q-Sense SMTP test',
    text: 'If you got this, your Gmail App Password works.'
}, (err, info) => {
    if (err) {
        console.error('FAILED:', err.message);
    } else {
        console.log('SUCCESS:', info.response);
    }
});
