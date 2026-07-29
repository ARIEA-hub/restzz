const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

let otpStore = {}; 

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, 
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS    
    },
    tls: {
        rejectUnauthorized: false
    }
});

router.post('/send-otp', (req, res) => {
    const { email, role } = req.body; 
    
    if (!email || !role) {
        return res.status(400).json({ success: false, message: "Email and role are required." });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);
    
    otpStore[email] = { otp: otp, role: role }; 

    const roleTitle = role === 'admin' ? 'Admin' : 'Customer';

    const mailOptions = {
        from: 'pandeyneelansh2@gmail.com',
        to: email,
        subject: `Q-Sense ${roleTitle} Verification Code`,
        text: `Hello,\n\nYour Q-Sense ${roleTitle} verification code is: ${otp}\n\nPlease enter this on the verification screen to complete your login.`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error("❌ EMAIL ERROR:", error.message);
            return res.status(500).json({ success: false, message: "Failed to send email." });
        }
        console.log(`✅ ${roleTitle} OTP sent to:`, email);
        res.json({ success: true });
    });
});

router.post('/verify-otp', (req, res) => {
    const { email, otp, role } = req.body;

    if (otpStore[email] && otpStore[email].otp == otp && otpStore[email].role === role) {
        
        delete otpStore[email]; 
        
        const targetDashboard = role === 'admin' ? 'AdminTableManagement.html' : 'CustomerReservation.html';

        res.json({ 
            success: true, 
            message: "Authentication successful!",
            redirect: targetDashboard 
        });

    } else {
        res.status(400).json({ success: false, message: "Invalid OTP or role mismatch." });
    }
});

module.exports = router;
