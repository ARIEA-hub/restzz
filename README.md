# restzz — AI-Powered Restaurant Queue & Reservation Platform

A full-stack restaurant operations platform combining machine learning wait-time prediction with AI-driven table allocation — built to handle real restaurant workflows end-to-end, from customer signup to admin-side queue management.

## Key Features
- **ML-based wait-time prediction** using Scikit-learn
- **AI-driven auto-allocation** of tables for both reservations and walk-in guests
- **Full authentication flow** — customer signup, email OTP verification, and password reset (via SMTP/Nodemailer)
- **Integrated chatbot** for queue operations and customer interaction
- **Admin dashboard** for real-time restaurant and reservation management
- **Multi-location support** — restaurant and reservation APIs designed for multiple outlets

## Tech Stack
- **Backend:** FastAPI (Python), Supabase (PostgreSQL)
- **Frontend:** JavaScript, HTML/CSS
- **ML:** Scikit-learn
- **Auth/Comms:** OTP verification, Nodemailer/SMTP

## Architecture
Migrated from MySQL to Supabase PostgreSQL for improved reliability and hosted database management. The backend exposes REST APIs for restaurants, reservations, and locations, with a prediction endpoint serving the trained wait-time model directly to the frontend and admin dashboard.

## About
Built by [Ariea Sampat](https://www.linkedin.com/in/ariea-sampat) — Computer Engineering & MBA student, NMIMS MPSTME.
